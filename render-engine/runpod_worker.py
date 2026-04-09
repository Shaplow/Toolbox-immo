"""
RunPod Serverless Worker — Captions Engine
==========================================

Ce worker est exécuté sur RunPod Serverless. Il reçoit un job contenant :
  - video_url      : URL publique ou pré-signée de la vidéo source (depuis R2)
  - srt_content    : contenu SRT/JSON des sous-titres (string)
  - config         : dict de configuration du rendu (format CaptionsApp)
  - preview_mode   : bool (true = preview 6s, false = rendu complet)
  - output_key     : clé R2 de destination pour l'output

Il produit une vidéo sous-titrée et l'upload vers R2, puis retourne :
  { "video_url": "https://...", "output_key": "..." }

Variables d'environnement requises sur RunPod :
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL

Démarrage : CMD ["python", "-u", "runpod_worker.py"]
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import boto3
import httpx
import runpod

from app import _parse_srt_content, _render_captions_video
from engine.encoding_profiles import build_caption_encoding_settings
from engine.models import RenderConfig, WordTimestamp
from engine.probe import probe_video
from engine.runtime_fonts import prepare_runtime_fonts
from engine.template_composite import build_template_ffmpeg_cmd, normalize_video_block
from api import _build_config, _to_bool

BASE_DIR = Path(__file__).parent
FONTS_DIR = BASE_DIR / "fonts"

# ─── R2 client ────────────────────────────────────────────────────────────────

def _get_r2_client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def _r2_public_url(key: str) -> str:
    base = os.environ["R2_PUBLIC_URL"].rstrip("/")
    return f"{base}/{key}"


def _upload_to_r2(key: str, filepath: Path, content_type: str = "video/mp4") -> str:
    """Upload un fichier vers R2 et retourne l'URL publique."""
    client = _get_r2_client()
    bucket = os.environ["R2_BUCKET"]
    with open(filepath, "rb") as f:
        client.upload_fileobj(
            f,
            bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    return _r2_public_url(key)


def _download_file(url: str, dest: Path) -> None:
    """Télécharge une URL vers un fichier local (streaming)."""
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_bytes(chunk_size=65536):
                f.write(chunk)


# ─── Handler principal ────────────────────────────────────────────────────────

def handler(job: dict) -> dict[str, Any]:
    """
    Entrée principale RunPod — dispatch selon job_type.

    job_type "captions" (défaut) :
      - video_url, srt_content, config, preview_mode, output_key, caption_job_id

    job_type "render_template" :
      - overlay_url  : PNG transparent (template sans le bloc vidéo)
      - video_url    : URL de la vidéo source
      - video_block  : {x, y, w, h, fit} — position du bloc vidéo dans le canvas
      - canvas       : {width, height}
      - output_key   : clé R2 de destination (ex: "renders/ID.mp4")
      - render_id    : (optionnel) ID du Render en DB pour logs
    """
    inp = job.get("input", {})
    job_type = inp.get("job_type", "captions")

    if job_type == "render_template":
        return _handle_render_template(inp)
    if job_type == "transcribe":
        return _handle_transcribe(inp)
    return _handle_captions(inp)


def _nvenc_available() -> bool:
    """
    Vérifie si NVENC fonctionne réellement en testant un encode court.
    Un simple check nvidia-smi ne suffit pas : le GPU peut être présent mais
    NVENC inaccessible (limite 3 sessions consumer, driver RunPod, etc.).
    """
    import subprocess
    # 1. GPU présent ?
    result = subprocess.run(
        ["nvidia-smi", "-L"],
        capture_output=True, timeout=10,
    )
    if result.returncode != 0:
        print(f"[worker] nvidia-smi échoué (rc={result.returncode}): {result.stderr.decode(errors='replace')[:200]}")
        return False
    gpus = result.stdout.decode(errors="replace").strip()
    print(f"[worker] GPU détectés : {gpus}")

    # 2. Tester si h264_nvenc peut réellement ouvrir une session d'encodage.
    #    Évite "OpenEncodeSessionEx failed: unsupported device" en production.
    #    NB: h264_nvenc exige une résolution minimale ~145x49 — on utilise 256x256.
    test = subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
         "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"],
        capture_output=True, timeout=30,
    )
    if test.returncode != 0:
        print(f"[worker] h264_nvenc non fonctionnel (rc={test.returncode}), fallback libx264")
        print(f"[worker] stderr: {test.stderr.decode(errors='replace')[-500:]}")
        return False
    return True


_NVENC: bool | None = None  # lazy cache


def _nvenc_enabled() -> bool:
    """
    Indique si NVENC est réellement disponible.
    """
    global _NVENC
    if _NVENC is None:
        _NVENC = _nvenc_available()
        print(f"[worker] NVENC disponible : {_NVENC}")
    return _NVENC


def _handle_captions(inp: dict) -> dict[str, Any]:
    """Génération de sous-titres brûlés dans la vidéo."""
    video_url: str = inp["video_url"]
    srt_content: str = inp["srt_content"]
    config_dict: dict = inp["config"]
    preview_mode: bool = _to_bool(inp.get("preview_mode", True), True)
    output_key: str = inp["output_key"]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stamp = int(time.time() * 1000)
        runtime_fonts_dir = prepare_runtime_fonts(FONTS_DIR, tmp_path, config_dict.get("font_assets"))

        # 1. Télécharger la vidéo source
        video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
        video_path = tmp_path / f"video_{stamp}{video_ext}"
        print(f"[worker] Download video: {video_url}")
        _download_file(video_url, video_path)
        video_info = probe_video(video_path)

        # 2. Parser les sous-titres
        words: list[WordTimestamp] = _parse_srt_content(srt_content)
        if not words:
            raise ValueError("Aucun sous-titre parsé depuis srt_content")

        # 3. Builder la config de rendu
        cfg: RenderConfig = _build_config(config_dict)

        # 4. Rendu captions via le moteur actif
        auto_safe = _to_bool(
            config_dict.get("layout", {}).get("auto_safe_area"), True
        )

        out_suffix = "_preview.mp4" if preview_mode else "_full.mp4"
        out_video = tmp_path / f"render_{stamp}{out_suffix}"
        export_profile = str(config_dict.get("export_profile", "balanced") or "balanced")

        use_nvenc = _nvenc_enabled()
        codec, codec_args, audio_codec, audio_args, encoding_debug = build_caption_encoding_settings(
            export_profile,
            video_info,
            use_nvenc=use_nvenc,
            preview=preview_mode,
        )
        print(
            "[worker] Rendering "
            f"(engine={cfg.engine}, preview={preview_mode}, profile={export_profile}, codec={codec}, "
            f"source_bitrate={encoding_debug['source_video_bitrate']}, "
            f"target_bitrate={encoding_debug['effective_video_bitrate']}, "
            f"maxrate={encoding_debug['maxrate']}, bufsize={encoding_debug['bufsize']}, "
            f"audio_bitrate={encoding_debug['audio_bitrate']})"
        )
        _render_captions_video(
            words,
            video_path,
            cfg,
            out_video,
            auto_safe,
            runtime_fonts_dir,
            preview_mode,
            6,
            export_profile,
            None,
            codec,
            codec_args,
            audio_codec,
            audio_args,
        )

        # 5. Upload vers R2
        print(f"[worker] Uploading output to R2: {output_key}")
        public_url = _upload_to_r2(output_key, out_video, "video/mp4")

    print(f"[worker] Done captions — {public_url}")
    return {
        "video_url": public_url,
        "output_key": output_key,
    }


def _handle_render_template(inp: dict) -> dict[str, Any]:
    """
    Composite un template PNG transparent sur une vidéo via FFmpeg.
    Si h264_nvenc échoue au runtime, retry automatiquement avec libx264.
    """
    import subprocess

    overlay_url: str = inp["overlay_url"]
    video_url: str = inp["video_url"]
    block: dict = inp["video_block"]  # {x, y, w, h, fit}
    canvas: dict = inp["canvas"]      # {width, height}
    output_key: str = inp["output_key"]
    export_profile = str(inp.get("export_profile", "balanced") or "balanced")

    normalized_block = normalize_video_block(block, int(canvas["width"]), int(canvas["height"]))

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stamp = int(time.time() * 1000)

        # 1. Télécharger la vidéo source
        video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
        video_path = tmp_path / f"video_{stamp}{video_ext}"
        print(f"[worker/render_template] Download video: {video_url}")
        _download_file(video_url, video_path)
        video_info = probe_video(video_path)

        # 2. Télécharger le PNG overlay
        overlay_path = tmp_path / f"overlay_{stamp}.png"
        print(f"[worker/render_template] Download overlay: {overlay_url}")
        _download_file(overlay_url, overlay_path)

        out_video = tmp_path / f"result_{stamp}.mp4"
        codec, codec_args, audio_codec, audio_args, encoding_debug = build_caption_encoding_settings(
            export_profile,
            video_info,
            use_nvenc=_nvenc_enabled(),
            preview=False,
            for_composite=True,
        )

        def _run_ffmpeg(c: str, c_args: list[str], a_codec: str, a_args: list[str]) -> subprocess.CompletedProcess:
            cmd = build_template_ffmpeg_cmd(
                video_path=video_path,
                overlay_path=overlay_path,
                out_path=out_video,
                block=normalized_block,
                video_codec=c,
                video_codec_args=c_args,
                audio_codec=a_codec,
                audio_codec_args=a_args,
            )
            print(
                "[worker/render_template] FFmpeg "
                f"{c} {normalized_block['w']}x{normalized_block['h']} "
                f"@ ({normalized_block['x']},{normalized_block['y']}) on "
                f"{normalized_block['canvas_w']}x{normalized_block['canvas_h']} "
                f"profile={export_profile} target_bitrate={encoding_debug['effective_video_bitrate']}"
            )
            return subprocess.run(cmd, capture_output=True, text=True, timeout=10 * 60)

        try:
            result = _run_ffmpeg(codec, codec_args, audio_codec, audio_args)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("FFmpeg timeout pendant le composite vidéo") from exc

        if result.returncode != 0:
            if codec == "h264_nvenc":
                print("[worker/render_template] NVENC failed, retry with libx264")
                fallback_codec, fallback_args, fallback_audio_codec, fallback_audio_args, _ = build_caption_encoding_settings(
                    export_profile,
                    video_info,
                    use_nvenc=False,
                    preview=False,
                    for_composite=True,
                )
                try:
                    fallback = _run_ffmpeg(fallback_codec, fallback_args, fallback_audio_codec, fallback_audio_args)
                except subprocess.TimeoutExpired as exc:
                    raise RuntimeError("FFmpeg timeout pendant le composite vidéo (fallback libx264)") from exc
                if fallback.returncode == 0:
                    result = fallback
                    codec = fallback_codec
                else:
                    raise RuntimeError(
                        f"FFmpeg error ({codec} puis {fallback_codec}):\n"
                        f"NVENC:\n{result.stderr[-1200:]}\n\n"
                        f"Fallback:\n{fallback.stderr[-1200:]}"
                    )
            else:
                raise RuntimeError(f"FFmpeg error ({codec}):\n{result.stderr[-2000:]}")

        # 4. Upload vers R2
        print(f"[worker/render_template] Uploading result to R2: {output_key}")
        public_url = _upload_to_r2(output_key, out_video, "video/mp4")

    print(f"[worker/render_template] Done — {public_url}")
    return {
        "video_url": public_url,
        "output_key": output_key,
    }


def _handle_transcribe(inp: dict) -> dict[str, Any]:
    """
    Transcription audio/vidéo avec WhisperX.

    Input:
      audio_url          : URL publique ou pré-signée du fichier audio/vidéo (depuis R2)
      output_key         : clé R2 de destination pour le JSON segments (persistant)
      job_id             : ID du TranscriptionJob en DB (pour logs)
      model_size         : "turbo" (défaut) | "large-v3" | "medium" | ...
      language           : "fr" (défaut) | "en" | ...
      enable_diarization : bool (défaut False)
      hf_token           : token HuggingFace pour pyannote (opt)
    """
    import json as _json

    from engine.transcribe import transcribe_with_word_timestamps

    audio_url: str = inp["audio_url"]
    output_key: str = inp["output_key"]
    job_id: str = inp.get("job_id", "unknown")
    model_size: str = str(inp.get("model_size", "turbo") or "turbo")
    language: str = str(inp.get("language", "fr") or "fr")
    enable_diarization: bool = _to_bool(inp.get("enable_diarization", False), False)
    hf_token: str | None = inp.get("hf_token") or os.environ.get("HF_TOKEN") or None

    print(f"[worker/transcribe] job={job_id} model={model_size} lang={language} diarize={enable_diarization}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stamp = int(time.time() * 1000)

        # 1. Télécharger le fichier audio/vidéo
        audio_ext = Path(audio_url.split("?")[0]).suffix or ".mp4"
        audio_path = tmp_path / f"audio_{stamp}{audio_ext}"
        print(f"[worker/transcribe] Download audio: {audio_url}")
        _download_file(audio_url, audio_path)

        # 2. Transcrire
        segments = transcribe_with_word_timestamps(
            audio_path=audio_path,
            model_size=model_size,
            language=language,
            enable_diarization=enable_diarization,
            hf_token=hf_token,
        )

        # 3. Sérialiser en JSON et uploader vers R2 (stockage persistant)
        json_path = tmp_path / f"segments_{stamp}.json"
        json_path.write_text(_json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[worker/transcribe] Uploading JSON to R2: {output_key}")
        _upload_to_r2(output_key, json_path, "application/json")

    duration = segments[-1]["end"] if segments else 0.0
    has_diarization = any("speaker" in s for s in segments)

    print(
        f"[worker/transcribe] Done — {len(segments)} segments, "
        f"duration={duration:.1f}s, diarization={has_diarization}"
    )
    return {
        "output_key": output_key,
        "segment_count": len(segments),
        "duration": duration,
        "language": language,
        "has_diarization": has_diarization,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

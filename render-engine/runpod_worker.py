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
from engine.template_composite import (
    OverlaySegment,
    build_template_ffmpeg_cmd,
    build_template_ffmpeg_cmd_timed,
    normalize_video_block,
)
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
    if job_type == "derush_vision":
        return _handle_derush_vision(inp)
    if job_type == "derush_export":
        return _handle_derush_export(inp)
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

    Two overlay modes:
    - Legacy single overlay: ``overlay_url`` (str)
    - Timed multi-overlay: ``overlay_urls`` (list[str]) + ``overlay_segments`` (list[{index,start,end}])

    Optional: ``max_duration`` (float) truncates the output video.
    """
    import subprocess

    video_url: str = inp["video_url"]
    block: dict = inp["video_block"]  # {x, y, w, h, fit}
    canvas: dict = inp["canvas"]      # {width, height}
    output_key: str = inp["output_key"]
    export_profile = str(inp.get("export_profile", "balanced") or "balanced")
    max_duration: float | None = inp.get("max_duration")
    if max_duration is not None:
        max_duration = float(max_duration)

    # Music options (all optional)
    music_url: str | None = inp.get("music_url")
    _music_volume = float(inp.get("music_volume", 0.3))
    _music_source_volume = float(inp.get("music_source_volume", 1.0))
    _music_mute_source = _to_bool(inp.get("music_mute_source", False), False)
    _music_loop = _to_bool(inp.get("music_loop", False), False)
    _music_fade_in = float(inp.get("music_fade_in", 0))
    _music_fade_out = float(inp.get("music_fade_out", 0))

    # Determine overlay mode
    timed_mode = "overlay_urls" in inp
    if timed_mode:
        overlay_urls: list[str] = inp["overlay_urls"]
        raw_segments = inp["overlay_segments"]
        segments: list[OverlaySegment] = [
            OverlaySegment(
                index=int(s["index"]),
                start=float(s["start"]),
                end=float(s["end"]) if s.get("end") is not None else None,
            )
            for s in raw_segments
        ]
    else:
        overlay_url: str = inp["overlay_url"]

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

        # 2. Télécharger le(s) PNG overlay(s)
        if timed_mode:
            overlay_paths: list[Path] = []
            for i, url in enumerate(overlay_urls):  # type: ignore[possibly-undefined]
                p = tmp_path / f"overlay_{stamp}_{i}.png"
                print(f"[worker/render_template] Download overlay {i}: {url}")
                _download_file(url, p)
                overlay_paths.append(p)
        else:
            single_overlay_path = tmp_path / f"overlay_{stamp}.png"
            print(f"[worker/render_template] Download overlay: {overlay_url}")  # type: ignore[possibly-undefined]
            _download_file(overlay_url, single_overlay_path)  # type: ignore[possibly-undefined]
            overlay_paths = [single_overlay_path]

        # 3. Télécharger la musique (optionnel)
        _music_path: Path | None = None
        if music_url:
            _music_path = tmp_path / f"music_{stamp}.mp3"
            print(f"[worker/render_template] Download music: {music_url}")
            try:
                _download_file(music_url, _music_path)
            except Exception as exc:
                print(f"[worker/render_template] Failed to download music: {exc}")
                _music_path = None

        music_opts = dict(
            music_path=str(_music_path) if _music_path else None,
            music_volume=_music_volume,
            source_volume=_music_source_volume,
            mute_source=_music_mute_source,
            music_loop=_music_loop,
            music_fade_in=_music_fade_in,
            music_fade_out=_music_fade_out,
        )

        out_video = tmp_path / f"result_{stamp}.mp4"
        codec, codec_args, audio_codec, audio_args, encoding_debug = build_caption_encoding_settings(
            export_profile,
            video_info,
            use_nvenc=_nvenc_enabled(),
            preview=False,
            for_composite=True,
        )

        def _run_ffmpeg(c: str, c_args: list[str], a_codec: str, a_args: list[str]) -> subprocess.CompletedProcess:
            if timed_mode:
                cmd = build_template_ffmpeg_cmd_timed(
                    video_path=video_path,
                    overlay_paths=overlay_paths,
                    out_path=out_video,
                    block=normalized_block,
                    segments=segments,  # type: ignore[possibly-undefined]
                    video_codec=c,
                    video_codec_args=c_args,
                    audio_codec=a_codec,
                    audio_codec_args=a_args,
                    max_duration=max_duration,
                    **music_opts,
                )
            else:
                cmd = build_template_ffmpeg_cmd(
                    video_path=video_path,
                    overlay_path=overlay_paths[0],
                    out_path=out_video,
                    block=normalized_block,
                    video_codec=c,
                    video_codec_args=c_args,
                    audio_codec=a_codec,
                    audio_codec_args=a_args,
                    max_duration=max_duration,
                    **music_opts,
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


# ─── Derush vision handler ────────────────────────────────────────────────────

def _handle_derush_vision(inp: dict) -> dict[str, Any]:
    """
    Analyse video(s) and returns DerushSegment JSON uploaded to R2.

    Input:
      job_id                   : DerushJob.id
      analysis_mode            : "vision" | "transcription"
      video_urls               : list[str]  — presigned or public R2 URLs
      video_r2_keys            : list[str]  — R2 keys (for source_file meta)
      video_filenames          : list[str]  — original filenames
      output_prefix            : R2 prefix for outputs
      vision_provider          : "heuristic" (default) | "gemini" | "openai" | "claude"
      vision_provider_config   : dict  — provider-specific options
      preset_config            : dict  — DerushPresetConfig (optional)
      transcription_output_url : str   — existing segments.json URL (transcription mode)
      transcription_language   : str   — default "fr"
      transcription_model      : str   — default "turbo"
    """
    import json as _json
    from engine.derush.models import DerushJobInput
    from engine.derush.orchestrator import DerushOrchestrator

    job_id: str = inp["job_id"]
    output_prefix: str = inp.get("output_prefix", f"derush/{job_id}")
    print(f"[worker/derush_vision] job={job_id} mode={inp.get('analysis_mode', 'vision')}")

    job_input = DerushJobInput.from_dict(inp)
    orchestrator = DerushOrchestrator()
    result = orchestrator.run(job_input)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        output_key = f"{output_prefix}/segments.json"
        json_path = tmp_path / "segments.json"
        json_path.write_text(_json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[worker/derush_vision] Uploading segments to R2: {output_key}")
        _upload_to_r2(output_key, json_path, "application/json")

    print(
        f"[worker/derush_vision] Done — {result['segment_count']} segments "
        f"({result['selected_count']} selected), "
        f"duration={result['total_duration']:.1f}s"
    )
    return {
        "output_key": output_key,
        "segment_count": result["segment_count"],
        "selected_count": result["selected_count"],
        "total_duration": result["total_duration"],
        "analysis_mode": result["analysis_mode"],
    }


# ─── Derush export handler ────────────────────────────────────────────────────

def _handle_derush_export(inp: dict) -> dict[str, Any]:
    """
    Export selected segments in the requested format.

    Input:
      job_id           : DerushJob.id
      export_id        : DerushExport.id
      video_urls       : list[str]   — source video URLs (same order as source_files_meta)
      segments_url     : str         — URL to segments.json from derush_vision
      source_files_meta: list[dict]  — [{id, filename, r2_key, r2_public_url, ...}]
      export_format    : str         — "clips_trimmed" | "xml_timeline" | ...
      output_prefix    : str
      workflow         : str         — "capcut" | "premiere" | "resolve" | "generic"
      accurate_trim    : bool
      combo_formats    : list[str]
      xml_format       : str         — "fcpxml" | "premiere_xml"
      segment_ids      : list[str] | null
    """
    import json as _json
    from engine.derush.models import DerushExportInput, SourceFileInfo
    from engine.derush.export import get_exporter
    from engine.probe import probe_video

    job_id: str = inp["job_id"]
    export_id: str = inp["export_id"]
    export_format: str = inp["export_format"]
    output_prefix: str = inp.get("output_prefix", f"derush/{job_id}/export/{export_id}")
    print(f"[worker/derush_export] job={job_id} export={export_id} format={export_format}")

    export_input = DerushExportInput.from_dict(inp)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # 1. Download segments.json first (lightweight) — bail early before fetching source videos
        print(f"[worker/derush_export] Download segments: {export_input.segments_url}")
        resp = httpx.get(export_input.segments_url, timeout=30)
        resp.raise_for_status()
        segments_data: dict = resp.json()
        from engine.derush.models import DerushSegment, ScoreBreakdown
        segments = _deserialize_segments(segments_data.get("segments", segments_data))

        selected = [s for s in segments if not s.is_rejected]
        if export_input.segment_ids:
            _id_set = set(export_input.segment_ids)
            selected = [s for s in selected if s.id in _id_set]
        if not selected:
            return {
                "error": "no_segments_selected",
                "message": (
                    "Vision analysis rejected all segments — no footage to export. "
                    "Try re-running the analysis or adjusting the rejection thresholds."
                ),
            }

        # 2. Prepare source files.
        #    We always download source files to /tmp, even for stream-copy mode.
        #    Passing a remote CDN URL directly to FFmpeg causes it to stall: most
        #    recordings are uploaded without -movflags faststart, so the moov atom
        #    sits at the end of the file — FFmpeg must fetch the full file over HTTP
        #    before it can parse timestamps, reliably hitting the 300 s timeout.
        #    A single sequential download to /tmp is faster and fully reliable.
        from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _ac

        def _dl_source(idx: int, url: str, meta: dict) -> SourceFileInfo:
            ext = Path(meta["filename"]).suffix or ".mp4"
            local_path = str(tmp_path / f"src_{idx:02d}{ext}")
            print(f"[worker/derush_export] Download {meta['filename']} → {local_path}")
            _download_file(url, Path(local_path))
            info = probe_video(local_path)
            return SourceFileInfo(
                id=meta["id"],
                filename=meta["filename"],
                local_path=local_path,
                r2_key=meta["r2_key"],
                r2_public_url=meta.get("r2_public_url", url),
                duration=info.duration,
                width=info.width,
                height=info.height,
                fps=info.fps or 25.0,
                video_bitrate=info.video_bitrate,
            )

        pairs = list(enumerate(zip(export_input.video_urls, export_input.source_files_meta)))
        n_src = len(pairs)
        src_results: dict[int, SourceFileInfo] = {}
        if n_src == 1:
            i, (url, meta) = pairs[0]
            src_results[i] = _dl_source(i, url, meta)
        else:
            with _TPE(max_workers=n_src) as _ex:
                _futs = {_ex.submit(_dl_source, i, url, meta): i for i, (url, meta) in pairs}
                for _fut in _ac(_futs):
                    src_results[_futs[_fut]] = _fut.result()
        source_files: list[SourceFileInfo] = [src_results[i] for i in range(n_src)]

        # 3. Run exporter
        output_dir = str(tmp_path / "output")
        os.makedirs(output_dir, exist_ok=True)
        exporter = get_exporter(export_format)
        result = exporter.export(export_input, segments, source_files, output_dir)

        # 4. Upload output to R2
        output_file = _find_output_file(output_dir, export_format, export_id)
        if output_file:
            content_type = _content_type_for_format(export_format)
            print(f"[worker/derush_export] Uploading to R2: {result.output_key}")
            _upload_to_r2(result.output_key, Path(output_file), content_type)

    print(f"[worker/derush_export] Done — {result.to_dict()}")
    return result.to_dict()


def _deserialize_segments(data: list[dict]) -> list:
    """Reconstruct DerushSegment list from JSON."""
    from engine.derush.models import DerushSegment, ScoreBreakdown
    segments = []
    for d in data:
        seg = DerushSegment(
            id=d["id"],
            source_file_id=d["source_file_id"],
            source_in=d["source_in"],
            source_out=d["source_out"],
            duration=d["duration"],
            analysis_mode=d["analysis_mode"],
            order=d.get("order", 0),
            score=d.get("score", 0.0),
            shot_type=d.get("shot_type", "unknown"),
            text=d.get("text"),
            speaker=d.get("speaker"),
            speech_tag=d.get("speech_tag"),
            keyframe_r2_keys=d.get("keyframe_r2_keys", []),
            keyframe_urls=d.get("keyframe_urls", []),
            tags=d.get("tags", []),
            is_rejected=d.get("is_rejected", False),
            reject_reason=d.get("reject_reason"),
            exported_filename=d.get("exported_filename"),
            parent_id=d.get("parent_id"),
            is_sub_segment=d.get("is_sub_segment", False),
        )
        bd = d.get("score_breakdown")
        if bd:
            seg.score_breakdown = ScoreBreakdown(**{
                k: bd.get(k, 0.0) for k in [
                    "sharpness", "stability", "exposure", "composition",
                    "duration_score", "visual_interest", "diversity", "speech_relevance"
                ]
            })
        segments.append(seg)
    return segments


def _find_output_file(output_dir: str, export_format: str, export_id: str) -> str | None:
    """Find the primary output file for upload."""
    ext_map = {
        "clips_trimmed": f"clips_{export_id}.zip",
        "xml_timeline": None,  # multiple possible ext
        "stringout_video": f"stringout_{export_id}.mp4",
        "structured_folder": f"derush_{export_id}.zip",
        "manifest_only": f"manifest_{export_id}.json",
        "combo_export": f"combo_{export_id}.zip",
    }
    filename = ext_map.get(export_format)
    if filename:
        full = os.path.join(output_dir, filename)
        return full if os.path.exists(full) else None
    # xml_timeline: find .fcpxml or .xml
    for ext in (".fcpxml", ".xml"):
        candidate = os.path.join(output_dir, f"timeline_{export_id}{ext}")
        if os.path.exists(candidate):
            return candidate
    return None


def _content_type_for_format(export_format: str) -> str:
    return {
        "clips_trimmed": "application/zip",
        "xml_timeline": "application/xml",
        "stringout_video": "video/mp4",
        "structured_folder": "application/zip",
        "manifest_only": "application/json",
        "combo_export": "application/zip",
    }.get(export_format, "application/octet-stream")


if __name__ == "__main__":
    # ── Démarrage du worker : log GPU, check NVENC, warmup modèles ───────────
    # Tout ce qui est fait ici tourne AVANT runpod.serverless.start(), donc hors billing job.
    # Les workers RunPod restent vivants entre les jobs (idle timeout) — les caches
    # module-level garantissent que modèles et check NVENC ne sont chargés qu'une fois.

    # 1. Log GPU hardware
    try:
        import torch
        if torch.cuda.is_available():
            _props = torch.cuda.get_device_properties(0)
            _vram_gb = _props.total_memory / 1024 ** 3
            print(
                f"[worker] GPU: {_props.name} "
                f"| VRAM: {_vram_gb:.1f} GB "
                f"| CUDA: {torch.version.cuda} "
                f"| devices: {torch.cuda.device_count()}",
                flush=True,
            )
        else:
            print("[worker] GPU: CUDA non disponible (CPU only)", flush=True)
    except Exception as _e:
        print(f"[worker] GPU log: ignoré ({_e})", flush=True)

    # 2. Check NVENC en avance (résultat mis en cache dans _NVENC)
    #    Évite que le premier job captions/render_template subisse le délai du test d'encodage.
    try:
        _nvenc_ok = _nvenc_enabled()
        print(f"[worker] NVENC: {'disponible ✓' if _nvenc_ok else 'indisponible → fallback libx264'}", flush=True)
    except Exception as _e:
        print(f"[worker] NVENC check: ignoré ({_e})", flush=True)

    # 3. Warmup Whisper : charger les modèles en VRAM pour éliminer le cold start du 1er job
    try:
        from engine.transcribe import _get_whisper_model, _get_align_model, _resolve_device
        _device, _compute_type = _resolve_device()
        if _device == "cuda":
            print("[worker] Warmup: chargement des modèles whisper en VRAM...", flush=True)
            _get_whisper_model("large-v3-turbo", _device, _compute_type)
            _get_whisper_model("large-v3", _device, _compute_type)
            _get_align_model("fr", _device)
            print("[worker] Warmup: modèles prêts — worker opérationnel.", flush=True)
        else:
            print("[worker] Warmup: pas de CUDA, skip chargement modèles.", flush=True)
    except Exception as _e:
        print(f"[worker] Warmup modèles: ignoré ({_e})", flush=True)

    runpod.serverless.start({"handler": handler})

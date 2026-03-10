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

from app import _parse_srt_content, _render_ass
from engine.models import RenderConfig, WordTimestamp
from engine.probe import probe_video
from engine.render import burn_subtitles, render_preview_frame
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


def _video_encoder() -> tuple[str, list[str]]:
    """
    Retourne (codec, extra_args) :
      - h264_nvenc (GPU)  si NVENC dispo  → x10-20 plus rapide pour l'encoding
      - libx264   (CPU)  sinon (local/fallback)
    """
    global _NVENC
    if _NVENC is None:
        _NVENC = _nvenc_available()
        print(f"[worker] NVENC disponible : {_NVENC}")
    if _NVENC:
        # p4 = preset équilibré qualité/vitesse sur NVENC
        return "h264_nvenc", ["-preset", "p4", "-rc", "vbr", "-cq", "22", "-b:v", "0"]
    return "libx264", ["-preset", "fast", "-crf", "22"]


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

        # 1. Télécharger la vidéo source
        video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
        video_path = tmp_path / f"video_{stamp}{video_ext}"
        print(f"[worker] Download video: {video_url}")
        _download_file(video_url, video_path)

        # 2. Parser les sous-titres
        words: list[WordTimestamp] = _parse_srt_content(srt_content)
        if not words:
            raise ValueError("Aucun sous-titre parsé depuis srt_content")

        # 3. Builder la config de rendu
        cfg: RenderConfig = _build_config(config_dict)

        # 4. Générer le fichier ASS
        auto_safe = _to_bool(
            config_dict.get("layout", {}).get("auto_safe_area"), True
        )
        ass_path = _render_ass(words, video_path, cfg, auto_safe_area=auto_safe)

        # 5. Rendu vidéo
        out_suffix = "_preview.mp4" if preview_mode else "_full.mp4"
        out_video = tmp_path / f"render_{stamp}{out_suffix}"
        export_profile = str(config_dict.get("export_profile", "balanced") or "balanced")

        codec, codec_args = _video_encoder()
        print(f"[worker] Rendering (preview={preview_mode}, profile={export_profile}, codec={codec})")
        burn_subtitles(
            video_path,
            ass_path,
            out_video,
            FONTS_DIR,
            preview=preview_mode,
            preview_seconds=6,
            quality_profile=export_profile,
            video_codec=codec,
            video_codec_args=codec_args,
        )

        # 6. Upload vers R2
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

    bx, by, bw, bh = int(block["x"]), int(block["y"]), int(block["w"]), int(block["h"])
    cw, ch = int(canvas["width"]), int(canvas["height"])
    fit = block.get("fit", "cover")

    # Clamp video block to canvas bounds (prevents "Padded dimensions cannot be smaller" error)
    bx = max(0, bx)
    by = max(0, by)
    bw = max(2, min(bw, cw - bx))
    bh = max(2, min(bh, ch - by))

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stamp = int(time.time() * 1000)

        # 1. Télécharger la vidéo source
        video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
        video_path = tmp_path / f"video_{stamp}{video_ext}"
        print(f"[worker/render_template] Download video: {video_url}")
        _download_file(video_url, video_path)

        # 2. Télécharger le PNG overlay
        overlay_path = tmp_path / f"overlay_{stamp}.png"
        print(f"[worker/render_template] Download overlay: {overlay_url}")
        _download_file(overlay_url, overlay_path)

        # 3. Construire le filtre FFmpeg
        if fit == "contain":
            scale_filter = f"scale={bw}:{bh}:force_original_aspect_ratio=decrease,pad={bw}:{bh}:(ow-iw)/2:(oh-ih)/2:black"
        else:  # cover — crop décalé selon le focal point
            crop_x = float(block.get("crop_x", 0.5))
            crop_y = float(block.get("crop_y", 0.5))
            scale_filter = (
                f"scale={bw}:{bh}:force_original_aspect_ratio=increase,"
                f"crop={bw}:{bh}:(iw-{bw})*{crop_x}:(ih-{bh})*{crop_y}"
            )

        pad_filter = f"pad={cw}:{ch}:{bx}:{by}:black@0"
        filter_complex = (
            f"[0:v]{scale_filter},{pad_filter}[placed];"
            f"[placed][1:v]overlay=0:0:format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2[out]"
        )

        out_video = tmp_path / f"result_{stamp}.mp4"
        codec, codec_args = _video_encoder()

        def _run_ffmpeg(c: str, c_args: list) -> subprocess.CompletedProcess:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-i", str(overlay_path),
                "-filter_complex", filter_complex,
                "-map", "[out]",
                "-map", "0:a?",
                "-c:v", c, *c_args,
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(out_video),
            ]
            print(f"[worker/render_template] FFmpeg {c} {bw}x{bh} @ ({bx},{by}) on {cw}x{ch}")
            return subprocess.run(cmd, capture_output=True, text=True)

        result = _run_ffmpeg(codec, codec_args)

        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error ({codec}):\n{result.stderr[-2000:]}")

        # 4. Upload vers R2
        print(f"[worker/render_template] Uploading result to R2: {output_key}")
        public_url = _upload_to_r2(output_key, out_video, "video/mp4")

    print(f"[worker/render_template] Done — {public_url}")
    return {
        "video_url": public_url,
        "output_key": output_key,
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

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

import ctypes
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from ctypes.util import find_library
from pathlib import Path
from typing import Any

import boto3
import httpx
import runpod

from app import _parse_srt_content, _parse_text_auto, _render_captions_video
from engine.encoding_profiles import build_caption_encoding_settings
from engine.models import RenderConfig, WordTimestamp
from engine.probe import probe_video
from engine.autocut import analyze_autocut
from engine.media_edit import process_media_edit
from engine.runtime_fonts import prepare_runtime_fonts
from engine.template_composite import (
    OverlaySegment,
    build_music_track_filter,
    build_template_ffmpeg_cmd,
    build_template_ffmpeg_cmd_timed,
    build_template_ffmpeg_cmd_video_only,
    normalize_video_block,
)
from api import _build_config, _to_bool

BASE_DIR = Path(__file__).parent
FONTS_DIR = BASE_DIR / "fonts"
NVENC_RETRY_INTERVAL_SECONDS = int(os.environ.get("NVENC_RETRY_INTERVAL_SECONDS", "120"))
WORKER_LOG_SNIPPET_LIMIT = int(os.environ.get("WORKER_LOG_SNIPPET_LIMIT", "6000"))

_NVENC_STATE: dict[str, Any] = {
    "available": None,
    "checked_at": 0.0,
    "source": "never",
    "reason": "not checked yet",
    "returncode": None,
    "command": "",
    "stdout": "",
    "stderr": "",
}

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


def _command_parts(command: Any) -> list[str]:
    if not command:
        return []
    if isinstance(command, (list, tuple)):
        return [str(part) for part in command]
    return [str(command)]


def _format_command(command: Any) -> str:
    parts = _command_parts(command)
    return " ".join(shlex.quote(part) for part in parts)


def _trim_output(text: str, limit: int = WORKER_LOG_SNIPPET_LIMIT) -> str:
    content = (text or "").strip()
    if not content:
        return ""
    if len(content) <= limit:
        return content
    omitted = len(content) - limit
    return f"[... truncated {omitted} chars ...]\n{content[-limit:]}"


def _run_command(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def _log_command_failure(
    prefix: str,
    *,
    command: Any,
    returncode: int | None,
    stdout: str = "",
    stderr: str = "",
) -> None:
    formatted = _format_command(command)
    if formatted:
        print(f"{prefix} command: {formatted}", flush=True)
    if returncode is not None:
        print(f"{prefix} rc={returncode}", flush=True)
    trimmed_stdout = _trim_output(stdout)
    if trimmed_stdout:
        print(f"{prefix} stdout:\n{trimmed_stdout}", flush=True)
    trimmed_stderr = _trim_output(stderr)
    if trimmed_stderr:
        print(f"{prefix} stderr:\n{trimmed_stderr}", flush=True)


def _trim_env_value(value: str, limit: int = 240) -> str:
    content = value.strip()
    if len(content) <= limit:
        return content
    return f"{content[:limit]}..."


def _log_runtime_env_info() -> None:
    for name in (
        "NVIDIA_VISIBLE_DEVICES",
        "NVIDIA_DRIVER_CAPABILITIES",
        "CUDA_VISIBLE_DEVICES",
        "LD_LIBRARY_PATH",
    ):
        value = os.environ.get(name)
        if value is None:
            print(f"[worker] env {name}: <absent>", flush=True)
        else:
            print(f"[worker] env {name}: {_trim_env_value(value)}", flush=True)

    raw_caps = os.environ.get("NVIDIA_DRIVER_CAPABILITIES", "")
    caps = {item.strip().lower() for item in raw_caps.split(",") if item.strip()}
    if caps and "all" not in caps and "video" not in caps:
        print(
            "[worker] env NVIDIA_DRIVER_CAPABILITIES: warning — la capacité 'video' est absente",
            flush=True,
        )


def _log_nvidia_device_nodes() -> None:
    nodes = sorted(str(path) for path in Path("/dev").glob("nvidia*"))
    print(
        f"[worker] /dev nvidia nodes: {', '.join(nodes) if nodes else 'aucun'}",
        flush=True,
    )


def _log_dynamic_loader_matches() -> None:
    ldconfig_path = shutil.which("ldconfig")
    print(f"[worker] ldconfig path: {ldconfig_path or 'introuvable'}", flush=True)
    if not ldconfig_path:
        return

    result = _run_command([ldconfig_path, "-p"], timeout=10)
    if result.returncode != 0:
        _log_command_failure(
            "[worker] ldconfig probe",
            command=result.args,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )
        return

    for token in ("libnvidia-encode", "libcuda", "libnvcuvid"):
        matches = [line.strip() for line in result.stdout.splitlines() if token in line]
        if matches:
            for line in matches[:8]:
                print(f"[worker] ldconfig {token}: {line}", flush=True)
        else:
            print(f"[worker] ldconfig {token}: aucun match", flush=True)


def _probe_shared_library(label: str, lookup_name: str, fallback_soname: str) -> None:
    resolved = find_library(lookup_name)
    print(
        f"[worker] find_library({lookup_name}): {resolved or 'introuvable'}",
        flush=True,
    )

    candidates: list[str] = []
    if resolved:
        candidates.append(resolved)
    if fallback_soname not in candidates:
        candidates.append(fallback_soname)

    last_error: str | None = None
    for candidate in candidates:
        try:
            ctypes.CDLL(candidate)
            print(f"[worker] dlopen {label}: OK via {candidate}", flush=True)
            return
        except OSError as exc:
            last_error = str(exc)
            print(f"[worker] dlopen {label}: échec via {candidate}: {exc}", flush=True)

    print(
        f"[worker] dlopen {label}: indisponible ({last_error or 'aucun candidat chargeable'})",
        flush=True,
    )


def _log_ffmpeg_encoder_details(encoder_name: str) -> None:
    result = _run_command(["ffmpeg", "-hide_banner", "-h", f"encoder={encoder_name}"], timeout=10)
    if result.returncode != 0:
        _log_command_failure(
            f"[worker] ffmpeg encoder {encoder_name}",
            command=result.args,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )
        return

    interesting_prefixes = (
        "Encoder ",
        "General capabilities:",
        "Threading capabilities:",
        "Supported hardware devices:",
        "Supported pixel formats:",
    )
    selected = [
        line.strip()
        for line in result.stdout.splitlines()
        if line.strip().startswith(interesting_prefixes)
    ]
    if selected:
        for line in selected:
            print(f"[worker] ffmpeg {encoder_name}: {line}", flush=True)
        return

    print(f"[worker] ffmpeg {encoder_name}:\n{_trim_output(result.stdout)}", flush=True)


def _record_nvenc_state(
    *,
    available: bool,
    source: str,
    reason: str,
    command: Any = None,
    returncode: int | None = None,
    stdout: str = "",
    stderr: str = "",
) -> bool:
    global _NVENC_STATE
    _NVENC_STATE = {
        "available": available,
        "checked_at": time.time(),
        "source": source,
        "reason": reason,
        "returncode": returncode,
        "command": _format_command(command),
        "stdout": _trim_output(stdout),
        "stderr": _trim_output(stderr),
    }
    status = "disponible" if available else "indisponible"
    print(f"[worker] NVENC state ({source}): {status} — {reason}", flush=True)
    _log_command_failure(
        f"[worker] NVENC state ({source})",
        command=command,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )
    return available


def _mark_nvenc_runtime_failure(
    source: str,
    *,
    command: Any,
    returncode: int | None,
    stdout: str = "",
    stderr: str = "",
) -> None:
    _record_nvenc_state(
        available=False,
        source=source,
        reason=f"échec runtime; nouveau probe autorisé après {NVENC_RETRY_INTERVAL_SECONDS}s",
        command=command,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


def _log_worker_runtime_info() -> None:
    _log_runtime_env_info()
    _log_nvidia_device_nodes()
    _log_dynamic_loader_matches()
    _probe_shared_library("libcuda", "cuda", "libcuda.so.1")
    _probe_shared_library("libnvidia-encode", "nvidia-encode", "libnvidia-encode.so.1")
    _probe_shared_library("libnvcuvid", "nvcuvid", "libnvcuvid.so.1")

    ffmpeg_path = shutil.which("ffmpeg")
    print(f"[worker] ffmpeg path: {ffmpeg_path or 'introuvable'}", flush=True)

    if ffmpeg_path:
        version = _run_command(["ffmpeg", "-version"], timeout=10)
        version_line = next((line for line in version.stdout.splitlines() if line.strip()), "")
        if version_line:
            print(f"[worker] ffmpeg version: {version_line}", flush=True)
        elif version.stderr.strip():
            print(f"[worker] ffmpeg version stderr:\n{_trim_output(version.stderr)}", flush=True)

        encoders = _run_command(["ffmpeg", "-hide_banner", "-encoders"], timeout=10)
        if encoders.returncode == 0:
            encoder_names: list[str] = []
            for line in encoders.stdout.splitlines():
                if "nvenc" not in line:
                    continue
                parts = line.split()
                if len(parts) >= 2:
                    encoder_names.append(parts[1])
            print(
                f"[worker] ffmpeg NVENC encoders: {', '.join(encoder_names) if encoder_names else 'aucun'}",
                flush=True,
            )
        else:
            _log_command_failure(
                "[worker] ffmpeg encoders probe",
                command=encoders.args,
                returncode=encoders.returncode,
                stdout=encoders.stdout,
                stderr=encoders.stderr,
            )

        hwaccels = _run_command(["ffmpeg", "-hide_banner", "-hwaccels"], timeout=10)
        if hwaccels.returncode == 0:
            accel_names = [
                line.strip()
                for line in hwaccels.stdout.splitlines()
                if line.strip() and not line.lower().startswith("hardware acceleration")
            ]
            print(
                f"[worker] ffmpeg hwaccels: {', '.join(accel_names) if accel_names else 'aucun'}",
                flush=True,
            )
        else:
            _log_command_failure(
                "[worker] ffmpeg hwaccels probe",
                command=hwaccels.args,
                returncode=hwaccels.returncode,
                stdout=hwaccels.stdout,
                stderr=hwaccels.stderr,
            )

        _log_ffmpeg_encoder_details("h264_nvenc")
        _log_ffmpeg_encoder_details("hevc_nvenc")

    gpu_info = _run_command(
        ["nvidia-smi", "--query-gpu=driver_version,name,uuid", "--format=csv,noheader"],
        timeout=10,
    )
    if gpu_info.returncode == 0:
        for line in gpu_info.stdout.splitlines():
            if line.strip():
                print(f"[worker] nvidia-smi: {line.strip()}", flush=True)
    else:
        _log_command_failure(
            "[worker] nvidia-smi probe",
            command=gpu_info.args,
            returncode=gpu_info.returncode,
            stdout=gpu_info.stdout,
            stderr=gpu_info.stderr,
        )


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
    if job_type == "render_sequence":
        return _handle_render_sequence(inp)
    if job_type == "transcribe":
        return _handle_transcribe(inp)
    if job_type == "media_edit":
        return _handle_media_edit(inp)
    if job_type == "media_autocut_batch":
        return _handle_media_autocut_batch(inp)
    return _handle_captions(inp)


def _nvenc_available() -> bool:
    """
    Vérifie si NVENC fonctionne réellement en testant un encode court.
    Un simple check nvidia-smi ne suffit pas : le GPU peut être présent mais
    NVENC inaccessible (limite 3 sessions consumer, driver RunPod, etc.).
    """
    return _probe_nvenc("runtime")


def _probe_nvenc(source: str) -> bool:
    # 1. GPU présent ?
    result = _run_command(["nvidia-smi", "-L"], timeout=10)
    if result.returncode != 0:
        return _record_nvenc_state(
            available=False,
            source=source,
            reason="nvidia-smi -L a échoué",
            command=result.args,
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )
    gpus = result.stdout.strip()
    print(f"[worker] GPU détectés ({source}) : {gpus}", flush=True)

    # 2. Tester si h264_nvenc peut réellement ouvrir une session d'encodage.
    #    Évite "OpenEncodeSessionEx failed: unsupported device" en production.
    #    NB: h264_nvenc exige une résolution minimale ~145x49 — on utilise 256x256.
    test_command = [
        "ffmpeg", "-hide_banner", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
        "-frames:v", "1",
        "-c:v", "h264_nvenc",
        "-f", "null", "-",
    ]
    print(f"[worker] NVENC probe ({source}) command: {_format_command(test_command)}", flush=True)
    test = _run_command(test_command, timeout=30)
    if test.returncode != 0:
        return _record_nvenc_state(
            available=False,
            source=source,
            reason="probe FFmpeg h264_nvenc en échec",
            command=test.args,
            returncode=test.returncode,
            stdout=test.stdout,
            stderr=test.stderr,
        )
    return _record_nvenc_state(
        available=True,
        source=source,
        reason="probe FFmpeg h264_nvenc réussi",
        command=test.args,
        returncode=test.returncode,
        stdout=test.stdout,
        stderr=test.stderr,
    )


def _nvenc_enabled(*, source: str, force_refresh: bool = False) -> bool:
    """
    Indique si NVENC est réellement disponible.
    """
    available = _NVENC_STATE["available"]
    checked_at = float(_NVENC_STATE["checked_at"])
    age_seconds = time.time() - checked_at if checked_at > 0 else None
    last_source = str(_NVENC_STATE["source"])

    should_refresh = (
        force_refresh
        or available is None
        or (available is False and last_source == "startup" and source != "startup")
        or (available is False and (age_seconds is None or age_seconds >= NVENC_RETRY_INTERVAL_SECONDS))
    )
    if should_refresh:
        return _probe_nvenc(source)

    age_label = f"{age_seconds:.0f}s" if age_seconds is not None else "n/a"
    print(
        f"[worker] NVENC cache ({source}): {available} age={age_label} reason={_NVENC_STATE['reason']}",
        flush=True,
    )
    return bool(available)


def _require_fields(inp: dict, fields: tuple[str, ...], handler: str) -> None:
    """Raise ValueError with a clear message if any required field is missing from the job input."""
    missing = [f for f in fields if f not in inp]
    if missing:
        raise ValueError(f"{handler}: champs requis manquants dans l'input: {missing}")


def _handle_captions(inp: dict) -> dict[str, Any]:
    """Génération de sous-titres brûlés dans la vidéo."""
    _require_fields(inp, ("video_url", "srt_content", "config", "output_key"), "captions")
    video_url: str = inp["video_url"]
    srt_content: str = inp["srt_content"]
    config_dict: dict = inp["config"]
    preview_mode: bool = _to_bool(inp.get("preview_mode", True), True)
    output_key: str = inp["output_key"]
    caption_job_id: str | None = inp.get("caption_job_id")

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

        # 2. Parser les sous-titres (SRT ou JSON avec vrais timestamps mot par mot)
        words: list[WordTimestamp] = _parse_text_auto(srt_content)
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

        use_nvenc = _nvenc_enabled(source="captions")
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
        try:
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
        except subprocess.CalledProcessError as exc:
            _log_command_failure(
                "[worker/captions] FFmpeg failure",
                command=exc.cmd,
                returncode=exc.returncode,
                stdout=exc.stdout or "",
                stderr=exc.stderr or "",
            )
            if codec != "h264_nvenc":
                raise RuntimeError(
                    f"FFmpeg error ({codec}):\n{_trim_output(exc.stderr or str(exc))}"
                ) from exc

            _mark_nvenc_runtime_failure(
                "captions/runtime",
                command=exc.cmd,
                returncode=exc.returncode,
                stdout=exc.stdout or "",
                stderr=exc.stderr or "",
            )
            print("[worker/captions] NVENC failed, retry with libx264", flush=True)
            fallback_codec, fallback_args, fallback_audio_codec, fallback_audio_args, fallback_debug = build_caption_encoding_settings(
                export_profile,
                video_info,
                use_nvenc=False,
                preview=preview_mode,
            )
            print(
                "[worker] Rendering fallback "
                f"(engine={cfg.engine}, preview={preview_mode}, profile={export_profile}, codec={fallback_codec}, "
                f"source_bitrate={fallback_debug['source_video_bitrate']}, "
                f"target_bitrate={fallback_debug['effective_video_bitrate']}, "
                f"maxrate={fallback_debug['maxrate']}, bufsize={fallback_debug['bufsize']}, "
                f"audio_bitrate={fallback_debug['audio_bitrate']})",
                flush=True,
            )
            try:
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
                    fallback_codec,
                    fallback_args,
                    fallback_audio_codec,
                    fallback_audio_args,
                )
            except subprocess.CalledProcessError as fallback_exc:
                _log_command_failure(
                    "[worker/captions] FFmpeg fallback failure",
                    command=fallback_exc.cmd,
                    returncode=fallback_exc.returncode,
                    stdout=fallback_exc.stdout or "",
                    stderr=fallback_exc.stderr or "",
                )
                raise RuntimeError(
                    f"FFmpeg error ({codec} puis {fallback_codec}):\n"
                    f"NVENC:\n{_trim_output(exc.stderr or str(exc))}\n\n"
                    f"Fallback:\n{_trim_output(fallback_exc.stderr or str(fallback_exc))}"
                ) from fallback_exc

        # 5. Upload vers R2
        print(f"[worker] Uploading output to R2: {output_key}")
        public_url = _upload_to_r2(output_key, out_video, "video/mp4")

    print(f"[worker] Done captions — {public_url}")
    return {
        "video_url": public_url,
        "output_key": output_key,
        "caption_job_id": caption_job_id,
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
    _require_fields(inp, ("video_url", "video_block", "canvas", "output_key"), "render_template")
    if "overlay_url" not in inp and "overlay_urls" not in inp:
        raise ValueError("render_template: 'overlay_url' ou 'overlay_urls' est requis")
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
        _music_warning: str | None = None
        if music_url:
            _music_path = tmp_path / f"music_{stamp}.mp3"
            print(f"[worker/render_template] Download music: {music_url}")
            try:
                _download_file(music_url, _music_path)
            except Exception as exc:
                print(f"[worker/render_template] Failed to download music: {exc}")
                _music_warning = f"Musique non disponible : {exc}"
                _music_path = None

        music_opts = dict(
            music_path=str(_music_path) if _music_path else None,
            music_volume=_music_volume,
            source_volume=_music_source_volume,
            mute_source=_music_mute_source,
            music_loop=_music_loop,
            music_fade_in=_music_fade_in,
            music_fade_out=_music_fade_out,
            source_has_audio=video_info.has_audio,
        )
        print(f"[worker/render_template] source has_audio={video_info.has_audio}", flush=True)

        out_video = tmp_path / f"result_{stamp}.mp4"
        codec, codec_args, audio_codec, audio_args, encoding_debug = build_caption_encoding_settings(
            export_profile,
            video_info,
            use_nvenc=_nvenc_enabled(source="render_template"),
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
            print(f"[worker/render_template] FFmpeg cmd: {_format_command(cmd)}", flush=True)
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10 * 60,
            )

        try:
            result = _run_ffmpeg(codec, codec_args, audio_codec, audio_args)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"FFmpeg timeout pendant le composite vidéo: {_format_command(exc.cmd)}"
            ) from exc

        if result.returncode != 0:
            if codec == "h264_nvenc":
                _log_command_failure(
                    "[worker/render_template] NVENC failure",
                    command=result.args,
                    returncode=result.returncode,
                    stdout=result.stdout,
                    stderr=result.stderr,
                )
                _mark_nvenc_runtime_failure(
                    "render_template/runtime",
                    command=result.args,
                    returncode=result.returncode,
                    stdout=result.stdout,
                    stderr=result.stderr,
                )
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
                    raise RuntimeError(
                        f"FFmpeg timeout pendant le composite vidéo (fallback libx264): {_format_command(exc.cmd)}"
                    ) from exc
                if fallback.returncode == 0:
                    result = fallback
                    codec = fallback_codec
                    print("[worker/render_template] fallback libx264 succeeded", flush=True)
                else:
                    _log_command_failure(
                        "[worker/render_template] Fallback failure",
                        command=fallback.args,
                        returncode=fallback.returncode,
                        stdout=fallback.stdout,
                        stderr=fallback.stderr,
                    )
                    raise RuntimeError(
                        f"FFmpeg error ({codec} puis {fallback_codec}):\n"
                        f"NVENC:\n{_trim_output(result.stderr)}\n\n"
                        f"Fallback:\n{_trim_output(fallback.stderr)}"
                    )
            else:
                _log_command_failure(
                    "[worker/render_template] FFmpeg failure",
                    command=result.args,
                    returncode=result.returncode,
                    stdout=result.stdout,
                    stderr=result.stderr,
                )
                raise RuntimeError(f"FFmpeg error ({codec}):\n{_trim_output(result.stderr)}")

        # 4. Upload vers R2
        print(f"[worker/render_template] Uploading result to R2: {output_key}")
        public_url = _upload_to_r2(output_key, out_video, "video/mp4")

    print(f"[worker/render_template] Done — {public_url}")
    render_id: str = inp.get("render_id", "")
    result: dict[str, Any] = {
        "video_url": public_url,
        "output_key": output_key,
        "render_id": render_id,
    }
    if _music_warning:
        result["warnings"] = [_music_warning]
    return result


def _handle_render_sequence(inp: dict) -> dict[str, Any]:
    """
    Assemble a multi-clip video sequence:
      1. For each slot: scale/crop video → clip_N.mp4 (with or without overlay PNG(s))
      2. FFmpeg concat all clips → combined.mp4
      3. If music: mix onto combined.mp4 with -c:v copy → final.mp4
      4. Upload final.mp4 to R2 → return video_url

    Input payload:
      canvas        : {width, height}
      slots         : list of slot objects:
        slot_id             : str
        video_url           : str
        video_block         : {x, y, w, h, fit}
        overlay_url?        : str | null           — single overlay PNG (legacy)
        overlay_urls?       : list[str | null]     — timed overlays
        overlay_segments?   : list[{index, start, end}]
        max_duration?       : float
        music_source_volume?: float  — per-slot source audio volume (default 1.0)
        music_mute_source?  : bool   — per-slot mute source audio (default false)
        music_start_at?     : float  — seek position in music track for this slot
        music_stop_at?      : float  — stop music at this position (unused for now, future)
      output_key    : R2 destination key
      export_profile: "template" (default)
      music_url?          : optional audio track URL
      music_volume?       : float (default 0.3)
      music_loop?         : bool
      music_fade_in?      : float seconds
      music_fade_out?     : float seconds
    """
    _require_fields(inp, ("canvas", "slots", "output_key"), "render_sequence")
    canvas: dict = inp["canvas"]
    slots: list[dict] = inp["slots"]
    output_key: str = inp["output_key"]
    export_profile = str(inp.get("export_profile", "template") or "template")

    music_url: str | None = inp.get("music_url")
    _music_volume = float(inp.get("music_volume", 0.3))
    # Global fallback audio params (used if slot does not specify per-slot values)
    _global_music_source_volume = float(inp.get("music_source_volume", 1.0))
    _global_music_mute_source = _to_bool(inp.get("music_mute_source", False), False)
    _music_loop = _to_bool(inp.get("music_loop", False), False)
    _music_fade_in = float(inp.get("music_fade_in", 0))
    _music_fade_out = float(inp.get("music_fade_out", 0))
    # Global duration cap for the final output (applied after concat + music mix)
    _global_max_duration: float | None = float(inp["max_duration"]) if inp.get("max_duration") is not None else None

    canvas_w = int(canvas["width"])
    canvas_h = int(canvas["height"])

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        stamp = int(time.time() * 1000)

        clip_paths: list[Path] = []
        any_audio = False
        has_effective_audio = False  # True if any slot contributes real (non-muted) audio
        # Per-slot music track params for time-varying volume expression.
        slot_audio_specs: list[dict] = []

        for i, slot in enumerate(slots):
            slot_id = slot.get("slot_id", str(i))
            video_url: str = slot["video_url"]
            block: dict = slot.get("video_block", {"x": 0, "y": 0, "w": canvas_w, "h": canvas_h, "fit": "cover"})
            max_dur: float | None = float(slot["max_duration"]) if slot.get("max_duration") is not None else None
            # Per-slot audio params (fall back to global if absent)
            slot_source_volume = float(slot.get("music_source_volume", _global_music_source_volume))
            slot_mute_source = _to_bool(slot.get("music_mute_source", _global_music_mute_source), _global_music_mute_source)

            # Overlay: timed (overlay_urls + overlay_segments) or single (overlay_url)
            timed_slot = "overlay_urls" in slot
            if timed_slot:
                slot_overlay_urls: list[str | None] = slot["overlay_urls"]
                raw_slot_segs = slot["overlay_segments"]
                slot_segments = [
                    {"index": int(s["index"]), "start": float(s["start"]), "end": float(s["end"]) if s.get("end") is not None else None}
                    for s in raw_slot_segs
                ]
            else:
                overlay_url: str | None = slot.get("overlay_url")

            # Download video
            video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
            video_path = tmp_path / f"slot_{i}_video_{stamp}{video_ext}"
            print(f"[worker/render_sequence] slot={slot_id} Download video: {video_url}")
            _download_file(video_url, video_path)
            video_info = probe_video(video_path)
            if video_info.has_audio:
                any_audio = True
                if not slot_mute_source:
                    has_effective_audio = True

            # Collect per-slot music track params for time-varying volume.
            _clip_effective_dur = float(video_info.duration or 0.0)
            if max_dur is not None:
                _clip_effective_dur = min(_clip_effective_dur, max_dur)
            slot_audio_specs.append({
                "volume_db": slot.get("music_track_volume_db"),
                "fade_in": float(slot.get("music_track_fade_in", 0) or 0),
                "dur": _clip_effective_dur,
            })

            normalized_block = normalize_video_block(block, canvas_w, canvas_h)
            clip_path = tmp_path / f"clip_{i}_{stamp}.mp4"

            codec, codec_args, audio_codec, audio_args, _ = build_caption_encoding_settings(
                export_profile,
                video_info,
                use_nvenc=_nvenc_enabled(source="render_sequence"),
                preview=False,
                for_composite=True,
            )

            def _run_slot_ffmpeg(
                c: str,
                c_args: list[str],
                a_codec: str,
                a_args: list[str],
                v_path: Path = video_path,
                o_path: Path = clip_path,
                norm_block: dict = normalized_block,
                v_info=video_info,
                resolved_overlay_url: str | None = None if timed_slot else overlay_url,  # type: ignore[possibly-undefined]
                m_dur: float | None = max_dur,
                _i: int = i,
                _s_mute: bool = slot_mute_source,
                _s_vol: float = slot_source_volume,
            ) -> subprocess.CompletedProcess:
                if resolved_overlay_url:
                    overlay_path = tmp_path / f"slot_{_i}_overlay_{stamp}.png"
                    print(f"[worker/render_sequence] slot={slot_id} Download overlay: {resolved_overlay_url}")
                    _download_file(resolved_overlay_url, overlay_path)
                    cmd = build_template_ffmpeg_cmd(
                        video_path=v_path,
                        overlay_path=overlay_path,
                        out_path=o_path,
                        block=norm_block,
                        video_codec=c,
                        video_codec_args=c_args,
                        audio_codec=a_codec,
                        audio_codec_args=a_args,
                        max_duration=m_dur,
                        source_has_audio=v_info.has_audio,
                        mute_source=_s_mute,
                        source_volume=_s_vol,
                    )
                else:
                    cmd = build_template_ffmpeg_cmd_video_only(
                        video_path=v_path,
                        out_path=o_path,
                        block=norm_block,
                        video_codec=c,
                        video_codec_args=c_args,
                        audio_codec=a_codec,
                        audio_codec_args=a_args,
                        max_duration=m_dur,
                        source_has_audio=v_info.has_audio,
                        mute_source=_s_mute,
                        source_volume=_s_vol,
                    )
                print(f"[worker/render_sequence] slot={slot_id} FFmpeg cmd: {_format_command(cmd)}", flush=True)
                return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10 * 60)

            if timed_slot:
                # Timed overlays: build a sub-clip per segment, then concat them into clip_path
                seg_clip_paths: list[Path] = []
                for seg_i, seg in enumerate(slot_segments):  # type: ignore[possibly-undefined]
                    seg_overlay_url = slot_overlay_urls[seg["index"]] if slot_overlay_urls[seg["index"]] else None  # type: ignore[possibly-undefined]
                    seg_dur: float | None = (seg["end"] - seg["start"]) if seg["end"] is not None else None
                    if seg_dur is not None and max_dur is not None:
                        seg_dur = min(seg_dur, max_dur - seg["start"])
                    seg_out = tmp_path / f"slot_{i}_seg{seg_i}_{stamp}.mp4"

                    # Trim source video to the segment window
                    trim_path = tmp_path / f"slot_{i}_seg{seg_i}_trim_{stamp}.mp4"
                    trim_cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg["start"]),
                        *(["-t", str(seg_dur)] if seg_dur is not None else []),
                        "-i", str(video_path),
                        "-c", "copy",
                        str(trim_path),
                    ]
                    subprocess.run(trim_cmd, capture_output=True, check=True, timeout=2 * 60)

                    if seg_overlay_url:
                        seg_overlay_path = tmp_path / f"slot_{i}_seg{seg_i}_overlay_{stamp}.png"
                        _download_file(seg_overlay_url, seg_overlay_path)
                        seg_cmd = build_template_ffmpeg_cmd(
                            video_path=trim_path,
                            overlay_path=seg_overlay_path,
                            out_path=seg_out,
                            block=normalized_block,
                            video_codec=codec,
                            video_codec_args=codec_args,
                            audio_codec=audio_codec,
                            audio_codec_args=audio_args,
                            max_duration=None,
                            source_has_audio=video_info.has_audio,
                            mute_source=slot_mute_source,
                            source_volume=slot_source_volume,
                        )
                    else:
                        seg_cmd = build_template_ffmpeg_cmd_video_only(
                            video_path=trim_path,
                            out_path=seg_out,
                            block=normalized_block,
                            video_codec=codec,
                            video_codec_args=codec_args,
                            audio_codec=audio_codec,
                            audio_codec_args=audio_args,
                            max_duration=None,
                            source_has_audio=video_info.has_audio,
                            mute_source=slot_mute_source,
                            source_volume=slot_source_volume,
                        )
                    subprocess.run(seg_cmd, capture_output=True, check=True, timeout=10 * 60)
                    seg_clip_paths.append(seg_out)

                if len(seg_clip_paths) == 1:
                    clip_path = seg_clip_paths[0]
                else:
                    seg_concat_list = tmp_path / f"slot_{i}_segconcat_{stamp}.txt"
                    seg_concat_list.write_text(
                        "\n".join(f"file '{p.resolve()}'" for p in seg_clip_paths),
                        encoding="utf-8",
                    )
                    subprocess.run(
                        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(seg_concat_list), "-c", "copy", str(clip_path)],
                        capture_output=True, check=True, timeout=5 * 60
                    )
            else:
                try:
                    result = _run_slot_ffmpeg(codec, codec_args, audio_codec, audio_args)
                except subprocess.TimeoutExpired as exc:
                    raise RuntimeError(f"FFmpeg timeout pour le slot={slot_id}: {_format_command(exc.cmd)}") from exc

                if result.returncode != 0:
                    if codec == "h264_nvenc":
                        _mark_nvenc_runtime_failure(
                            "render_sequence/runtime",
                            command=result.args,
                            returncode=result.returncode,
                            stdout=result.stdout,
                            stderr=result.stderr,
                        )
                        print(f"[worker/render_sequence] NVENC failed for slot={slot_id}, retry with libx264")
                        fb_codec, fb_args, fb_audio_codec, fb_audio_args, _ = build_caption_encoding_settings(
                            export_profile, video_info, use_nvenc=False, preview=False, for_composite=True
                        )
                        try:
                            result = _run_slot_ffmpeg(fb_codec, fb_args, fb_audio_codec, fb_audio_args)
                        except subprocess.TimeoutExpired as exc:
                            raise RuntimeError(f"FFmpeg timeout (fallback) pour slot={slot_id}") from exc
                        if result.returncode != 0:
                            raise RuntimeError(f"FFmpeg error slot={slot_id} (libx264):\n{_trim_output(result.stderr)}")
                    else:
                        raise RuntimeError(f"FFmpeg error slot={slot_id} ({codec}):\n{_trim_output(result.stderr)}")

            clip_paths.append(clip_path)
            print(f"[worker/render_sequence] slot={slot_id} clip ready: {clip_path.name}")

        # ── Audio normalization: ensure all clips have audio when any clip does ─
        # FFmpeg concat demuxer (-c copy) requires identical stream layouts across
        # all input files.  If a source video has no audio track, that clip is
        # rendered without one, which causes the concat to lose audio for subsequent
        # clips (e.g. outro loses sound when a middle clip is silent).
        if any_audio:
            for ci, c_path in enumerate(clip_paths):
                c_info = probe_video(c_path)
                if not c_info.has_audio:
                    norm_path = tmp_path / f"clip_{ci}_anorm_{stamp}.mp4"
                    anorm_cmd = [
                        "ffmpeg", "-y",
                        "-i", str(c_path),
                        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                        "-map", "0:v",
                        "-map", "1:a",
                        "-ar", "48000", "-ac", "2",
                        "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "192k",
                        "-shortest",
                        str(norm_path),
                    ]
                    print(f"[worker/render_sequence] clip {ci} has no audio — adding silent track for stream consistency")
                    anorm_result = subprocess.run(
                        anorm_cmd, capture_output=True, text=True,
                        encoding="utf-8", errors="replace", timeout=5 * 60,
                    )
                    if anorm_result.returncode == 0:
                        clip_paths[ci] = norm_path
                    else:
                        print(f"[worker/render_sequence] audio norm failed for clip {ci} (continuing): {_trim_output(anorm_result.stderr)}")

        # ── Phase 2: Concatenate all clips ────────────────────────────────────
        combined_path = tmp_path / f"combined_{stamp}.mp4"
        if len(clip_paths) == 1:
            combined_path = clip_paths[0]
        else:
            concat_list_path = tmp_path / f"concat_{stamp}.txt"
            concat_list_path.write_text(
                "\n".join(f"file '{p.resolve()}'" for p in clip_paths),
                encoding="utf-8",
            )
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_list_path),
                "-c", "copy",
                str(combined_path),
            ]
            print(f"[worker/render_sequence] Concatenating {len(clip_paths)} clips")
            concat_result = subprocess.run(concat_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5 * 60)
            if concat_result.returncode != 0:
                raise RuntimeError(f"FFmpeg concat error:\n{_trim_output(concat_result.stderr)}")
            print(f"[worker/render_sequence] Concat done: {combined_path.name}")

        # ── Phase 3: Mix music (optional) ─────────────────────────────────────
        final_path = tmp_path / f"final_{stamp}.mp4"
        _music_warning: str | None = None
        if music_url:
            music_path = tmp_path / f"music_{stamp}.mp3"
            print(f"[worker/render_sequence] Download music: {music_url}")
            try:
                _download_file(music_url, music_path)
            except Exception as exc:
                print(f"[worker/render_sequence] Failed to download music, skipping: {exc}")
                _music_warning = f"Musique non disponible : {exc}"
                music_path = None  # type: ignore[assignment]

            if music_path and music_path.exists():
                combined_info = probe_video(combined_path)
                total_dur = combined_info.duration if combined_info.duration else None
                # Use the effective output duration for fade-out timing (accounts for global cap)
                effective_dur = (
                    min(total_dur, _global_max_duration)
                    if total_dur is not None and _global_max_duration is not None
                    else (_global_max_duration or total_dur)
                )

                music_vol_filter = build_music_track_filter(
                    music_input_index=1,
                    global_volume=_music_volume,
                    global_fade_in=_music_fade_in,
                    global_fade_out=_music_fade_out,
                    effective_dur=effective_dur,
                    slot_specs=slot_audio_specs,
                )

                if has_effective_audio:
                    # Per-slot source volumes are baked into clips — mix source at 1.0
                    audio_filter = f"[0:a]volume=1[va];{music_vol_filter}[msc];[va][msc]amix=inputs=2:duration=first[aout]"
                else:
                    audio_filter = f"{music_vol_filter}[aout]"

                loop_flags = ["-stream_loop", "-1"] if _music_loop else []
                # Use explicit -t instead of -shortest so that the afade filter
                # has enough time to ramp the music down to silence before FFmpeg
                # stops writing samples. -shortest would truncate the output at
                # the video end (= fade start), producing an abrupt cut.
                duration_flag = ["-t", f"{effective_dur:.4f}"] if effective_dur is not None else ["-shortest"]
                music_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(combined_path),
                    *loop_flags, "-i", str(music_path),
                    "-filter_complex", audio_filter,
                    "-map", "0:v",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k",
                    *duration_flag,
                    str(final_path),
                ]
                print(f"[worker/render_sequence] Music mix cmd: {_format_command(music_cmd)}", flush=True)
                music_result = subprocess.run(music_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5 * 60)
                if music_result.returncode != 0:
                    print(f"[worker/render_sequence] Music mix failed, using combined without music: {_trim_output(music_result.stderr)}")
                    final_path = combined_path
                else:
                    print(f"[worker/render_sequence] Music mix done: {final_path.name}")
            else:
                final_path = combined_path
        else:
            final_path = combined_path

        # ── Phase 4: Apply global max_duration cap (optional) ─────────────────
        if _global_max_duration is not None:
            capped_path = tmp_path / f"capped_{stamp}.mp4"
            cap_cmd = [
                "ffmpeg", "-y",
                "-i", str(final_path),
                "-t", str(_global_max_duration),
                "-c", "copy",
                str(capped_path),
            ]
            print(f"[worker/render_sequence] Applying global max_duration={_global_max_duration}s")
            cap_result = subprocess.run(cap_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5 * 60)
            if cap_result.returncode == 0:
                final_path = capped_path
            else:
                print(f"[worker/render_sequence] max_duration cap failed (non-fatal): {_trim_output(cap_result.stderr)}")

        # ── Phase 5: Upload to R2 ─────────────────────────────────────────────
        print(f"[worker/render_sequence] Uploading result to R2: {output_key}")
        public_url = _upload_to_r2(output_key, final_path, "video/mp4")

    print(f"[worker/render_sequence] Done — {public_url}")
    render_id: str = inp.get("render_id", "")
    seq_result: dict[str, Any] = {
        "video_url": public_url,
        "output_key": output_key,
        "render_id": render_id,
    }
    if _music_warning:
        seq_result["warnings"] = [_music_warning]
    return seq_result


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

    _require_fields(inp, ("audio_url", "output_key"), "transcribe")
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
        "job_id": job_id,
    }


# ─── Media autocut batch handler ─────────────────────────────────────────────

def _handle_media_autocut_batch(inp: dict) -> dict:
    """
    Analyse en lot N assets avec Whisper pour proposer des timings de coupe.
    Whisper est chargé une seule fois (cache worker) pour tout le pack.

    Input:
      batch_id   : MediaAutocutBatch.id (pour logs + webhook)
      language   : code langue (ex: "fr")
      model_size : modèle Whisper (défaut: "large-v3-turbo")
      assets     : [{ job_id, asset_url }, ...]  — max 20 items

    Output:
      {
        batch_id: str,
        results: [
          { job_id, proposed_start, proposed_end, transcript_json, language, fallback? }
          | { job_id, error: str }
        ]
      }
    """
    _require_fields(inp, ("assets",), "media_autocut_batch")
    batch_id: str = inp.get("batch_id", "unknown")
    language: str = inp.get("language", "fr")
    model_size: str = inp.get("model_size", "large-v3-turbo")
    assets: list[dict] = inp["assets"]

    print(
        f"[worker/media_autocut_batch] batch={batch_id} "
        f"assets={len(assets)} lang={language} model={model_size}",
        flush=True,
    )

    results: list[dict] = []

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        import time as _time

        for idx, asset in enumerate(assets):
            job_id: str = asset.get("job_id", f"unknown_{idx}")
            asset_url: str = asset.get("asset_url", "")

            if not asset_url:
                results.append({"job_id": job_id, "error": "asset_url manquant"})
                continue

            print(
                f"[worker/media_autocut_batch] [{idx+1}/{len(assets)}] job={job_id}",
                flush=True,
            )

            try:
                stamp = int(_time.time() * 1000)
                src_ext = Path(asset_url.split("?")[0]).suffix or ".mp4"
                src_path = tmp_path / f"asset_{stamp}_{idx}{src_ext}"

                _download_file(asset_url, src_path)

                result = analyze_autocut(
                    audio_path=src_path,
                    model_size=model_size,
                    language=language,
                )

                import json as _json
                results.append({
                    "job_id": job_id,
                    "proposed_start": result["proposed_start"],
                    "proposed_end": result["proposed_end"],
                    "transcript_json": _json.dumps(result["transcript_json"], ensure_ascii=False),
                    "language": result["language"],
                    "fallback": result["fallback"],
                })

            except Exception as e:
                err_msg = str(e)[:500]
                print(
                    f"[worker/media_autocut_batch] job={job_id} ERREUR: {err_msg}",
                    flush=True,
                )
                results.append({"job_id": job_id, "error": err_msg})

    success = sum(1 for r in results if "error" not in r)
    fail = len(results) - success
    print(
        f"[worker/media_autocut_batch] batch={batch_id} terminé — "
        f"{success} ok, {fail} erreur(s)",
        flush=True,
    )

    return {
        "batch_id": batch_id,
        "results": results,
    }


# ─── Media edit handler ───────────────────────────────────────────────────────

def _handle_media_edit(inp: dict) -> dict:
    """
    Edit a rush video: trim, mix-to-mono, loudnorm.

    Input:
      asset_url  : URL publique R2 du fichier source
      r2_key     : clé R2 du fichier (pour réécriture au même endroit)
      params     : { trimStart?, trimEnd?, mixToMono?, normalize? }
      job_id     : MediaEditJob.id (pour logs)

    Output:
      { duration: float, r2_key: str, video_url: str }

    Le fichier traité écrase l'original sur R2.
    """
    _require_fields(inp, ("asset_url", "r2_key", "params"), "media_edit")
    asset_url: str = inp["asset_url"]
    r2_key: str = inp["r2_key"]
    params: dict = inp["params"]
    job_id: str = inp.get("job_id", "unknown")

    print(f"[worker/media_edit] job={job_id} r2_key={r2_key} params={params}", flush=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        import time as _time
        stamp = int(_time.time() * 1000)

        # 1. Télécharger l'asset source
        src_ext = Path(asset_url.split("?")[0]).suffix or ".mp4"
        src_path = tmp_path / f"source_{stamp}{src_ext}"
        print(f"[worker/media_edit] Download: {asset_url}", flush=True)
        _download_file(asset_url, src_path)

        # 2. Traitement FFmpeg
        out_path = tmp_path / f"edited_{stamp}.mp4"
        result = process_media_edit(src_path, out_path, params)
        duration: float = result["duration"]

        # 3. Upload au même r2_key (écrasement)
        print(f"[worker/media_edit] Upload to R2: {r2_key}", flush=True)
        public_url = _upload_to_r2(r2_key, out_path, "video/mp4")

    print(f"[worker/media_edit] Done job={job_id} duration={duration:.2f}s url={public_url}", flush=True)
    return {
        "duration": duration,
        "r2_key": r2_key,
        "video_url": public_url,
        "job_id": job_id,
    }


if __name__ == "__main__":
    # ── Démarrage du worker : log GPU, check NVENC, lazy-load transcription ──    # Tout ce qui est fait ici tourne AVANT runpod.serverless.start(), donc hors billing job.
    # Les workers RunPod restent vivants entre les jobs (idle timeout). On garde un
    # probe NVENC au boot pour le diagnostic, mais Whisper passe en lazy-load par job.

    try:
        _log_worker_runtime_info()
    except Exception as _e:
        print(f"[worker] Runtime info: ignoré ({_e})", flush=True)

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
    #    Évite que le premier job captions/render_template subisse le délai du test d'encodage,
    #    mais un échec n'invalide plus tout le worker jusqu'à son redémarrage.
    try:
        _nvenc_ok = _nvenc_enabled(source="startup", force_refresh=True)
        print(f"[worker] NVENC: {'disponible ✓' if _nvenc_ok else 'indisponible → fallback libx264'}", flush=True)
    except Exception as _e:
        print(f"[worker] NVENC check: ignoré ({_e})", flush=True)

    # 3. Warmup transcription supprimé : Whisper/alignement restent lazy-load.
    print(
        "[worker] Warmup transcription: lazy-load activé — aucun modèle Whisper chargé au boot.",
        flush=True,
    )

    runpod.serverless.start({"handler": handler})

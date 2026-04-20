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
    # ── Démarrage du worker : log GPU, check NVENC, lazy-load transcription ──
    # Tout ce qui est fait ici tourne AVANT runpod.serverless.start(), donc hors billing job.
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

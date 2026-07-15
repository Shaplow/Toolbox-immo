from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import traceback
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app import FONTS_DIR, OUTPUTS_DIR, _parse_srt_content, _render_captions_preview, _render_captions_video, _resolve_captions_engine
from engine.fonts import list_font_names, scan_fonts
from engine.template_composite import (
    OverlaySegment,
    build_music_track_filter,
    build_template_ffmpeg_cmd,
    build_template_ffmpeg_cmd_timed,
    build_template_ffmpeg_cmd_video_only,
    normalize_video_block,
)
from engine.encoding_profiles import build_caption_encoding_settings
from engine.models import RenderConfig, WordTimestamp, default_premium_config
from engine.probe import probe_duration, probe_video
from engine.runtime_fonts import prepare_runtime_fonts

logger = logging.getLogger("render-engine")

app = FastAPI(title="Subtitle Engine API")

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error("Unhandled exception on %s:\n%s", request.url.path, tb)
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}\n{tb}"})

# job_id -> total_duration_ms (for progress percentage calculation)
_job_durations: dict[str, float] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # ancienne dev Vite
        "http://127.0.0.1:5173",
        "http://localhost:3000",   # Next.js dev
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/fonts", StaticFiles(directory=str(FONTS_DIR)), name="fonts")


def _local_outputs_path_from_url(value: str) -> Path | None:
    """Resolve URLs served by this API under /outputs to their local file path."""
    parsed = urlparse(value)
    raw_path = parsed.path if parsed.scheme else value
    if not raw_path.startswith("/outputs/"):
        return None

    output_root = OUTPUTS_DIR.resolve()
    candidate = (output_root / unquote(raw_path.removeprefix("/outputs/"))).resolve()
    try:
        candidate.relative_to(output_root)
    except ValueError:
        return None
    return candidate


def _parse_subtitles(upload: UploadFile, text: str) -> list[WordTimestamp]:
    suffix = Path(upload.filename or "subs.srt").suffix.lower()
    if suffix == ".srt" or "-->" in text:
        return _parse_srt_content(text)

    data = json.loads(text)
    words: list[WordTimestamp] = []
    if isinstance(data, list):
        for item in data:
            try:
                words.append(WordTimestamp(**item))
            except ValidationError:
                continue
    return words


def _parse_keywords(raw: str | None) -> list[str]:
    return [item.strip() for item in (raw or "").split(",") if item.strip()]


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _auto_glow_color(hex_color: str) -> str:
    """Auto glow color: same as the text color."""
    return hex_color if hex_color.startswith("#") else f"#{hex_color}"


def _build_config(cfg: dict[str, Any]) -> RenderConfig:
    base = cfg.get("base", {})
    highlight = cfg.get("highlight", {})
    highlight2 = cfg.get("highlight2", {})
    layout = cfg.get("layout", {})
    effects = cfg.get("effects", {})

    shadow_enabled = _to_bool(effects.get("shadow_enabled"), False)
    glow_enabled = _to_bool(effects.get("glow_enabled"), False)
    shadow_targets = effects.get("shadow_targets", {})  # {base, highlight, highlight2}
    glow_targets = effects.get("glow_targets", {})      # {base, highlight, highlight2}
    glow_color_auto = _to_bool(effects.get("glow_color_auto"), False)
    glow_color_fixed = effects.get("glow_color", "#FFFFFF")

    # ── Outline ───────────────────────────────────────────────────────────────
    outline_enabled = _to_bool(effects.get("outline_enabled"), False)
    outline_color   = effects.get("outline_color", "#000000")
    outline_width   = float(effects.get("outline_width", 3))
    outline_targets = effects.get("outline_targets", {})

    shadow_distance = float(effects.get("shadow_distance", 0.0)) if shadow_enabled else 0.0
    shadow_blur = float(effects.get("shadow_blur", 0.0)) if shadow_enabled else 0.0
    glow_intensity = float(effects.get("glow_intensity", 0.0)) if glow_enabled else 0.0

    base_shadow = shadow_distance if _to_bool(shadow_targets.get("base"), True) else 0.0
    base_shadow_blur = shadow_blur if _to_bool(shadow_targets.get("base"), True) else 0.0
    hl_shadow = shadow_distance if _to_bool(shadow_targets.get("highlight"), True) else 0.0
    hl_shadow_blur = shadow_blur if _to_bool(shadow_targets.get("highlight"), True) else 0.0
    hl2_shadow = shadow_distance if _to_bool(shadow_targets.get("highlight2"), True) else 0.0
    hl2_shadow_blur = shadow_blur if _to_bool(shadow_targets.get("highlight2"), True) else 0.0

    # Outline is only active when globally enabled AND the per-style target is on.
    # Width comes from the centralized effects slider (outline_width), not per-style fields.
    base_outline = outline_width if (outline_enabled and _to_bool(outline_targets.get("base"), True)) else 0.0
    hl_outline   = outline_width if (outline_enabled and _to_bool(outline_targets.get("highlight"), True)) else 0.0
    hl2_outline  = outline_width if (outline_enabled and _to_bool(outline_targets.get("highlight2"), True)) else 0.0

    base_glow = glow_intensity if _to_bool(glow_targets.get("base"), True) else 0.0
    hl_glow = glow_intensity if _to_bool(glow_targets.get("highlight"), True) else 0.0
    hl2_glow = glow_intensity if _to_bool(glow_targets.get("highlight2"), True) else 0.0

    animation_preset = cfg.get("animation", "reveal")
    if not _to_bool(cfg.get("animation_enabled"), True):
        animation_preset = "none"
    # Normalise old/removed presets → nearest equivalent
    if animation_preset not in ("none", "appear", "reveal", "word_pop"):
        animation_preset = "appear"

    keywords = _parse_keywords(cfg.get("highlight_keywords")) if _to_bool(cfg.get("highlight_enabled"), False) else []

    highlight2_enabled = _to_bool(highlight2.get("enabled"), False)
    highlight_style2 = {
        "font": highlight2.get("font", "Didot"),
        "size_ratio": float(highlight2.get("size_ratio", 0.068)),
        "bold": _to_bool(highlight2.get("bold"), False),
        "italic": _to_bool(highlight2.get("italic"), True),
        "text_transform": highlight2.get("text_transform", "none"),
        "color": highlight2.get("color", "#3AB8C8"),
        "spacing": float(highlight2.get("spacing", 0.0)),
        "outline": hl2_outline,
        "outline_color": outline_color,
        "shadow": hl2_shadow,
        "blur": 0.0,
        "shadow_color": effects.get("shadow_color", "#000000"),
        "shadow_alpha": float(effects.get("shadow_alpha", 0.45)),
        "shadow_angle": float(effects.get("shadow_angle", 90.0)),
        "shadow_blur": hl2_shadow_blur,
            "glow_color": _auto_glow_color(highlight2.get("color", "#3AB8C8")) if glow_color_auto else glow_color_fixed,
        "glow_intensity": hl2_glow,
    } if highlight2_enabled else None

    return RenderConfig(
        layout={
            "anchor": layout.get("anchor", "center"),
            "max_lines": int(layout.get("max_lines", 2)),
            "line_gap_ratio": float(layout.get("line_gap", 0.22)),
            "line_height_mode": layout.get("line_height_mode", "fixed_box"),
            "max_width_ratio": float(layout.get("max_width_ratio", 1.0)),
            "vertical_offset": float(layout.get("vertical_offset", 0.0)),
            "safe_area": {
                "left": float(layout.get("safe_left", 0.06)),
                "right": float(layout.get("safe_right", 0.06)),
                "top": float(layout.get("safe_top", 0.08)),
                "bottom": float(layout.get("safe_bottom", 0.18)),
            },
        },
        base_style={
            "font": base.get("font", "Playfair Display SemiBold"),
            "size_ratio": float(base.get("size_ratio", 0.062)),
            "bold": _to_bool(base.get("bold"), True),
            "italic": _to_bool(base.get("italic"), False),
            "text_transform": base.get("text_transform", "none"),
            "color": base.get("color", "#FFFFFF"),
            "spacing": float(base.get("spacing", 0.0)),
            "outline": base_outline,
            "outline_color": outline_color,
            "shadow": base_shadow,
            "blur": 0.0,
            "shadow_color": effects.get("shadow_color", "#000000"),
            "shadow_alpha": float(effects.get("shadow_alpha", 0.45)),
            "shadow_angle": float(effects.get("shadow_angle", 90.0)),
            "shadow_blur": base_shadow_blur,
            "glow_color": _auto_glow_color(base.get("color", "#FFFFFF")) if glow_color_auto else glow_color_fixed,
            "glow_intensity": base_glow,
        },
        highlight_style={
            "font": highlight.get("font", "Didot"),
            "size_ratio": float(highlight.get("size_ratio", 0.068)),
            "bold": _to_bool(highlight.get("bold"), False),
            "italic": _to_bool(highlight.get("italic"), True),
            "text_transform": highlight.get("text_transform", "none"),
            "color": highlight.get("color", "#C88B3A"),
            "spacing": float(highlight.get("spacing", 0.0)),
            "outline": hl_outline,
            "outline_color": outline_color,
            "shadow": hl_shadow,
            "blur": 0.0,
            "shadow_color": effects.get("shadow_color", "#000000"),
            "shadow_alpha": float(effects.get("shadow_alpha", 0.45)),
            "shadow_angle": float(effects.get("shadow_angle", 90.0)),
            "shadow_blur": hl_shadow_blur,
            "glow_color": _auto_glow_color(highlight.get("color", "#C88B3A")) if glow_color_auto else glow_color_fixed,
            "glow_intensity": hl_glow,
        },
        highlight_style2=highlight_style2,
        highlight={"mode": "keywords", "keywords": keywords},
        animation={"preset": animation_preset},
        block_rules={"pause_threshold": 0.5, "max_duration": 4.5},
        engine=_resolve_captions_engine(cfg.get("engine")),
    )


@app.post("/api/probe-duration")
async def api_probe_duration(request: Request):
    """Return the duration (seconds) of any media file reachable by ffprobe.

    Body JSON: { "url": "<http(s) or local path>" }
    Response:  { "duration": float } or { "duration": null } on failure.
    """
    body = await request.json()
    url = body.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    local_path = _local_outputs_path_from_url(url)
    duration = probe_duration(str(local_path)) if local_path and local_path.exists() else probe_duration(url)
    return {"duration": duration}


@app.post("/api/generate-poster")
async def api_generate_poster(request: Request):
    """Extract one lightweight JPEG poster frame from a video.

    Sert de fallback au backfill des posters manquants côté web (quand ffmpeg
    n'est pas installé dans le container web). Passe l'URL directement à ffmpeg
    (seek keyframe rapide via -ss avant -i), retente à 0s si le clip est plus
    court que le timestamp demandé.

    Body JSON : { "url": "<http(s) ou chemin local>", "at": 0.5, "width": 240 }
    Réponse   : image/jpeg (200) ou 422 si l'extraction échoue.
    """
    body = await request.json()
    url = body.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    at = float(body.get("at", 0.5))
    width = int(body.get("width", 240))

    local_path = _local_outputs_path_from_url(url)
    source = str(local_path) if local_path and local_path.exists() else url

    out_dir = OUTPUTS_DIR / "temp" / "posters"
    out_dir.mkdir(parents=True, exist_ok=True)
    frame_path = out_dir / f"poster_{int(time.time() * 1000)}.jpg"

    async def _extract(ss: float) -> bool:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(max(0.0, ss)),
            "-i", source,
            "-frames:v", "1",
            "-vf", f"scale={width}:-2",
            "-q:v", "6", "-an",
            str(frame_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=90)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            logger.warning("[poster] FFmpeg timeout for %s", url)
            return False
        if proc.returncode != 0 or not frame_path.exists() or frame_path.stat().st_size == 0:
            logger.warning("[poster] FFmpeg failed for %s — %s", url, stderr.decode(errors="replace")[-300:])
            return False
        return True

    ok = await _extract(at)
    if not ok:
        ok = await _extract(0.0)
    if not ok:
        raise HTTPException(status_code=422, detail="poster extraction failed")

    data = frame_path.read_bytes()
    try:
        frame_path.unlink()
    except OSError:
        pass
    return Response(content=data, media_type="image/jpeg")


@app.get("/api/render-progress/{job_id}")
def render_progress(job_id: str):
    """Returns 0.0-1.0 progress for an ongoing render job."""
    total_ms = _job_durations.get(job_id)
    if total_ms is None:
        return {"progress": 0.0, "found": False}

    work_dir = OUTPUTS_DIR / "temp" / "api"
    progress_file = work_dir / f"progress_{job_id}.txt"
    if not progress_file.exists():
        return {"progress": 0.0, "found": True}

    try:
        text = progress_file.read_text(encoding="utf-8", errors="ignore")
        # ffmpeg writes lines like: out_time_ms=400000
        # Note: ffmpeg's out_time_ms is actually in microseconds despite the name
        matches = re.findall(r"out_time_ms=(\d+)", text)
        if matches:
            out_us = int(matches[-1])  # microseconds
            out_ms = out_us / 1000.0
            progress = min(1.0, out_ms / total_ms) if total_ms > 0 else 0.0
            return {"progress": round(progress, 4), "found": True}
    except Exception:
        pass
    return {"progress": 0.0, "found": True}


@app.post("/api/render_template")
async def render_template_local(
    overlay: Optional[UploadFile] = File(None),
    video_block: str = Form(...),
    canvas_w: int = Form(1080),
    canvas_h: int = Form(1920),
    video_url: Optional[str] = Form(None),
    video: Optional[UploadFile] = File(None),
    # Optional timed overlays ─────────────────────────────────────────────────
    # When provided, `overlay` is ignored and multi-overlay mode is activated.
    # overlays_metadata: JSON array of {index, start, end} where end=null means
    # "until end of video".  overlay_0, overlay_1, ... are the corresponding PNGs.
    overlays_metadata: Optional[str] = Form(None),
    overlay_0: Optional[UploadFile] = File(None),
    overlay_1: Optional[UploadFile] = File(None),
    overlay_2: Optional[UploadFile] = File(None),
    overlay_3: Optional[UploadFile] = File(None),
    overlay_4: Optional[UploadFile] = File(None),
    overlay_5: Optional[UploadFile] = File(None),
    overlay_6: Optional[UploadFile] = File(None),
    overlay_7: Optional[UploadFile] = File(None),
    # Max output duration in seconds (optional, undefined = full source duration)
    max_duration: Optional[float] = Form(None),
    # Optional music/audio overlay ────────────────────────────────────────────
    music_url: Optional[str] = Form(None),
    music: Optional[UploadFile] = File(None),
    music_volume: Optional[float] = Form(None),
    music_source_volume: Optional[float] = Form(None),
    music_mute_source: Optional[str] = Form(None),
    music_loop: Optional[str] = Form(None),
    music_fade_in: Optional[float] = Form(None),
    music_fade_out: Optional[float] = Form(None),
):
    """
    Mode local (USE_RUNPOD=false) : composite overlay PNG sur la vidéo source via FFmpeg.
    La vidéo peut être fournie soit comme fichier upload (video=), soit comme URL distante (video_url=).

    Two overlay modes are supported:
    - Legacy (single overlay): pass `overlay` file.  max_duration is still honoured.
    - Timed (multi-overlay): pass `overlays_metadata` (JSON array) + overlay_0..N files.
      Each overlay PNG is applied only during its declared time window.
    """
    import subprocess
    import httpx

    if not video and not video_url:
        raise HTTPException(status_code=400, detail="Fournir 'video' (fichier) ou 'video_url'")

    # Determine overlay mode ────────────────────────────────────────────────────
    timed_mode = overlays_metadata is not None
    if not timed_mode and overlay is None:
        raise HTTPException(status_code=400, detail="Fournir 'overlay' ou 'overlays_metadata' + overlay_N")

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    video_path = work_dir / f"video_src_{stamp}.mp4"
    out_path = work_dir / f"composite_{stamp}.mp4"

    # Collect overlay files ────────────────────────────────────────────────────
    overlay_file_inputs = [overlay_0, overlay_1, overlay_2, overlay_3, overlay_4, overlay_5, overlay_6, overlay_7]
    tmp_overlay_paths: list[Path] = []

    if timed_mode:
        try:
            raw_segments = json.loads(overlays_metadata)  # type: ignore[arg-type]
            segments: list[OverlaySegment] = [
                OverlaySegment(index=int(s["index"]), start=float(s["start"]), end=float(s["end"]) if s.get("end") is not None else None)
                for s in raw_segments
            ]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"overlays_metadata JSON invalide : {exc}")

        # Build one file per unique state index (segments can reference the same
        # state multiple times; reading the same UploadFile twice returns b'').
        unique_indices = sorted(set(seg["index"] for seg in segments))
        for idx in unique_indices:
            upload = overlay_file_inputs[idx]
            if upload is None:
                raise HTTPException(status_code=400, detail=f"overlay_{idx} manquant pour l'état {idx}")
            p = work_dir / f"overlay_{stamp}_{idx}.png"
            content = await upload.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail=f"overlay_{idx} reçu vide (0 octets) — rendu Puppeteer probablement échoué")
            p.write_bytes(content)
            tmp_overlay_paths.append(p)
    else:
        # Legacy single-overlay
        overlay_path = work_dir / f"overlay_{stamp}.png"
        overlay_content = await overlay.read()  # type: ignore[union-attr]
        if len(overlay_content) == 0:
            raise HTTPException(status_code=400, detail="overlay reçu vide (0 octets) — rendu Puppeteer probablement échoué")
        overlay_path.write_bytes(overlay_content)
        tmp_overlay_paths.append(overlay_path)

    # Vidéo source : fichier uploadé ou téléchargement URL
    if video is not None:
        video_bytes = await video.read()
        logger.info("Received video upload: %d bytes", len(video_bytes))
        if len(video_bytes) == 0:
            raise HTTPException(status_code=400, detail="Fichier vidéo reçu vide (0 octets)")
        video_path.write_bytes(video_bytes)
    else:
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                resp = await client.get(video_url)
                resp.raise_for_status()
                video_path.write_bytes(resp.content)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Impossible de télécharger la vidéo : {exc}")

    try:
        block = json.loads(video_block)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="video_block JSON invalide")

    normalized_block = normalize_video_block(block, canvas_w, canvas_h)
    logger.info(
        "[render_template] Start composite stamp=%s canvas=%sx%s block=%sx%s@(%s,%s) fit=%s",
        stamp,
        normalized_block["canvas_w"],
        normalized_block["canvas_h"],
        normalized_block["w"],
        normalized_block["h"],
        normalized_block["x"],
        normalized_block["y"],
        normalized_block["fit"],
    )

    video_info = probe_video(video_path)
    _codec, _codec_args, _audio_codec, _audio_args, _ = build_caption_encoding_settings(
        "template",
        video_info,
        use_nvenc=False,
        preview=False,
        for_composite=True,
    )

    # ── Music audio overlay (optional) ────────────────────────────────────────
    music_path: Path | None = None
    _music_volume = music_volume if music_volume is not None else 0.3
    _music_source_volume = music_source_volume if music_source_volume is not None else 1.0
    _music_mute_source = _to_bool(music_mute_source, False)
    _music_loop = _to_bool(music_loop, False)
    _music_fade_in = music_fade_in if music_fade_in is not None else 0.0
    _music_fade_out = music_fade_out if music_fade_out is not None else 0.0

    if music is not None:
        music_path = work_dir / f"music_{stamp}.mp3"
        music_path.write_bytes(await music.read())
    elif music_url:
        music_path = work_dir / f"music_{stamp}.mp3"
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                resp = await client.get(music_url)
                resp.raise_for_status()
                music_path.write_bytes(resp.content)
        except Exception as exc:
            logger.warning("[render_template] Failed to download music: %s", exc)
            music_path = None

    music_opts = dict(
        music_path=str(music_path) if music_path else None,
        music_volume=_music_volume,
        source_volume=_music_source_volume,
        mute_source=_music_mute_source,
        music_loop=_music_loop,
        music_fade_in=_music_fade_in,
        music_fade_out=_music_fade_out,
    )

    if timed_mode:
        cmd = build_template_ffmpeg_cmd_timed(
            video_path=video_path,
            overlay_paths=tmp_overlay_paths,
            out_path=out_path,
            block=normalized_block,
            segments=segments,  # type: ignore[possibly-undefined]
            video_codec=_codec,
            video_codec_args=_codec_args,
            audio_codec=_audio_codec,
            audio_codec_args=_audio_args,
            max_duration=max_duration,
            **music_opts,
        )
    else:
        cmd = build_template_ffmpeg_cmd(
            video_path=video_path,
            overlay_path=tmp_overlay_paths[0],
            out_path=out_path,
            block=normalized_block,
            video_codec=_codec,
            video_codec_args=_codec_args,
            audio_codec=_audio_codec,
            audio_codec_args=_audio_args,
            max_duration=max_duration,
            **music_opts,
        )
    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=10 * 60,
        )
    except subprocess.TimeoutExpired:
        logger.error("[render_template] FFmpeg timeout stamp=%s", stamp)
        raise HTTPException(status_code=504, detail="FFmpeg timeout pendant le composite vidéo")

    if proc.returncode != 0:
        logger.error("[render_template] FFmpeg failed stamp=%s: %s", stamp, proc.stderr[-1200:])
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {proc.stderr[-800:]}")

    logger.info("[render_template] FFmpeg done stamp=%s output=%s size=%s", stamp, out_path.name, out_path.stat().st_size)

    # Nettoyage des inputs temporaires ; on garde l'output pour le servir via /outputs
    cleanup_files = [*tmp_overlay_paths, video_path]
    if music_path:
        cleanup_files.append(music_path)
    for tmp in cleanup_files:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    return {"videoUrl": f"/outputs/temp/api/{out_path.name}"}


@app.post("/api/render_sequence")
async def render_sequence_local(request: Request):
    """
    Mode local (USE_RUNPOD=false) : assemble a multi-clip video sequence.

    JSON body:
      canvas        : {width, height}
      slots         : list of slot objects:
        slot_id              : str
        video_url            : str
        video_block          : {x, y, w, h, fit}
        overlay_data?        : base64 PNG | null          — single overlay (legacy)
        overlay_data_list?   : list[base64 PNG | null]   — timed overlays
        overlay_segments?    : list[{index, start, end}]
        max_duration?        : float
        music_source_volume? : float  (default 1.0)
        music_mute_source?   : bool   (default false)
        music_start_at?      : float  (unused server-side for now)
        music_stop_at?       : float  (unused server-side for now)
      export_profile: "template" (default)
      music_url?    : URL of audio track to mix
      music_volume? : float (default 0.3)
      music_loop?   : bool
      music_fade_in?: float seconds
      music_fade_out?: float seconds

    Returns: {"videoUrl": "/outputs/..."}
    """
    import base64
    import subprocess as _sp
    import httpx

    body = await request.json()
    canvas: dict = body.get("canvas", {})
    slots: list[dict] = body.get("slots", [])
    export_profile = str(body.get("export_profile", "template") or "template")
    music_url: str | None = body.get("music_url")
    _music_volume = float(body.get("music_volume", 0.3))
    # Global fallbacks (kept for backward compat; per-slot values take precedence)
    _global_music_source_volume = float(body.get("music_source_volume", 1.0))
    _global_music_mute_source = bool(body.get("music_mute_source", False))
    _music_loop = bool(body.get("music_loop", False))
    _music_fade_in = float(body.get("music_fade_in", 0))
    _music_fade_out = float(body.get("music_fade_out", 0))
    _global_max_duration: float | None = float(body["max_duration"]) if body.get("max_duration") is not None else None

    canvas_w = int(canvas.get("width", 1080))
    canvas_h = int(canvas.get("height", 1920))

    if not slots:
        raise HTTPException(status_code=400, detail="'slots' est requis et ne peut pas être vide")

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)

    clip_paths: list[Path] = []
    any_audio = False
    final_path: Path | None = None
    # Per-slot music track params for time-varying volume expression.
    slot_audio_specs: list[dict] = []
    # Actual probed durations per slot_id — returned in the response so the web
    # layer can use them to compute caption exclude-zone boundaries precisely,
    # even when the template has no maxDuration configured on the slots.
    slot_durations: dict[str, float] = {}

    try:
        for i, slot in enumerate(slots):
            slot_id = slot.get("slot_id", str(i))
            video_url: str = slot["video_url"]
            block: dict = slot.get("video_block", {"x": 0, "y": 0, "w": canvas_w, "h": canvas_h, "fit": "cover"})
            max_dur: float | None = float(slot["max_duration"]) if slot.get("max_duration") is not None else None
            # Per-slot audio params
            slot_source_volume = float(slot.get("music_source_volume", _global_music_source_volume))
            slot_mute_source = bool(slot.get("music_mute_source", _global_music_mute_source))

            # Timed overlays vs single overlay
            timed_slot = "overlay_data_list" in slot
            if timed_slot:
                overlay_data_list: list[str | None] = slot["overlay_data_list"]
                raw_segments = slot["overlay_segments"]
                slot_segments = [
                    {"index": int(s["index"]), "start": float(s["start"]), "end": float(s["end"]) if s.get("end") is not None else None}
                    for s in raw_segments
                ]
            else:
                overlay_data: str | None = slot.get("overlay_data")  # base64 PNG or null

            # Download video
            video_ext = Path(video_url.split("?")[0]).suffix or ".mp4"
            video_path = work_dir / f"seq_{stamp}_slot{i}_video{video_ext}"
            try:
                async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                    resp = await client.get(video_url)
                    resp.raise_for_status()
                    video_path.write_bytes(resp.content)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Impossible de télécharger la vidéo du slot={slot_id}: {exc}")

            video_info = probe_video(video_path)
            if video_info.has_audio:
                any_audio = True

            # Collect per-slot music track params for time-varying volume.
            _clip_effective_dur = float(video_info.duration or 0.0)
            if max_dur is not None:
                _clip_effective_dur = min(_clip_effective_dur, max_dur)
            slot_durations[slot_id] = _clip_effective_dur
            slot_audio_specs.append({
                "volume_db": slot.get("music_track_volume_db"),
                "fade_in": float(slot.get("music_track_fade_in", 0) or 0),
                "fade_out": float(slot.get("music_track_fade_out", 0) or 0),
                "dur": _clip_effective_dur,
            })

            normalized_block = normalize_video_block(block, canvas_w, canvas_h)
            clip_path = work_dir / f"seq_{stamp}_clip{i}.mp4"

            _codec, _codec_args, _audio_codec, _audio_args, _ = build_caption_encoding_settings(
                export_profile, video_info, use_nvenc=False, preview=False, for_composite=True
            )

            if timed_slot:
                # Timed overlays : un SEUL ffmpeg call sur le clip complet via
                # build_template_ffmpeg_cmd_timed qui applique chaque overlay
                # avec enable='between(t,X,Y)'. Frame-precise par construction,
                # pas de trim+concat (qui accumulait des bugs : keyframe-snap
                # + "Stream specifier ':v' matches no streams").
                slot_overlay_paths: list[Path] = []
                for ovl_i, ovl_b64 in enumerate(overlay_data_list):  # type: ignore[possibly-undefined]
                    if ovl_b64 is None:
                        raise HTTPException(
                            status_code=500,
                            detail=f"slot {slot_id} : overlay index {ovl_i} est null — non supporté en timed mode",
                        )
                    ovl_path = work_dir / f"seq_{stamp}_slot{i}_overlay{ovl_i}.png"
                    ovl_path.write_bytes(base64.b64decode(ovl_b64))
                    slot_overlay_paths.append(ovl_path)

                seg_cmd = build_template_ffmpeg_cmd_timed(
                    video_path=video_path,
                    overlay_paths=slot_overlay_paths,
                    out_path=clip_path,
                    block=normalized_block,
                    segments=slot_segments,  # type: ignore[possibly-undefined]
                    video_codec=_codec, video_codec_args=_codec_args,
                    audio_codec=_audio_codec, audio_codec_args=_audio_args,
                    max_duration=max_dur,
                    source_has_audio=video_info.has_audio,
                    mute_source=slot_mute_source, source_volume=slot_source_volume,
                )
                proc = await asyncio.to_thread(_sp.run, seg_cmd, capture_output=True, text=True, timeout=10 * 60)
                if proc.returncode != 0:
                    raise HTTPException(status_code=500, detail=f"FFmpeg timed-overlay error slot={slot_id}: {proc.stderr[-800:]}")
            else:
                if overlay_data:  # type: ignore[possibly-undefined]
                    overlay_path = work_dir / f"seq_{stamp}_slot{i}_overlay.png"
                    overlay_path.write_bytes(base64.b64decode(overlay_data))
                    cmd = build_template_ffmpeg_cmd(
                        video_path=video_path, overlay_path=overlay_path, out_path=clip_path,
                        block=normalized_block, video_codec=_codec, video_codec_args=_codec_args,
                        audio_codec=_audio_codec, audio_codec_args=_audio_args,
                        max_duration=max_dur, source_has_audio=video_info.has_audio,
                        mute_source=slot_mute_source, source_volume=slot_source_volume,
                    )
                else:
                    cmd = build_template_ffmpeg_cmd_video_only(
                        video_path=video_path, out_path=clip_path,
                        block=normalized_block, video_codec=_codec, video_codec_args=_codec_args,
                        audio_codec=_audio_codec, audio_codec_args=_audio_args,
                        max_duration=max_dur, source_has_audio=video_info.has_audio,
                        mute_source=slot_mute_source, source_volume=slot_source_volume,
                    )

                logger.info("[render_sequence] slot=%s FFmpeg start", slot_id)
                try:
                    proc = await asyncio.to_thread(_sp.run, cmd, capture_output=True, text=True, timeout=10 * 60)
                except _sp.TimeoutExpired:
                    raise HTTPException(status_code=504, detail=f"FFmpeg timeout pour slot={slot_id}")
                if proc.returncode != 0:
                    raise HTTPException(status_code=500, detail=f"FFmpeg error slot={slot_id}: {proc.stderr[-800:]}")

            clip_paths.append(clip_path)
            logger.info("[render_sequence] slot=%s clip ready: %s", slot_id, clip_path.name)

        # ── Aggregate per-slot audio params ──────────────────────────────────
        # Per-slot muting and volume are already applied at clip encoding time.
        # At the concat+music mix stage, source audio is already correct per-clip.
        # Only suppress source entirely if ALL slots are muted (music-only sequence).
        effective_mute_source: bool = all(
            bool(s.get("music_mute_source", _global_music_mute_source))
            for s in slots
        )
        effective_source_volume: float = 1.0  # already handled per-clip above

        # ── Concat ────────────────────────────────────────────────────────────
        combined_path = work_dir / f"seq_{stamp}_combined.mp4"
        # Si un seul clip ET pas de cap global → réutilise direct.
        # Sinon, on doit re-encoder pour appliquer `-t _global_max_duration`
        # (canvas.maxDuration du template) qui tronque/pad la sortie finale.
        # Avant ce fix, `_global_max_duration` était lu mais jamais utilisé →
        # la vidéo finale gardait la durée native cumulée des clips, ignorant
        # le cap canvas configuré dans le builder.
        if len(clip_paths) == 1 and _global_max_duration is None:
            combined_path = clip_paths[0]
        else:
            concat_list = work_dir / f"seq_{stamp}_concat.txt"
            concat_list.write_text(
                "\n".join(f"file '{p.resolve()}'" for p in clip_paths),
                encoding="utf-8",
            )
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_list),
            ]
            # Cap final si canvas.maxDuration défini — re-encode requis
            # (le `-c copy` ne respecte pas `-t` strictement avec concat demuxer).
            if _global_max_duration is not None and _global_max_duration > 0:
                concat_cmd += ["-t", str(_global_max_duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac"]
            else:
                concat_cmd += ["-c", "copy"]
            concat_cmd.append(str(combined_path))
            try:
                proc = await asyncio.to_thread(_sp.run, concat_cmd, capture_output=True, text=True, timeout=5 * 60)
            except _sp.TimeoutExpired:
                raise HTTPException(status_code=504, detail="FFmpeg timeout pendant la concaténation")
            if proc.returncode != 0:
                raise HTTPException(status_code=500, detail=f"FFmpeg concat error: {proc.stderr[-800:]}")

        # ── Music mix ─────────────────────────────────────────────────────────
        final_path = combined_path
        if music_url:
            music_path = work_dir / f"seq_{stamp}_music.mp3"
            try:
                async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                    resp = await client.get(music_url)
                    resp.raise_for_status()
                    music_path.write_bytes(resp.content)
            except Exception as exc:
                logger.warning("[render_sequence] Failed to download music: %s", exc)
                music_path = None  # type: ignore[assignment]

            if music_path and music_path.exists():
                combined_info = probe_video(combined_path)
                total_dur = combined_info.duration if combined_info.duration else None
                # Use effective output duration for fade-out (accounts for global cap)
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
                if any_audio and not effective_mute_source:
                    source_filter = f"[0:a]volume={effective_source_volume}"
                    audio_filter = f"{source_filter}[va];{music_vol_filter}[msc];[va][msc]amix=inputs=2:duration=first[aout]"
                else:
                    audio_filter = f"{music_vol_filter}[aout]"
                loop_flags = ["-stream_loop", "-1"] if _music_loop else []
                # Use explicit -t instead of -shortest so that the afade filter
                # has enough time to ramp the music down to silence before FFmpeg
                # stops writing samples. -shortest would truncate the output at
                # the video end (= fade start), producing an abrupt cut.
                duration_flag = ["-t", f"{effective_dur:.4f}"] if effective_dur is not None else ["-shortest"]
                final_path = work_dir / f"seq_{stamp}_final.mp4"
                music_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(combined_path),
                    *loop_flags, "-i", str(music_path),
                    "-filter_complex", audio_filter,
                    "-map", "0:v", "-map", "[aout]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    *duration_flag, str(final_path),
                ]
                try:
                    proc = await asyncio.to_thread(_sp.run, music_cmd, capture_output=True, text=True, timeout=5 * 60)
                except _sp.TimeoutExpired:
                    logger.warning("[render_sequence] Music mix timeout, using combined without music")
                    final_path = combined_path
                if proc.returncode != 0:
                    logger.warning("[render_sequence] Music mix failed: %s", proc.stderr[-400:])
                    final_path = combined_path

        # ── Global max_duration cap (optional) ───────────────────────────────
        if _global_max_duration is not None:
            capped_path = work_dir / f"seq_{stamp}_capped.mp4"
            cap_cmd = [
                "ffmpeg", "-y",
                "-i", str(final_path),
                "-t", str(_global_max_duration),
                "-c", "copy",
                str(capped_path),
            ]
            try:
                proc = await asyncio.to_thread(_sp.run, cap_cmd, capture_output=True, text=True, timeout=5 * 60)
                if proc.returncode == 0:
                    final_path = capped_path
                else:
                    logger.warning("[render_sequence] max_duration cap failed (non-fatal): %s", proc.stderr[-400:])
            except _sp.TimeoutExpired:
                logger.warning("[render_sequence] max_duration cap timeout, skipping")

        return {"videoUrl": f"/outputs/temp/api/{final_path.name}", "slotDurations": slot_durations}

    finally:
        # Clean up intermediate files (clips, overlays, videos) but keep the final output
        for p in work_dir.glob(f"seq_{stamp}_slot*"):
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass
        for p in clip_paths:
            if final_path is None or p != final_path:
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass


@app.post("/api/transcribe")
async def transcribe_local(
    audio: UploadFile = File(...),
    model_size: str = Form("turbo"),
    language: str = Form("fr"),
    enable_diarization: str = Form("false"),
    hf_token: Optional[str] = Form(None),
):
    """
    Mode local (USE_RUNPOD=false) : transcription directe sans RunPod.
    Retourne le JSON des segments directement dans la réponse.

    Whisper est intégralement synchrone (CPU/GPU sans yield). On l'exécute
    dans asyncio.to_thread pour libérer l'event loop FastAPI pendant les
    minutes que dure la transcription — sinon TOUTES les autres requêtes
    (y compris /api/health et les jobs concurrents) seraient bloquées.
    """
    from engine.transcribe import transcribe_with_word_timestamps

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    suffix = Path(audio.filename or "audio.mp3").suffix.lower() or ".mp3"
    audio_path = work_dir / f"audio_{stamp}{suffix}"
    audio_path.write_bytes(await audio.read())

    try:
        segments = await asyncio.to_thread(
            transcribe_with_word_timestamps,
            audio_path=audio_path,
            model_size=str(model_size or "turbo"),
            language=str(language or "fr"),
            enable_diarization=_to_bool(enable_diarization, False),
            hf_token=hf_token or os.environ.get("HF_TOKEN") or None,
        )
    finally:
        audio_path.unlink(missing_ok=True)

    duration = segments[-1]["end"] if segments else 0.0
    has_diarization = any("speaker" in s for s in segments)

    return {
        "segments": segments,
        "segment_count": len(segments),
        "duration": duration,
        "language": language,
        "has_diarization": has_diarization,
    }


@app.post("/api/transcribe-multilingual")
async def transcribe_multilingual_local(
    audio: UploadFile = File(...),
    model_size: str = Form("turbo"),
    # Form-data n'accepte pas proprement un List[str] sur tous les clients ;
    # on prend une chaîne CSV "fr,zh" et on parse côté serveur. Le caller TS
    # doit envoyer `formData.append("languages", "fr,zh")`.
    languages: str = Form(...),
    enable_diarization: str = Form("false"),
    hf_token: Optional[str] = Form(None),
):
    """
    Mode local (USE_RUNPOD=false ou R2 non configuré) : transcription
    multi-langue directe via le worker Python sans RunPod. N passes Whisper
    avec langues forcées + fusion par avg_confidence (cf.
    transcribe_multilingual_with_word_timestamps).
    """
    from engine.transcribe import transcribe_multilingual_with_word_timestamps

    parsed_languages = [
        code.strip().lower()
        for code in (languages or "").split(",")
        if code.strip()
    ]
    if len(parsed_languages) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Le mode multi-langue exige au moins 2 codes ISO (reçu : '{languages}').",
        )

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    suffix = Path(audio.filename or "audio.mp3").suffix.lower() or ".mp3"
    audio_path = work_dir / f"audio_{stamp}{suffix}"
    audio_path.write_bytes(await audio.read())

    try:
        # Idem transcribe_local : on libère l'event loop pendant les N passes
        # Whisper (très long en multi). Sans ça /api/health et les autres jobs
        # restent muets le temps de la transcription.
        segments = await asyncio.to_thread(
            transcribe_multilingual_with_word_timestamps,
            audio_path=audio_path,
            languages=parsed_languages,
            model_size=str(model_size or "turbo"),
            enable_diarization=_to_bool(enable_diarization, False),
            hf_token=hf_token or os.environ.get("HF_TOKEN") or None,
        )
    finally:
        audio_path.unlink(missing_ok=True)

    duration = segments[-1]["end"] if segments else 0.0
    has_diarization = any("speaker" in s for s in segments)

    return {
        "segments": segments,
        "segment_count": len(segments),
        "duration": duration,
        "languages": parsed_languages,
        "has_diarization": has_diarization,
    }


@app.get("/api/health")
def health():
    return {"ok": True}


# ─── Cover frame extraction ───────────────────────────────────────────────────

# Simple disk cache: video_url hash → local path
_cover_video_cache: dict[str, Path] = {}


@app.post("/api/extract-covers")
async def extract_covers(
    timestamps_json: str = Form(...),
    video_url: Optional[str] = Form(None),
    video: Optional[UploadFile] = File(None),
):
    """
    Extrait des frames JPEG à des timestamps précis depuis une vidéo.
    La vidéo peut être fournie soit comme URL (video_url=) soit comme fichier uploadé (video=).
    Les vidéos distantes sont mises en cache localement par hash de l'URL.
    Retourne : [{timestamp: float, url: str}, ...]
    """
    import httpx

    if not video_url and not video:
        raise HTTPException(status_code=400, detail="Fournir 'video_url' ou 'video' (fichier)")

    try:
        raw = json.loads(timestamps_json)
        if not isinstance(raw, list):
            raise ValueError("timestamps must be a list")
        timestamps: list[float] = [float(t) for t in raw]
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"timestamps invalides : {exc}") from exc

    if not timestamps:
        raise HTTPException(status_code=400, detail="Au moins un timestamp est requis")

    # ── Locate the source video ────────────────────────────────────────────
    cache_dir = OUTPUTS_DIR / "temp" / "cover_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    if video is not None:
        # Fichier uploadé directement (dev local sans réseau cross-container)
        video_bytes = await video.read()
        if len(video_bytes) == 0:
            raise HTTPException(status_code=400, detail="Fichier vidéo reçu vide (0 octets)")
        url_hash = hashlib.sha256(video_bytes[:4096]).hexdigest()[:16]
        video_path = cache_dir / f"video_{url_hash}.mp4"
        if url_hash not in _cover_video_cache or not video_path.exists():
            video_path.write_bytes(video_bytes)
            _cover_video_cache[url_hash] = video_path
            logger.info("[covers] Received uploaded video → %s", video_path.name)
        else:
            logger.info("[covers] Using cached uploaded video %s", video_path.name)
    else:
        local_path = _local_outputs_path_from_url(video_url)
        if local_path and local_path.exists():
            video_path = local_path
            logger.info("[covers] Using local output video %s", video_path.name)
        else:
            # URL distante — mise en cache par hash de l'URL
            url_hash = hashlib.sha256(video_url.encode()).hexdigest()[:16]
            video_path = cache_dir / f"video_{url_hash}.mp4"
            if url_hash not in _cover_video_cache or not video_path.exists():
                logger.info("[covers] Downloading video %s → %s", video_url, video_path.name)
                try:
                    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
                        resp = await client.get(video_url)
                        resp.raise_for_status()
                        video_path.write_bytes(resp.content)
                except Exception as exc:
                    raise HTTPException(status_code=400, detail=f"Impossible de télécharger la vidéo : {exc}") from exc
                _cover_video_cache[url_hash] = video_path
            else:
                logger.info("[covers] Using cached video %s", video_path.name)

    # ── Extract frames with FFmpeg ─────────────────────────────────────────
    covers_dir = OUTPUTS_DIR / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    concurrency = max(1, min(8, int(os.environ.get("COVER_EXTRACT_CONCURRENCY", "4"))))
    per_frame_timeout = max(10, int(os.environ.get("COVER_EXTRACT_FRAME_TIMEOUT", "90")))
    semaphore = asyncio.Semaphore(concurrency)

    async def extract_one(ts: float) -> dict | None:
        async with semaphore:
            safe_ts = max(0.0, ts)
            frame_name = f"cover_{stamp}_{safe_ts:.3f}.jpg"
            frame_path = covers_dir / frame_name

            cmd = [
                "ffmpeg", "-y",
                "-ss", str(safe_ts),
                "-i", str(video_path),
                "-vframes", "1",
                "-q:v", "2",
                str(frame_path),
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=per_frame_timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                logger.warning("[covers] FFmpeg timeout at ts=%.3f after %ss", safe_ts, per_frame_timeout)
                return None

            if proc.returncode != 0 or not frame_path.exists():
                logger.warning(
                    "[covers] FFmpeg failed at ts=%.3f — %s",
                    safe_ts,
                    stderr.decode(errors="replace")[-300:],
                )
                return None

            return {"timestamp": safe_ts, "url": f"/outputs/covers/{frame_name}"}

    extracted = await asyncio.gather(*(extract_one(ts) for ts in timestamps))
    results = [frame for frame in extracted if frame is not None]

    return results


@app.get("/api/fonts")
def fonts():
    return {"fonts": list_font_names(FONTS_DIR)}


@app.get("/api/font-files")
def font_files():
    entries = scan_fonts(FONTS_DIR)
    return {
        "fonts": [
            {
                "family": entry.name,
                "filename": entry.path.name,
                "url": f"/fonts/{entry.path.name}",
            }
            for entry in entries
        ]
    }


@app.get("/api/default-config")
def default_config():
    cfg = default_premium_config()
    return {
        "base": {
            "font": cfg.base_style.font,
            "size_ratio": cfg.base_style.size_ratio,
            "bold": cfg.base_style.bold,
            "italic": cfg.base_style.italic,
            "text_transform": cfg.base_style.text_transform,
            "color": cfg.base_style.color,
            "spacing": 0.0,
            "outline": 0.0,
        },
        "highlight": {
            "font": cfg.highlight_style.font,
            "size_ratio": cfg.highlight_style.size_ratio,
            "bold": cfg.highlight_style.bold,
            "italic": cfg.highlight_style.italic,
            "text_transform": cfg.highlight_style.text_transform,
            "color": cfg.highlight_style.color,
            "spacing": 0.0,
            "outline": 0.0,
        },
        "highlight2": {
            "enabled": False,
            "font": cfg.highlight_style.font,
            "size_ratio": cfg.highlight_style.size_ratio,
            "bold": False,
            "italic": True,
            "text_transform": "none",
            "color": "#3AB8C8",
            "spacing": 0.0,
            "outline": 0.0,
        },
        "layout": {
            "anchor": cfg.layout.anchor,
            "max_lines": cfg.layout.max_lines,
            "line_gap": cfg.layout.line_gap_ratio,
            "line_height_mode": cfg.layout.line_height_mode,
            "max_width_ratio": 1.0,
            "vertical_offset": 0.0,
            "safe_left": cfg.layout.safe_area.left,
            "safe_right": cfg.layout.safe_area.right,
            "safe_top": cfg.layout.safe_area.top,
            "safe_bottom": cfg.layout.safe_area.bottom,
            "auto_safe_area": True,
        },
        "effects": {
            "shadow_enabled": False,
            "shadow_distance": 0.0,
            "shadow_blur": 0.0,
            "shadow_angle": 90.0,
            "shadow_alpha": 0.45,
            "shadow_color": "#000000",
            "shadow_targets": {"base": True, "highlight": True, "highlight2": True},
            "glow_enabled": False,
            "glow_color": "#FFFFFF",
            "glow_color_auto": False,
            "glow_targets": {"base": True, "highlight": True, "highlight2": True},
            "glow_intensity": 0.0,
        },
        "animation": "reveal",
        "animation_enabled": True,
        "highlight_enabled": False,
        "highlight_keywords": "",
        "export_profile": "balanced",
        "preview_time": 0.0,
    }


@app.post("/api/preview")
async def preview(
    video: UploadFile = File(...),
    subtitles: UploadFile = File(...),
    config: str = Form(...),
):
    try:
        cfg_dict = json.loads(config)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {exc}")

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    video_path = work_dir / f"video_{stamp}{Path(video.filename or 'video.mp4').suffix or '.mp4'}"
    subs_path = work_dir / f"subs_{stamp}{Path(subtitles.filename or 'captions.srt').suffix or '.srt'}"

    video_path.write_bytes(await video.read())
    subs_text = (await subtitles.read()).decode("utf-8", errors="ignore")
    subs_path.write_text(subs_text, encoding="utf-8")

    words = _parse_subtitles(subtitles, subs_text)
    if not words:
        raise HTTPException(status_code=400, detail="No subtitle words parsed")

    cfg = _build_config(cfg_dict)
    runtime_fonts_dir = prepare_runtime_fonts(FONTS_DIR, work_dir, cfg_dict.get("font_assets"))
    auto_safe = _to_bool(cfg_dict.get("layout", {}).get("auto_safe_area"), True)

    logger.info(
        "Preview request: engine=%s preset=%s words=%d auto_safe=%s",
        cfg.engine,
        cfg.animation.preset,
        len(words),
        auto_safe,
    )

    preview_time = float(cfg_dict.get("preview_time", 0.0) or 0.0)
    if preview_time <= 0:
        preview_time = max(0.0, words[0].start + 0.05)

    out_image = work_dir / f"preview_{stamp}.png"
    try:
        ass_path = _render_captions_preview(
            words,
            video_path,
            cfg,
            output_image=out_image,
            at_seconds=preview_time,
            auto_safe_area=auto_safe,
            fonts_dir=runtime_fonts_dir,
        )
    except CairoRendererNotReadyError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    response = {"imageUrl": f"/outputs/temp/api/{out_image.name}", "engine": cfg.engine}
    if ass_path is not None:
        response["assPath"] = str(ass_path)
    return response


@app.post("/api/render")
async def render(
    video: UploadFile = File(...),
    subtitles: UploadFile = File(...),
    config: str = Form(...),
    preview_mode: str = Form("true"),
    job_id: str = Form(""),
):
    try:
        cfg_dict = json.loads(config)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {exc}")

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    video_path = work_dir / f"video_{stamp}{Path(video.filename or 'video.mp4').suffix or '.mp4'}"
    subs_path = work_dir / f"subs_{stamp}{Path(subtitles.filename or 'captions.srt').suffix or '.srt'}"

    video_path.write_bytes(await video.read())
    subs_text = (await subtitles.read()).decode("utf-8", errors="ignore")
    subs_path.write_text(subs_text, encoding="utf-8")

    words = _parse_subtitles(subtitles, subs_text)
    if not words:
        raise HTTPException(status_code=400, detail="No subtitle words parsed")

    cfg = _build_config(cfg_dict)
    runtime_fonts_dir = prepare_runtime_fonts(FONTS_DIR, work_dir, cfg_dict.get("font_assets"))
    auto_safe = _to_bool(cfg_dict.get("layout", {}).get("auto_safe_area"), True)

    is_preview = _to_bool(preview_mode, True)
    export_profile = str(cfg_dict.get("export_profile", "balanced") or "balanced")
    out_video = work_dir / (f"render_{stamp}_preview.mp4" if is_preview else f"render_{stamp}_full.mp4")

    logger.info(
        "Render request: engine=%s preset=%s words=%d preview=%s profile=%s auto_safe=%s",
        cfg.engine,
        cfg.animation.preset,
        len(words),
        is_preview,
        export_profile,
        auto_safe,
    )

    # Set up progress tracking if a job_id was provided
    progress_path = None
    if job_id:
        try:
            info = probe_video(video_path)
            duration_s = min(info.duration, 6.0) if is_preview else info.duration
            _job_durations[job_id] = duration_s * 1000.0  # store as ms
        except Exception:
            pass
        progress_path = work_dir / f"progress_{job_id}.txt"

    try:
        ass_path = await asyncio.to_thread(
            _render_captions_video,
            words,
            video_path,
            cfg,
            out_video,
            auto_safe,
            runtime_fonts_dir,
            is_preview,
            6,
            export_profile,
            progress_path,
        )
    except CairoRendererNotReadyError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    finally:
        if job_id and job_id in _job_durations:
            del _job_durations[job_id]
        if progress_path and progress_path.exists():
            try:
                progress_path.unlink()
            except Exception:
                pass

    response = {"videoUrl": f"/outputs/temp/api/{out_video.name}", "engine": cfg.engine}
    if ass_path is not None:
        response["assPath"] = str(ass_path)
    return response

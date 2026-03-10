from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import traceback
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app import FONTS_DIR, OUTPUTS_DIR, _parse_srt_content, _render_ass
from engine.fonts import list_font_names
from engine.models import RenderConfig, WordTimestamp, default_premium_config
from engine.probe import probe_video
from engine.render import burn_subtitles, render_preview_frame

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

    keywords = _parse_keywords(cfg.get("highlight_keywords"))

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
    }

    return RenderConfig(
        layout={
            "anchor": layout.get("anchor", "center"),
            "max_lines": int(layout.get("max_lines", 2)),
            "line_gap_ratio": float(layout.get("line_gap", 0.22)),
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
    )


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
    overlay: UploadFile = File(...),
    video_block: str = Form(...),
    canvas_w: int = Form(1080),
    canvas_h: int = Form(1920),
    video_url: Optional[str] = Form(None),
    video: Optional[UploadFile] = File(None),
):
    """
    Mode local (USE_RUNPOD=false) : composite overlay PNG sur la vidéo source via FFmpeg.
    La vidéo peut être fournie soit comme fichier upload (video=), soit comme URL distante (video_url=).
    """
    import subprocess
    import httpx

    if not video and not video_url:
        raise HTTPException(status_code=400, detail="Fournir 'video' (fichier) ou 'video_url'")

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    overlay_path = work_dir / f"overlay_{stamp}.png"
    video_path = work_dir / f"video_src_{stamp}.mp4"
    out_path = work_dir / f"composite_{stamp}.mp4"

    # Écrire l'overlay PNG
    overlay_path.write_bytes(await overlay.read())

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

    x = int(block["x"])
    y = int(block["y"])
    w = int(block["w"])
    h = int(block["h"])

    # Forcer dimensions paires (requis par libx264/h264_nvenc)
    canvas_w = canvas_w if canvas_w % 2 == 0 else canvas_w + 1
    canvas_h = canvas_h if canvas_h % 2 == 0 else canvas_h + 1

    # Clamp le bloc vidéo au canvas (évite overflow du pad)
    x = max(0, x)
    y = max(0, y)
    w = max(2, min(w if w % 2 == 0 else w + 1, canvas_w - x))
    h = max(2, min(h if h % 2 == 0 else h + 1, canvas_h - y))

    fit = block.get("fit", "cover")

    # Scale + crop selon focal point pour remplir le bloc (cover), puis composite sur canvas noir + overlay
    if fit == "contain":
        scale_crop = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
    else:  # cover — crop décalé selon le point focal
        crop_x = float(block.get("crop_x", 0.5))
        crop_y = float(block.get("crop_y", 0.5))
        scale_crop = (
            f"scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}:(iw-{w})*{crop_x}:(ih-{h})*{crop_y}"
        )

    filter_complex = (
        f"color=c=black:s={canvas_w}x{canvas_h}:r=30[bg];"
        f"[0:v]{scale_crop},format=yuv420p[vid];"
        f"[bg][vid]overlay=x={x}:y={y}[base];"
        f"[base][1:v]overlay=0:0,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2[out]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(overlay_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-shortest",  # s'arrête quand le flux le plus court (la vidéo) se termine
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k",
        str(out_path),
    ]
    proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {proc.stderr[-800:]}")

    # Retourner les bytes directement — évite les URL inter-containers inaccessibles depuis le browser
    video_bytes = out_path.read_bytes()

    # Nettoyage des fichiers temporaires
    for tmp in (overlay_path, video_path, out_path):
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    return StreamingResponse(
        iter([video_bytes]),
        media_type="video/mp4",
        headers={"Content-Length": str(len(video_bytes))},
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/fonts")
def fonts():
    return {"fonts": list_font_names(FONTS_DIR)}


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
    ass_path = _render_ass(words, video_path, cfg, auto_safe_area=_to_bool(cfg_dict.get("layout", {}).get("auto_safe_area"), True))

    preview_time = float(cfg_dict.get("preview_time", 0.0) or 0.0)
    if preview_time <= 0:
        preview_time = max(0.0, words[0].start + 0.05)

    out_image = work_dir / f"preview_{stamp}.png"
    render_preview_frame(video_path, ass_path, out_image, FONTS_DIR, preview_time)

    return {"imageUrl": f"/outputs/temp/api/{out_image.name}", "assPath": str(ass_path)}


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
    ass_path = _render_ass(words, video_path, cfg, auto_safe_area=_to_bool(cfg_dict.get("layout", {}).get("auto_safe_area"), True))

    is_preview = _to_bool(preview_mode, True)
    export_profile = str(cfg_dict.get("export_profile", "balanced") or "balanced")
    out_video = work_dir / (f"render_{stamp}_preview.mp4" if is_preview else f"render_{stamp}_full.mp4")

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
        await asyncio.to_thread(
            burn_subtitles, video_path, ass_path, out_video, FONTS_DIR,
            preview=is_preview, preview_seconds=6,
            quality_profile=export_profile,
            progress_path=progress_path,
        )
    finally:
        if job_id and job_id in _job_durations:
            del _job_durations[job_id]
        if progress_path and progress_path.exists():
            try:
                progress_path.unlink()
            except Exception:
                pass

    return {"videoUrl": f"/outputs/temp/api/{out_video.name}", "assPath": str(ass_path)}

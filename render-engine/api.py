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

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app import FONTS_DIR, OUTPUTS_DIR, _parse_srt_content, _render_captions_preview, _render_captions_video, _resolve_captions_engine
from engine.fonts import list_font_names, scan_fonts
from engine.template_composite import (
    OverlaySegment,
    build_template_ffmpeg_cmd,
    build_template_ffmpeg_cmd_timed,
    normalize_video_block,
)
from engine.encoding_profiles import build_caption_encoding_settings
from engine.models import RenderConfig, WordTimestamp, default_premium_config
from engine.probe import probe_video
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

        for i, seg in enumerate(segments):
            upload = overlay_file_inputs[seg["index"]]
            if upload is None:
                raise HTTPException(status_code=400, detail=f"overlay_{seg['index']} manquant pour le segment {i}")
            p = work_dir / f"overlay_{stamp}_{seg['index']}.png"
            p.write_bytes(await upload.read())
            tmp_overlay_paths.append(p)
    else:
        # Legacy single-overlay
        overlay_path = work_dir / f"overlay_{stamp}.png"
        overlay_path.write_bytes(await overlay.read())  # type: ignore[union-attr]
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
    """
    import json as _json
    from engine.transcribe import transcribe_with_word_timestamps

    work_dir = OUTPUTS_DIR / "temp" / "api"
    work_dir.mkdir(parents=True, exist_ok=True)

    stamp = int(time.time() * 1000)
    suffix = Path(audio.filename or "audio.mp3").suffix.lower() or ".mp3"
    audio_path = work_dir / f"audio_{stamp}{suffix}"
    audio_path.write_bytes(await audio.read())

    try:
        segments = transcribe_with_word_timestamps(
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
    results: list[dict] = []

    for ts in timestamps:
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
        _, stderr = await proc.communicate()

        if proc.returncode != 0 or not frame_path.exists():
            logger.warning(
                "[covers] FFmpeg failed at ts=%.3f — %s",
                safe_ts,
                stderr.decode(errors="replace")[-300:],
            )
            continue

        results.append({"timestamp": safe_ts, "url": f"/outputs/covers/{frame_name}"})

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

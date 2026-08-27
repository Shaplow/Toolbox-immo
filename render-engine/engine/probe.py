from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class VideoInfo:
    width: int
    height: int
    duration: float
    video_bitrate: int | None = None
    container_bitrate: int | None = None
    fps: float | None = None
    has_audio: bool = False
    # ── Colorimetry (garde-fou HDR — voir engine.color) ────────────────────────
    # None = untagged source (ffprobe omits the key when the container carries
    # no explicit colorimetry metadata) — never treated as HDR by is_hdr().
    pix_fmt: str | None = None
    color_transfer: str | None = None
    color_primaries: str | None = None
    color_space: str | None = None


def _probe_has_audio(video_path: str) -> bool:
    """Return True if the file contains at least one audio stream."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=index",
                "-of", "json",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return False
        return bool(json.loads(result.stdout).get("streams"))
    except Exception:
        return False


def probe_video(video_path: str | Path) -> VideoInfo:
    video_path = str(video_path)
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,bit_rate,avg_frame_rate,r_frame_rate,"
        "pix_fmt,color_transfer,color_primaries,color_space",
        "-show_entries",
        "format=duration,bit_rate",
        "-of",
        "json",
        video_path,
    ]
    # timeout obligatoire : sans lui, un ffprobe sur une URL distante injoignable
    # bloque indéfiniment (les deux autres probes du module en ont déjà un).
    result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=30)
    data = json.loads(result.stdout)

    stream = data["streams"][0]
    duration = float(data.get("format", {}).get("duration", 0.0))
    video_bitrate = stream.get("bit_rate")
    container_bitrate = data.get("format", {}).get("bit_rate")
    avg_frame_rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
    fps = None
    if isinstance(avg_frame_rate, str) and avg_frame_rate and avg_frame_rate != "0/0":
        num, _, den = avg_frame_rate.partition("/")
        try:
            denominator = float(den or "1")
            if denominator != 0:
                fps = float(num) / denominator
        except ValueError:
            fps = None

    def _color_field(key: str) -> str | None:
        # ffprobe omits unset colorimetry keys entirely; some builds emit the
        # literal string "unknown" instead. Both mean "untagged source".
        value = stream.get(key)
        if not isinstance(value, str):
            return None
        value = value.strip().lower()
        return value if value and value != "unknown" else None

    return VideoInfo(
        width=int(stream["width"]),
        height=int(stream["height"]),
        duration=duration,
        video_bitrate=int(video_bitrate) if video_bitrate else None,
        container_bitrate=int(container_bitrate) if container_bitrate else None,
        fps=fps,
        has_audio=_probe_has_audio(video_path),
        pix_fmt=_color_field("pix_fmt"),
        color_transfer=_color_field("color_transfer"),
        color_primaries=_color_field("color_primaries"),
        color_space=_color_field("color_space"),
    )


def probe_duration(url: str) -> float | None:
    """Return the duration in seconds of any media file (audio or video) at *url*.

    Works with local paths and remote HTTPS URLs.
    Returns None if ffprobe fails or the duration cannot be read.
    """
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        raw = json.loads(result.stdout).get("format", {}).get("duration")
        if raw is None:
            return None
        d = float(raw)
        return d if d > 0 else None
    except Exception:
        return None

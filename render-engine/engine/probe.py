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


def probe_video(video_path: str | Path) -> VideoInfo:
    video_path = str(video_path)
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,bit_rate,avg_frame_rate,r_frame_rate",
        "-show_entries",
        "format=duration,bit_rate",
        "-of",
        "json",
        video_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
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

    return VideoInfo(
        width=int(stream["width"]),
        height=int(stream["height"]),
        duration=duration,
        video_bitrate=int(video_bitrate) if video_bitrate else None,
        container_bitrate=int(container_bitrate) if container_bitrate else None,
        fps=fps,
    )

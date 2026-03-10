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


def probe_video(video_path: str | Path) -> VideoInfo:
    video_path = str(video_path)
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        video_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)

    stream = data["streams"][0]
    duration = float(data.get("format", {}).get("duration", 0.0))
    return VideoInfo(width=int(stream["width"]), height=int(stream["height"]), duration=duration)

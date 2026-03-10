from __future__ import annotations

import subprocess
from pathlib import Path


def _escape_filter_path(path: str | Path) -> str:
    normalized = str(Path(path).resolve()).replace("\\", "/")
    normalized = normalized.replace(":", r"\:")
    normalized = normalized.replace("'", r"\'")
    return normalized


def burn_subtitles(
    input_video: str | Path,
    ass_file: str | Path,
    output_video: str | Path,
    fonts_dir: str | Path,
    preview: bool = False,
    preview_seconds: int = 10,
    quality_profile: str = "balanced",
    progress_path: str | Path | None = None,
    video_codec: str | None = None,
    video_codec_args: list[str] | None = None,
) -> Path:
    input_video = Path(input_video)
    ass_file = Path(ass_file)
    output_video = Path(output_video)
    fonts_dir = Path(fonts_dir)
    output_video.parent.mkdir(parents=True, exist_ok=True)

    ass_path = _escape_filter_path(ass_file)
    fonts_path = _escape_filter_path(fonts_dir)
    subtitles_filter = f"subtitles='{ass_path}':fontsdir='{fonts_path}'"

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_video),
    ]

    if preview:
        command.extend(["-t", str(preview_seconds)])

    # Codec override (ex: h264_nvenc depuis le worker RunPod) ou libx264 par défaut
    if video_codec and video_codec_args is not None:
        codec_flags = ["-c:v", video_codec, *video_codec_args]
    else:
        quality = (quality_profile or "balanced").strip().lower()
        if quality == "draft":
            preset, crf = "ultrafast", "28"
        elif quality == "final":
            preset, crf = "slow", "16"  # cible Instagram : qualité maximale
        else:
            preset, crf = "faster", "22"
        codec_flags = [
            "-c:v", "libx264",
            "-preset", "veryfast" if preview else preset,
            "-crf", "23" if preview else crf,
            "-movflags", "+faststart",
        ]

    command.extend(
        [
            "-vf",
            subtitles_filter,
            *codec_flags,
            "-c:a",
            "copy",
        ]
    )

    if progress_path is not None:
        command.extend(["-progress", str(progress_path), "-nostats"])

    command.append(str(output_video))
    subprocess.run(command, check=True)
    return output_video


def render_preview_frame(
    input_video: str | Path,
    ass_file: str | Path,
    output_image: str | Path,
    fonts_dir: str | Path,
    at_seconds: float = 1.0,
) -> Path:
    input_video = Path(input_video)
    ass_file = Path(ass_file)
    output_image = Path(output_image)
    fonts_dir = Path(fonts_dir)
    output_image.parent.mkdir(parents=True, exist_ok=True)

    ass_path = _escape_filter_path(ass_file)
    fonts_path = _escape_filter_path(fonts_dir)
    subtitles_filter = f"subtitles='{ass_path}':fontsdir='{fonts_path}'"

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_video),
        "-ss",
        f"{max(0.0, at_seconds):.2f}",
        "-vf",
        subtitles_filter,
        "-frames:v",
        "1",
        "-update",
        "1",
        str(output_image),
    ]
    subprocess.run(command, check=True)
    return output_image

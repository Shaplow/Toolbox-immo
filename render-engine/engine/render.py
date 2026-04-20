from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Sequence


def _run_ffmpeg(command: list[str]) -> None:
    subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _escape_filter_path(path: str | Path) -> str:
    normalized = str(Path(path).resolve()).replace("\\", "/")
    normalized = normalized.replace(":", r"\:")
    normalized = normalized.replace("'", r"\'")
    return normalized


def _escape_concat_path(path: str | Path) -> str:
    normalized = str(Path(path).resolve()).replace("\\", "/")
    return normalized.replace("'", r"\'")


def _video_codec_flags(
    preview: bool,
    quality_profile: str,
    video_codec: str | None,
    video_codec_args: list[str] | None,
) -> list[str]:
    if video_codec and video_codec_args is not None:
        return ["-c:v", video_codec, *video_codec_args]

    quality = (quality_profile or "balanced").strip().lower()
    if quality == "draft":
        preset, crf = "ultrafast", "28"
    elif quality == "final":
        preset, crf = "slow", "16"
    else:
        preset, crf = "faster", "22"

    return [
        "-c:v", "libx264",
        "-preset", "veryfast" if preview else preset,
        "-crf", "23" if preview else crf,
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
    ]


def _audio_codec_flags(audio_codec: str | None, audio_codec_args: list[str] | None) -> list[str]:
    if audio_codec and audio_codec_args is not None:
        return ["-c:a", audio_codec, *audio_codec_args]
    return ["-c:a", "copy"]


def _overlay_filter_chain(overlays: Sequence[tuple[str | Path, float, float, float]]) -> tuple[str, str]:
    filter_parts: list[str] = []
    current = "[0:v]"
    for input_index, (_, start, end, fade_in) in enumerate(overlays, start=1):
        overlay_input = f"[{input_index}:v]"
        if fade_in > 0.0:
            prepared_input = f"[ov{input_index}]"
            filter_parts.append(
                f"{overlay_input}format=rgba,fade=t=in:st=0:d={fade_in:.3f}:alpha=1,"
                f"setpts=PTS+{max(0.0, start):.3f}/TB{prepared_input}"
            )
            overlay_input = prepared_input
        out_label = f"[v{input_index}]"
        enable = f"between(t,{max(0.0, start):.3f},{max(start, end):.3f})"
        filter_parts.append(
            f"{current}{overlay_input}overlay=0:0:format=auto:enable='{enable}'{out_label}"
        )
        current = out_label
    return ";".join(filter_parts), current


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
    audio_codec: str | None = None,
    audio_codec_args: list[str] | None = None,
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

    codec_flags = _video_codec_flags(preview, quality_profile, video_codec, video_codec_args)
    audio_flags = _audio_codec_flags(audio_codec, audio_codec_args)

    command.extend(
        [
            "-vf",
            subtitles_filter,
            *codec_flags,
            *audio_flags,
        ]
    )

    if progress_path is not None:
        command.extend(["-progress", str(progress_path), "-nostats"])

    command.append(str(output_video))
    _run_ffmpeg(command)
    return output_video


def burn_png_overlays(
    input_video: str | Path,
    overlays: Sequence[tuple[str | Path, float, float, float]],
    output_video: str | Path,
    output_duration: float | None = None,
    preview: bool = False,
    preview_seconds: int = 10,
    quality_profile: str = "balanced",
    progress_path: str | Path | None = None,
    video_codec: str | None = None,
    video_codec_args: list[str] | None = None,
    audio_codec: str | None = None,
    audio_codec_args: list[str] | None = None,
) -> Path:
    input_video = Path(input_video)
    output_video = Path(output_video)
    output_video.parent.mkdir(parents=True, exist_ok=True)

    command = ["ffmpeg", "-y", "-i", str(input_video)]
    if preview:
        command.extend(["-t", str(preview_seconds)])

    for overlay_path, _, _, _ in overlays:
        command.extend(["-loop", "1", "-i", str(Path(overlay_path))])

    codec_flags = _video_codec_flags(preview, quality_profile, video_codec, video_codec_args)
    audio_flags = _audio_codec_flags(audio_codec, audio_codec_args)

    if overlays:
        filter_complex, output_label = _overlay_filter_chain(overlays)
        command.extend([
            "-filter_complex", filter_complex,
            "-map", output_label,
            "-map", "0:a?",
            *codec_flags,
            *audio_flags,
            "-shortest",
        ])
    else:
        command.extend([
            "-map", "0:v:0",
            "-map", "0:a?",
            *codec_flags,
            *audio_flags,
        ])

    if output_duration is not None and output_duration > 0:
        command.extend(["-t", f"{output_duration:.3f}"])

    if progress_path is not None:
        command.extend(["-progress", str(progress_path), "-nostats"])

    command.append(str(output_video))
    _run_ffmpeg(command)
    return output_video


def encode_concat_overlay_video(
    frames: Sequence[tuple[str | Path, float]],
    output_video: str | Path,
) -> Path:
    output_video = Path(output_video)
    output_video.parent.mkdir(parents=True, exist_ok=True)

    valid_frames = [(Path(path), float(duration)) for path, duration in frames if duration > 0.0]
    if not valid_frames:
        raise ValueError("No overlay frames to encode")

    manifest_path = output_video.with_suffix(f"{output_video.suffix}.concat.txt")
    lines: list[str] = []
    for frame_path, duration in valid_frames:
        lines.append(f"file '{_escape_concat_path(frame_path)}'")
        lines.append(f"duration {duration:.6f}")
    lines.append(f"file '{_escape_concat_path(valid_frames[-1][0])}'")
    manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(manifest_path),
        "-an",
        "-c:v",
        "qtrle",
        "-pix_fmt",
        "argb",
        str(output_video),
    ]
    _run_ffmpeg(command)
    return output_video


def burn_overlay_video(
    input_video: str | Path,
    overlay_video: str | Path,
    output_video: str | Path,
    output_duration: float | None = None,
    preview: bool = False,
    preview_seconds: int = 10,
    quality_profile: str = "balanced",
    progress_path: str | Path | None = None,
    video_codec: str | None = None,
    video_codec_args: list[str] | None = None,
    audio_codec: str | None = None,
    audio_codec_args: list[str] | None = None,
) -> Path:
    input_video = Path(input_video)
    overlay_video = Path(overlay_video)
    output_video = Path(output_video)
    output_video.parent.mkdir(parents=True, exist_ok=True)

    command = ["ffmpeg", "-y", "-i", str(input_video), "-i", str(overlay_video)]
    if preview:
        command.extend(["-t", str(preview_seconds)])

    codec_flags = _video_codec_flags(preview, quality_profile, video_codec, video_codec_args)
    audio_flags = _audio_codec_flags(audio_codec, audio_codec_args)

    command.extend([
        "-filter_complex",
        "[0:v][1:v]overlay=0:0:format=auto[out]",
        "-map",
        "[out]",
        "-map",
        "0:a?",
        *codec_flags,
        *audio_flags,
        "-shortest",
    ])

    if output_duration is not None and output_duration > 0:
        command.extend(["-t", f"{output_duration:.3f}"])

    if progress_path is not None:
        command.extend(["-progress", str(progress_path), "-nostats"])

    command.append(str(output_video))
    _run_ffmpeg(command)
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
    _run_ffmpeg(command)
    return output_image


def render_overlay_preview_frame(
    input_video: str | Path,
    output_image: str | Path,
    at_seconds: float = 1.0,
    overlay_image: str | Path | None = None,
) -> Path:
    input_video = Path(input_video)
    output_image = Path(output_image)
    output_image.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{max(0.0, at_seconds):.2f}",
        "-i",
        str(input_video),
    ]

    if overlay_image is not None:
        command.extend([
            "-i",
            str(Path(overlay_image)),
            "-filter_complex",
            "[0:v][1:v]overlay=0:0:format=auto[out]",
            "-map",
            "[out]",
        ])
    else:
        command.extend(["-map", "0:v:0"])

    command.extend([
        "-frames:v",
        "1",
        "-update",
        "1",
        str(output_image),
    ])
    _run_ffmpeg(command)
    return output_image

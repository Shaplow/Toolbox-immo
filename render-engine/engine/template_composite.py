from __future__ import annotations

from pathlib import Path
from typing import TypedDict


class OverlaySegment(TypedDict):
    """Describes one overlay PNG and its active time window."""
    index: int
    start: float          # seconds, inclusive
    end: float | None     # seconds, exclusive; None = until end of video


def normalize_video_block(block: dict, canvas_w: int, canvas_h: int) -> dict[str, float | int | str]:
    x = int(block["x"])
    y = int(block["y"])
    w = int(block["w"])
    h = int(block["h"])

    canvas_w = canvas_w if canvas_w % 2 == 0 else canvas_w + 1
    canvas_h = canvas_h if canvas_h % 2 == 0 else canvas_h + 1

    x = max(0, x)
    y = max(0, y)
    w = max(2, min(w if w % 2 == 0 else w + 1, canvas_w - x))
    h = max(2, min(h if h % 2 == 0 else h + 1, canvas_h - y))

    return {
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "fit": block.get("fit", "cover"),
        "crop_x": float(block.get("crop_x", 0.5)),
        "crop_y": float(block.get("crop_y", 0.5)),
    }


def _build_video_scale_filter(block: dict[str, float | int | str]) -> str:
    """Returns the FFmpeg filter chain that scales/crops the video to the block."""
    w = int(block["w"])
    h = int(block["h"])
    canvas_w = int(block["canvas_w"])
    canvas_h = int(block["canvas_h"])
    x = int(block["x"])
    y = int(block["y"])
    fit = str(block["fit"])
    crop_x = float(block["crop_x"])
    crop_y = float(block["crop_y"])

    if fit == "contain":
        scale_filter = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease:sws_flags=lanczos,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
        )
    else:
        scale_filter = (
            f"scale={w}:{h}:force_original_aspect_ratio=increase:sws_flags=lanczos,"
            f"crop={w}:{h}:(iw-{w})*{crop_x}:(ih-{h})*{crop_y}"
        )

    return (
        f"[0:v]{scale_filter},format=yuv420p,"
        f"pad={canvas_w}:{canvas_h}:{x}:{y}:black[base]"
    )


def build_template_filter_complex(block: dict[str, float | int | str]) -> str:
    """Single-overlay (legacy) filter graph — unchanged behaviour."""
    video_part = _build_video_scale_filter(block)
    return (
        f"{video_part};"
        f"[base][1:v]overlay=0:0:format=auto,"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2[out]"
    )


def build_template_filter_complex_timed(
    block: dict[str, float | int | str],
    segments: list[OverlaySegment],
) -> str:
    """
    Multi-overlay filter graph.  Each overlay input is enabled only for its time
    window using FFmpeg's ``enable='between(t,start,end)'`` expression.

    Overlay inputs are numbered from 1 (video = input 0).
    ``segments[i].index`` is i+1 in the FFmpeg input list.
    """
    video_part = _build_video_scale_filter(block)
    parts: list[str] = [video_part]

    n = len(segments)
    for i, seg in enumerate(segments):
        # overlay_paths[seg["index"]] is FFmpeg input (seg["index"] + 1) because input 0 = video
        input_idx = seg["index"] + 1
        start = seg["start"]
        end = seg["end"]
        in_label = "base" if i == 0 else f"tmp{i - 1}"
        out_label = "tmp{0}".format(i) if i < n - 1 else "pre_scale"

        if end is None:
            enable = f"gte(t,{start})"
        else:
            enable = f"between(t,{start},{end})"

        parts.append(
            f"[{in_label}][{input_idx}:v]overlay=0:0:format=auto:enable='{enable}'[{out_label}]"
        )

    parts.append("[pre_scale]scale=trunc(iw/2)*2:trunc(ih/2)*2[out]")
    return ";".join(parts)


def _build_audio_args(
    *,
    music_path: str | None,
    music_volume: float,
    source_volume: float,
    mute_source: bool,
    music_loop: bool,
    music_fade_in: float,
    music_fade_out: float,
    max_duration: float | None,
    audio_codec: str,
    audio_codec_args: list[str],
    music_input_index: int,
    source_has_audio: bool = True,
) -> tuple[list[str], str | None, list[str], list[str]]:
    """
    Returns (music_input_flags, audio_filter_chain, audio_map_flags, audio_codec_flags).

    ``audio_filter_chain`` is a filter_complex fragment to append after the video
    filters (separated by ``';'``).  ``None`` means no audio filtering needed.

    When no music_path is provided and source_volume == 1.0, returns the
    backward-compatible flags: ``-map 0:a?`` + ``-c:a aac``.

    ``source_has_audio=False`` prevents any ``[0:a]`` reference in the filtergraph
    when the input video has no audio stream.
    """
    if not music_path:
        # No music — just source audio (optionally attenuated or muted)
        if not source_has_audio:
            # Source has no audio stream at all — output no audio track
            return ([], None, [], [])
        if mute_source:
            # Produce silent audio track
            return (
                [],
                "[0:a]volume=0[aout]",
                ["-map", "[aout]"],
                ["-c:a", audio_codec, *audio_codec_args],
            )
        if source_volume < 1.0:
            af = f"[0:a]volume={source_volume}[aout]"
            return (
                [],
                af,
                ["-map", "[aout]"],
                ["-c:a", audio_codec, *audio_codec_args],
            )
        # Fully backward-compatible: passthrough source audio
        return (
            [],
            None,
            ["-map", "0:a?"],
            ["-c:a", audio_codec, *audio_codec_args],
        )

    # ── Music is present ──────────────────────────────────────────────────────
    loop_flags = ["-stream_loop", "-1"] if music_loop else []
    music_input = [*loop_flags, "-i", music_path]

    mi = music_input_index  # shorthand

    if mute_source or not source_has_audio:
        # Only music, no source audio (either muted or absent)
        chain = f"[{mi}:a]volume={music_volume}"
        if music_fade_in > 0:
            chain += f",afade=t=in:d={music_fade_in}"
        if music_fade_out > 0 and max_duration is not None:
            st = max(0, max_duration - music_fade_out)
            chain += f",afade=t=out:st={st}:d={music_fade_out}"
        chain += "[aout]"
        return (
            music_input,
            chain,
            ["-map", "[aout]"],
            ["-c:a", audio_codec, *audio_codec_args],
        )

    # Mix source + music
    music_chain = f"[{mi}:a]volume={music_volume}"
    if music_fade_in > 0:
        music_chain += f",afade=t=in:d={music_fade_in}"
    if music_fade_out > 0 and max_duration is not None:
        st = max(0, max_duration - music_fade_out)
        music_chain += f",afade=t=out:st={st}:d={music_fade_out}"
    music_chain += "[ma]"

    source_chain = f"[0:a]volume={source_volume}[va]"

    af = f"{source_chain};{music_chain};[va][ma]amix=inputs=2:duration=first:dropout_transition=0[aout]"

    return (
        music_input,
        af,
        ["-map", "[aout]"],
        ["-c:a", audio_codec, *audio_codec_args],
    )


def build_template_ffmpeg_cmd(
    video_path: str | Path,
    overlay_path: str | Path,
    out_path: str | Path,
    block: dict[str, float | int | str],
    video_codec: str,
    video_codec_args: list[str],
    audio_codec: str = "aac",
    audio_codec_args: list[str] | None = None,
    max_duration: float | None = None,
    # ── Music options (all optional — backward compatible) ────────────────────
    music_path: str | None = None,
    music_volume: float = 0.3,
    source_volume: float = 1.0,
    mute_source: bool = False,
    music_loop: bool = False,
    music_fade_in: float = 0.0,
    music_fade_out: float = 0.0,
    source_has_audio: bool = True,
) -> list[str]:
    """Single-overlay command (legacy fast path)."""
    audio_codec_args = audio_codec_args or ["-b:a", "192k"]
    filter_complex = build_template_filter_complex(block)

    duration_args = ["-t", str(max_duration)] if max_duration is not None else []

    # Music input is index 2 (0=video, 1=overlay)
    music_input_flags, audio_filter, audio_map_flags, audio_codec_flags = _build_audio_args(
        music_path=music_path,
        music_volume=music_volume,
        source_volume=source_volume,
        mute_source=mute_source,
        music_loop=music_loop,
        music_fade_in=music_fade_in,
        music_fade_out=music_fade_out,
        max_duration=max_duration,
        audio_codec=audio_codec,
        audio_codec_args=audio_codec_args,
        music_input_index=2,
        source_has_audio=source_has_audio,
    )

    # Merge audio filter into the video filter_complex if needed
    if audio_filter:
        filter_complex = f"{filter_complex};{audio_filter}"

    return [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(overlay_path),
        *music_input_flags,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_map_flags,
        "-shortest",
        *duration_args,
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        *audio_codec_flags,
        str(out_path),
    ]


def build_template_ffmpeg_cmd_timed(
    video_path: str | Path,
    overlay_paths: list[str | Path],
    out_path: str | Path,
    block: dict[str, float | int | str],
    segments: list[OverlaySegment],
    video_codec: str,
    video_codec_args: list[str],
    audio_codec: str = "aac",
    audio_codec_args: list[str] | None = None,
    max_duration: float | None = None,
    # ── Music options (all optional — backward compatible) ────────────────────
    music_path: str | None = None,
    music_volume: float = 0.3,
    source_volume: float = 1.0,
    mute_source: bool = False,
    music_loop: bool = False,
    music_fade_in: float = 0.0,
    music_fade_out: float = 0.0,
    source_has_audio: bool = True,
) -> list[str]:
    """Multi-overlay command with per-segment time windows."""
    audio_codec_args = audio_codec_args or ["-b:a", "192k"]
    filter_complex = build_template_filter_complex_timed(block, segments)

    duration_args = ["-t", str(max_duration)] if max_duration is not None else []

    # Build input list: video first, then overlays in index order
    inputs: list[str] = ["-i", str(video_path)]
    for path in overlay_paths:
        inputs += ["-i", str(path)]

    # Music input index = 1 (video) + len(overlay_paths)
    music_input_index = 1 + len(overlay_paths)
    music_input_flags, audio_filter, audio_map_flags, audio_codec_flags = _build_audio_args(
        music_path=music_path,
        music_volume=music_volume,
        source_volume=source_volume,
        mute_source=mute_source,
        music_loop=music_loop,
        music_fade_in=music_fade_in,
        music_fade_out=music_fade_out,
        max_duration=max_duration,
        audio_codec=audio_codec,
        audio_codec_args=audio_codec_args,
        music_input_index=music_input_index,
        source_has_audio=source_has_audio,
    )

    # Merge audio filter into the video filter_complex if needed
    if audio_filter:
        filter_complex = f"{filter_complex};{audio_filter}"

    return [
        "ffmpeg", "-y",
        *inputs,
        *music_input_flags,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_map_flags,
        "-shortest",
        *duration_args,
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        *audio_codec_flags,
        str(out_path),
    ]
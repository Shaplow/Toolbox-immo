from __future__ import annotations

from pathlib import Path
from typing import TypedDict


class OverlaySegment(TypedDict):
    """Describes one overlay PNG and its active time window."""
    index: int
    start: float          # seconds, inclusive
    end: float | None     # seconds, exclusive; None = until end of video


def build_music_track_filter(
    music_input_index: int,
    global_volume: float,
    global_fade_in: float,
    global_fade_out: float,
    effective_dur: float | None,
    slot_specs: list[dict],
) -> str:
    """
    Returns the FFmpeg audio filter chain for the music input track WITHOUT the
    output label (caller appends ``[msc]``, ``[aout]``, etc.).

    When no slot defines ``volume_db``, returns the legacy flat-volume form with
    optional ``afade`` filters — fully backward compatible.

    When ≥1 slot defines ``volume_db``, builds a time-varying volume expression
    evaluated per-frame (``eval=frame``), with optional linear ramps at each
    slot boundary.

    ``slot_specs`` is a list of dicts (one per sequence slot, in order):
      - ``volume_db`` (float | None): target dB level for this slot; ``None``
        means use ``global_volume`` (linear scale).
      - ``fade_in`` (float): ramp duration in seconds at the START of this slot
        (begins at the slot boundary, inside the new slot). 0 = step change.
      - ``fade_out`` (float): ramp duration in seconds at the END of this slot
        (begins ``fade_out`` seconds before the next slot boundary, inside the
        current slot). Takes precedence over the next slot's ``fade_in`` when
        both are set. 0 = step change.
      - ``dur`` (float): effective clip duration (seconds), used to compute
        cumulative timestamps for transitions.
    """
    has_per_slot = any(s.get("volume_db") is not None for s in slot_specs)

    if not has_per_slot:
        # Legacy path — flat volume + optional global afade filters.
        chain = f"[{music_input_index}:a]volume={global_volume}"
        if global_fade_in > 0:
            chain += f",afade=t=in:d={global_fade_in}"
        if global_fade_out > 0 and effective_dur is not None:
            st = max(0.0, effective_dur - global_fade_out)
            chain += f",afade=t=out:st={st:.4f}:d={global_fade_out}"
        return chain

    def _db_to_linear(db: float) -> float:
        return 10.0 ** (db / 20.0)

    n = len(slot_specs)
    if n == 0:
        return f"[{music_input_index}:a]volume={global_volume}"

    # Resolve per-slot linear levels; fall back to global_volume if unset.
    levels = [
        _db_to_linear(float(s["volume_db"])) if s.get("volume_db") is not None else global_volume
        for s in slot_specs
    ]

    # Cumulative start times for each slot boundary.
    starts: list[float] = [0.0]
    for s in slot_specs[:-1]:
        starts.append(starts[-1] + max(0.0, float(s.get("dur", 0))))

    # Build nested if-expression from last slot (rightmost) to first.
    # At each boundary T_i (start of slot i, i > 0) we pick ONE ramp:
    #   • fade_out of slot i-1: ramp starts T_i - F_out (before boundary, inside prev slot)
    #   • fade_in  of slot i:   ramp starts T_i         (after boundary, inside new slot)
    # fade_out takes precedence when both are set.
    expr = f"{levels[-1]:.6f}"
    for i in range(n - 1, 0, -1):
        T = starts[i]
        F_out = max(0.0, float(slot_specs[i - 1].get("fade_out", 0) or 0))
        F_in  = max(0.0, float(slot_specs[i].get("fade_in", 0) or 0))
        V_prev = levels[i - 1]
        V_curr = levels[i]
        if F_out > 0:
            # Ramp starts F_out seconds BEFORE the boundary (inside the previous slot).
            T_start = T - F_out
            ramp = f"({V_prev:.6f}+({V_curr:.6f}-{V_prev:.6f})*(t-{T_start:.4f})/{F_out:.4f})"
            expr = (
                f"if(lt(t,{T_start:.4f}),{V_prev:.6f},"
                f"if(lt(t,{T:.4f}),{ramp},{expr}))"
            )
        elif F_in > 0:
            # Ramp starts AT the boundary (inside the new slot).
            T_end = T + F_in
            ramp = f"({V_prev:.6f}+({V_curr:.6f}-{V_prev:.6f})*(t-{T:.4f})/{F_in:.4f})"
            expr = (
                f"if(lt(t,{T:.4f}),{V_prev:.6f},"
                f"if(lt(t,{T_end:.4f}),{ramp},{expr}))"
            )
        else:
            expr = f"if(lt(t,{T:.4f}),{V_prev:.6f},{expr})"

    chain = f"[{music_input_index}:a]volume='{expr}':eval=frame"
    # Apply global fade-out on top (separate afade filter).
    if global_fade_out > 0 and effective_dur is not None:
        st = max(0.0, effective_dur - global_fade_out)
        chain += f",afade=t=out:st={st:.4f}:d={global_fade_out}"
    return chain



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
            # Produce a silent audio track via lavfi rather than `[0:a]volume=0`.
            # This is robust to inputs where ffprobe reports an audio stream but
            # ffmpeg's filtergraph can't bind to it (corrupt/edge-case codecs,
            # metadata-only "data" streams like mebx on iPhone exports). The
            # anullsrc input lands at ``music_input_index`` (caller reserves the
            # slot); ``-shortest`` stops at the video stream's duration.
            mi = music_input_index
            return (
                ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"],
                None,
                ["-map", f"{mi}:a", "-shortest"],
                ["-c:a", audio_codec, *audio_codec_args],
            )
        if source_volume < 1.0:
            # Attenuated source audio. Use ``[0:a?]`` (optional stream specifier)
            # so the filter is skipped if the source has no usable audio stream.
            af = f"[0:a?]volume={source_volume}[aout]"
            return (
                [],
                af,
                ["-map", "[aout]?"],
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

    # When max_duration is set, -t already caps the output and afade is
    # configured to start at (max_duration - music_fade_out). Using -shortest
    # on top of -t would truncate at the video stream end before afade finishes.
    # Keep -shortest only when no explicit duration is available.
    shortest_flag = [] if max_duration is not None else ["-shortest"]

    return [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(overlay_path),
        *music_input_flags,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_map_flags,
        *shortest_flag,
        *duration_args,
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        # Normalise the MP4 video track timescale across all per-slot clips.
        # Without this, a 60fps Apple source encodes to ts=15360 while a
        # 59.94fps source uses ts=60000.  When the concat demuxer reads clips
        # with mixed timescales under -c copy, FFmpeg mis-computes the total
        # duration in the output edit list (stores 20.76s*15360=318840 ticks
        # in a ts=60000 container → players see 5.3s instead of 20.8s).
        "-video_track_timescale", "60000",
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

    # When max_duration is set, -t already caps the output and afade is
    # configured to start at (max_duration - music_fade_out). Using -shortest
    # on top of -t would truncate at the video stream end before afade finishes.
    # Keep -shortest only when no explicit duration is available.
    shortest_flag = [] if max_duration is not None else ["-shortest"]

    return [
        "ffmpeg", "-y",
        *inputs,
        *music_input_flags,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_map_flags,
        *shortest_flag,
        *duration_args,
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-video_track_timescale", "60000",
        *audio_codec_flags,
        str(out_path),
    ]


def build_template_ffmpeg_cmd_video_only(
    video_path: str | Path,
    out_path: str | Path,
    block: dict[str, float | int | str],
    video_codec: str,
    video_codec_args: list[str],
    audio_codec: str = "aac",
    audio_codec_args: list[str] | None = None,
    max_duration: float | None = None,
    source_has_audio: bool = True,
    mute_source: bool = False,
    source_volume: float = 1.0,
) -> list[str]:
    """
    Scale/crop the source video to the canvas without any overlay PNG.

    Used for sequence slots where overlay_url is null (raw clip, no graphic).
    Audio is kept from the source (passthrough) unless mute_source is True.
    """
    audio_codec_args = audio_codec_args or ["-b:a", "192k"]
    video_filter = _build_video_scale_filter(block)
    # Reuse the [base] label output by _build_video_scale_filter and add a final even-dimension scale
    filter_complex = f"{video_filter};[base]scale=trunc(iw/2)*2:trunc(ih/2)*2[out]"

    duration_args = ["-t", str(max_duration)] if max_duration is not None else []
    if not source_has_audio:
        audio_args: list[str] = []
    elif mute_source:
        # Encode a silent audio track so the clip stream is consistent for concat
        audio_args = ["-map", "0:a?", "-af", "volume=0", "-c:a", audio_codec, *audio_codec_args]
    elif source_volume != 1.0:
        audio_args = ["-map", "0:a?", "-af", f"volume={source_volume}", "-c:a", audio_codec, *audio_codec_args]
    else:
        audio_args = ["-map", "0:a?", "-c:a", audio_codec, *audio_codec_args]

    return [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        *audio_args,
        "-shortest",
        *duration_args,
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-video_track_timescale", "60000",
        str(out_path),
    ]
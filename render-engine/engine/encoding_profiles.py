from __future__ import annotations

from dataclasses import dataclass

from engine.color import bt709_output_flags
from engine.probe import VideoInfo


# ─── Derush trim profile ──────────────────────────────────────────────────────

#: Max re-encode bitrate for derush accurate trim — 20 Mb/s cap for IG/social
DERUSH_MAX_BITRATE = 20_000_000


@dataclass(slots=True)
class DerushEncodingProfile:
    """Profile used when accurate_trim=True in TrimmedClipExporter."""
    video_bitrate: int = DERUSH_MAX_BITRATE
    maxrate: int = 22_000_000
    bufsize: int = 40_000_000
    audio_bitrate: int = 192_000
    cpu_preset: str = "slow"
    nvenc_preset: str = "p5"


def build_derush_encoding_settings(
    source_bitrate: int | None,
    source_fps: float,
    source_width: int,
    source_height: int,
    *,
    use_nvenc: bool,
) -> tuple[str, list[str], str, list[str]]:
    """
    Build FFmpeg codec args for re-encode trim (accurate_trim=True).
    - Resolution and fps are always preserved from source.
    - Bitrate is CAPPED at 20 Mb/s max. If source is below that, use source.
    """
    # Cap at 20 Mb/s — never exceed it even if source is higher
    if source_bitrate and 0 < source_bitrate < DERUSH_MAX_BITRATE:
        effective_bitrate = source_bitrate
    else:
        effective_bitrate = DERUSH_MAX_BITRATE

    profile = DerushEncodingProfile(video_bitrate=effective_bitrate)
    # maxrate / bufsize scale with effective bitrate
    maxrate = min(profile.maxrate, int(effective_bitrate * 1.1))
    bufsize = maxrate * 2

    if use_nvenc:
        video_codec = "hevc_nvenc"
        video_args = [
            "-preset", profile.nvenc_preset,
            "-rc", "vbr",
            "-b:v", str(effective_bitrate),
            "-maxrate", str(maxrate),
            "-bufsize", str(bufsize),
            "-vf", f"scale={source_width}:{source_height}",
            "-r", str(source_fps),
            "-movflags", "+faststart",
            *bt709_output_flags(),
            "-pix_fmt", "yuv420p",
        ]
    else:
        video_codec = "libx265"
        video_args = [
            "-preset", profile.cpu_preset,
            "-b:v", str(effective_bitrate),
            "-maxrate", str(maxrate),
            "-bufsize", str(bufsize),
            "-vf", f"scale={source_width}:{source_height}",
            "-r", str(source_fps),
            "-movflags", "+faststart",
            *bt709_output_flags(),
            "-pix_fmt", "yuv420p",
        ]

    audio_codec = "aac"
    audio_args = ["-b:a", str(profile.audio_bitrate)]
    return video_codec, video_args, audio_codec, audio_args


# ─── Caption profile ──────────────────────────────────────────────────────────

@dataclass(slots=True)
class CaptionEncodingProfile:
    video_bitrate: int
    maxrate: int
    bufsize: int
    audio_bitrate: int
    cpu_preset: str
    nvenc_preset: str = "p4"


def _base_profile(export_profile: str) -> CaptionEncodingProfile:
    quality = (export_profile or "balanced").strip().lower()
    if quality == "draft":
        return CaptionEncodingProfile(
            video_bitrate=8_000_000,
            maxrate=10_000_000,
            bufsize=16_000_000,
            audio_bitrate=128_000,
            cpu_preset="veryfast",
            nvenc_preset="p4",
        )
    if quality == "final":
        return CaptionEncodingProfile(
            video_bitrate=16_000_000,
            maxrate=20_000_000,
            bufsize=32_000_000,
            audio_bitrate=192_000,
            cpu_preset="slow",
            nvenc_preset="p5",
        )
    if quality == "template":
        # Profil dédié aux templates vidéo : pas de contrainte réseau/Instagram,
        # on privilégie la qualité maximale. 20 Mbps / slow / NVENC p6.
        return CaptionEncodingProfile(
            video_bitrate=20_000_000,
            maxrate=24_000_000,
            bufsize=40_000_000,
            audio_bitrate=192_000,
            cpu_preset="slow",
            nvenc_preset="p6",
        )
    return CaptionEncodingProfile(
        video_bitrate=15_000_000,
        maxrate=18_000_000,
        bufsize=30_000_000,
        audio_bitrate=192_000,
        cpu_preset="medium",
        nvenc_preset="p4",
    )


def _effective_video_bitrate(
    target_bitrate: int,
    source_bitrate: int | None,
    *,
    for_composite: bool = False,
) -> int:
    if source_bitrate and source_bitrate > 0:
        if for_composite:
            # Re-encoding a video (composite overlay) introduces generation loss.
            # Use at least the source bitrate so the output is never worse than the input.
            # Still cap at 2× target to avoid absurdly large files from bloated sources.
            return min(max(target_bitrate, source_bitrate), target_bitrate * 2)
        # Captions / pure re-encode: avoid inflating well-compressed masters.
        return min(target_bitrate, source_bitrate)
    return target_bitrate


def build_caption_encoding_settings(
    export_profile: str,
    video_info: VideoInfo,
    *,
    use_nvenc: bool,
    preview: bool,
    for_composite: bool = False,
) -> tuple[str, list[str], str, list[str], dict[str, int | str | bool]]:
    base = _base_profile(export_profile)
    effective_bitrate = _effective_video_bitrate(
        base.video_bitrate, video_info.video_bitrate, for_composite=for_composite
    )

    if preview:
        effective_bitrate = min(effective_bitrate, 8_000_000)

    maxrate = max(effective_bitrate, min(base.maxrate, int(effective_bitrate * 1.2)))
    bufsize = max(maxrate * 2, base.bufsize if not preview else maxrate * 2)
    audio_bitrate = min(base.audio_bitrate, 128_000) if preview else base.audio_bitrate

    if use_nvenc:
        video_codec = "h264_nvenc"
        video_args = [
            "-preset", base.nvenc_preset,
            "-rc", "vbr",
            "-b:v", str(effective_bitrate),
            "-maxrate", str(maxrate),
            "-bufsize", str(bufsize),
            *bt709_output_flags(),
            "-pix_fmt", "yuv420p",
        ]
        if for_composite:
            # Disable B-frames and lookahead to eliminate NVENC encoder delay.
            # NVENC B-frames produce a negative initial DTS that FFmpeg compensates
            # via an MP4 edit list.  Even with -bf 0, NVENC's rate-control lookahead
            # keeps a 1-frame pipeline delay (DTS = -1001/60000 ≈ -16 ms for 59.94fps),
            # which also triggers an edit list.  Setting rc_lookahead=0 removes that
            # residual delay so the first DTS is 0 and no edit list is created.
            video_args += ["-bf", "0", "-rc_lookahead", "0"]
    else:
        video_codec = "libx264"
        video_args = [
            "-preset", "veryfast" if preview else base.cpu_preset,
            "-b:v", str(effective_bitrate),
            "-maxrate", str(maxrate),
            "-bufsize", str(bufsize),
            *bt709_output_flags(),
            "-pix_fmt", "yuv420p",
        ]

    audio_codec = "aac"
    audio_args = ["-b:a", str(audio_bitrate)]
    if for_composite:
        # Force uniform sample rate across all sequence clips so concat -c copy
        # produces consistent audio streams (avoids desync when source clips have
        # different native sample rates, e.g. iPhone 44100 Hz vs library 48000 Hz).
        audio_args += ["-ar", "48000"]

    debug = {
        "effective_video_bitrate": effective_bitrate,
        "maxrate": maxrate,
        "bufsize": bufsize,
        "audio_bitrate": audio_bitrate,
        "source_video_bitrate": video_info.video_bitrate or 0,
        "source_fps": video_info.fps or 0.0,
        "preview": preview,
        "use_nvenc": use_nvenc,
    }
    return video_codec, video_args, audio_codec, audio_args, debug
from __future__ import annotations

from dataclasses import dataclass

from engine.probe import VideoInfo


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
        # on privilégie la qualité maximale. 30 Mbps / slow / NVENC p6.
        return CaptionEncodingProfile(
            video_bitrate=30_000_000,
            maxrate=35_000_000,
            bufsize=60_000_000,
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
            "-movflags", "+faststart",
        ]
    else:
        video_codec = "libx264"
        video_args = [
            "-preset", "veryfast" if preview else base.cpu_preset,
            "-b:v", str(effective_bitrate),
            "-maxrate", str(maxrate),
            "-bufsize", str(bufsize),
            "-movflags", "+faststart",
        ]

    audio_codec = "aac"
    audio_args = ["-b:a", str(audio_bitrate)]

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
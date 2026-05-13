"""
media_edit.py — Rush editing pipeline (trim + audio fixes).

Builds and runs an FFmpeg command that applies one or more operations
to a source video:
  - trimStart / trimEnd  : cut the beginning and/or end
  - mixToMono            : convert stereo → mono by averaging both channels
                           (useful when a mono mic was plugged into the left channel only)
  - normalize            : apply loudnorm (EBU R128, I=-16 LUFS, TP=-1.5 dBTP, LRA=11)

Output replaces the input file (destructive edit by design — caller handles R2 upload).

Usage
-----
    from engine.media_edit import process_media_edit

    result = process_media_edit(
        input_path=Path("/tmp/rush.mp4"),
        output_path=Path("/tmp/rush_edited.mp4"),
        params={
            "trimStart": 2.5,
            "trimEnd": 147.0,
            "mixToMono": True,
            "normalize": True,
        },
    )
    # result: { "duration": float }
"""

from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from engine.probe import probe_video


@dataclass
class MediaEditParams:
    trim_start: float | None = None
    trim_end: float | None = None
    mix_to_mono: bool = False
    normalize: bool = False
    gain_db: float | None = None  # volume adjustment in dB, ex: +3.0 or -6.0 (-24..+24)

    @classmethod
    def from_dict(cls, d: dict) -> "MediaEditParams":
        gain_raw = d.get("gainDb")
        gain_db: float | None = None
        if gain_raw is not None:
            g = float(gain_raw)
            # Clamp to safe range
            gain_db = max(-24.0, min(24.0, g))
        return cls(
            trim_start=float(d["trimStart"]) if d.get("trimStart") is not None else None,
            trim_end=float(d["trimEnd"]) if d.get("trimEnd") is not None else None,
            mix_to_mono=bool(d.get("mixToMono", False)),
            normalize=bool(d.get("normalize", False)),
            gain_db=gain_db,
        )


def build_media_edit_cmd(
    input_path: Path,
    output_path: Path,
    params: MediaEditParams,
) -> list[str]:
    """
    Build the FFmpeg command list for the requested edits.

    Strategy:
    - If only a trim is requested and no audio filters are needed, use
      stream-copy (-c copy) for maximum speed and quality preservation.
    - Otherwise, re-encode video with libx264 (CRF 18, fast preset) and
      audio with AAC 48 kHz.
    """
    cmd: list[str] = ["ffmpeg", "-y"]

    # ── Input / trim ─────────────────────────────────────────────────────────
    if params.trim_start is not None and params.trim_start > 0:
        cmd += ["-ss", str(params.trim_start)]

    cmd += ["-i", str(input_path)]

    if params.trim_end is not None:
        duration = params.trim_end - (params.trim_start or 0.0)
        cmd += ["-t", str(duration)]

    # ── Audio filter chain ────────────────────────────────────────────────────
    audio_filters: list[str] = []
    needs_audio_filter = params.mix_to_mono or params.normalize or params.gain_db is not None

    if params.mix_to_mono:
        # Average L + R into a single centered mono channel then upmix back to stereo
        # so the output is always a standard stereo track.
        audio_filters.append("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1")

    if params.gain_db is not None and params.gain_db != 0.0:
        # Apply volume gain before loudnorm so loudnorm sees the adjusted level.
        sign = "+" if params.gain_db > 0 else ""
        audio_filters.append(f"volume={sign}{params.gain_db}dB")

    if params.normalize:
        audio_filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")

    # ── Codec selection ───────────────────────────────────────────────────────
    if not needs_audio_filter and params.trim_start is None and params.trim_end is None:
        # No-op: nothing to do — caller should not have submitted this job,
        # but we handle it gracefully with stream copy.
        cmd += ["-c", "copy"]
    elif not needs_audio_filter:
        # Trim only: stream copy is safe as long as we seek before input (keyframe-accurate).
        cmd += ["-c", "copy"]
    else:
        # Re-encode with audio processing
        cmd += [
            "-c:v", "libx264",
            "-crf", "18",
            "-preset", "fast",
            "-c:a", "aac",
            "-ar", "48000",
            "-b:a", "192k",
        ]
        if audio_filters:
            cmd += ["-af", ",".join(audio_filters)]

    cmd.append(str(output_path))
    return cmd


def process_media_edit(
    input_path: Path,
    output_path: Path,
    params: dict | MediaEditParams,
) -> dict:
    """
    Run the FFmpeg media edit pipeline.

    Returns a dict with the output duration in seconds:
        { "duration": float }

    Raises RuntimeError on FFmpeg failure.
    """
    if isinstance(params, dict):
        p = MediaEditParams.from_dict(params)
    else:
        p = params

    cmd = build_media_edit_cmd(input_path, output_path, p)
    print(f"[media_edit] FFmpeg cmd: {' '.join(cmd)}", flush=True)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20 * 60,
    )

    if result.returncode != 0:
        stderr_tail = result.stderr[-2000:] if result.stderr else ""
        stdout_tail = result.stdout[-800:] if result.stdout else ""
        raise RuntimeError(
            f"[media_edit] FFmpeg failed (rc={result.returncode}):\n"
            f"stderr:\n{stderr_tail}\nstdout:\n{stdout_tail}"
        )

    print(f"[media_edit] FFmpeg done → {output_path}", flush=True)

    video_info = probe_video(output_path)
    return {"duration": video_info.duration}

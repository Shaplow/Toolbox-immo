"""Tests for engine.probe — colorimetry fields added for the HDR garde-fou (P4).

Run with: python3 -m pytest tests/test_probe.py -v
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from engine.probe import probe_video


def _fake_ffprobe_result(stream: dict, duration: str = "5.0") -> MagicMock:
    result = MagicMock()
    result.stdout = json.dumps({
        "streams": [stream],
        "format": {"duration": duration},
    })
    return result


class ProbeVideoColorFieldsTest(unittest.TestCase):
    """Mocked subprocess — deterministic, no dependency on the local ffmpeg
    build's VUI-writing quirks (libx264 does not reliably round-trip every
    tag on every platform, confirmed by manual testing on this repo's
    Homebrew ffmpeg build)."""

    def _probe_with(self, stream: dict) -> "object":
        with patch("engine.probe.subprocess.run", return_value=_fake_ffprobe_result(stream)), \
             patch("engine.probe._probe_has_audio", return_value=False):
            return probe_video("fake.mp4")

    def test_fully_tagged_hdr_stream(self) -> None:
        info = self._probe_with({
            "width": 3840, "height": 2160,
            "pix_fmt": "yuv420p10le",
            "color_transfer": "arib-std-b67",
            "color_primaries": "bt2020",
            "color_space": "bt2020nc",
        })
        self.assertEqual(info.pix_fmt, "yuv420p10le")
        self.assertEqual(info.color_transfer, "arib-std-b67")
        self.assertEqual(info.color_primaries, "bt2020")
        self.assertEqual(info.color_space, "bt2020nc")

    def test_untagged_stream_fields_are_none(self) -> None:
        # Real-world case confirmed against local ffmpeg: an untagged source
        # simply omits these keys from the JSON stream object entirely.
        info = self._probe_with({"width": 64, "height": 64, "pix_fmt": "yuv420p"})
        self.assertEqual(info.pix_fmt, "yuv420p")
        self.assertIsNone(info.color_transfer)
        self.assertIsNone(info.color_primaries)
        self.assertIsNone(info.color_space)

    def test_literal_unknown_string_normalized_to_none(self) -> None:
        # Some ffprobe builds/versions emit the literal string "unknown"
        # instead of omitting the key — must be treated identically to absent.
        info = self._probe_with({
            "width": 64, "height": 64, "pix_fmt": "yuv420p",
            "color_transfer": "unknown", "color_primaries": "unknown",
            "color_space": "unknown",
        })
        self.assertIsNone(info.color_transfer)
        self.assertIsNone(info.color_primaries)
        self.assertIsNone(info.color_space)

    def test_non_string_color_field_normalized_to_none(self) -> None:
        # Defensive: a malformed/non-string value should never propagate.
        info = self._probe_with({
            "width": 64, "height": 64, "pix_fmt": "yuv420p",
            "color_transfer": None,
        })
        self.assertIsNone(info.color_transfer)

    def test_values_are_lowercased(self) -> None:
        info = self._probe_with({
            "width": 64, "height": 64, "pix_fmt": "YUV420P",
            "color_transfer": "SMPTE2084",
        })
        self.assertEqual(info.pix_fmt, "yuv420p")
        self.assertEqual(info.color_transfer, "smpte2084")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe not installed")
class ProbeVideoRealFfmpegSmokeTest(unittest.TestCase):
    """One real-encode round trip — confirms the extended -show_entries
    command line is accepted by the local ffprobe binary and produces a
    parseable VideoInfo, independent of which colorimetry tags this
    particular ffmpeg build chooses to persist."""

    def test_probe_real_untagged_clip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clip = Path(tmp) / "clip.mp4"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc=size=64x64:duration=1:rate=10",
                    "-pix_fmt", "yuv420p",
                    str(clip),
                ],
                check=True, capture_output=True,
            )
            info = probe_video(clip)
        self.assertEqual(info.width, 64)
        self.assertEqual(info.height, 64)
        self.assertEqual(info.pix_fmt, "yuv420p")
        self.assertIsNone(info.color_transfer)
        self.assertIsNone(info.color_primaries)


if __name__ == "__main__":
    unittest.main()

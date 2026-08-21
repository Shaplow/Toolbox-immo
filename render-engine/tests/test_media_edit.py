"""Tests for engine.media_edit — hdr_prefilter wiring on the re-encode branch
only, never on the -c copy (trim-only) branch (P4 garde-fou).

Run with: python3 -m pytest tests/test_media_edit.py -v
"""
from __future__ import annotations

import unittest
from pathlib import Path

from engine.media_edit import MediaEditParams, build_media_edit_cmd

_TONEMAP_CHAIN = (
    "zscale=t=linear:npl=100,format=gbrpf32le,"
    "tonemap=hable:desat=0,"
    "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)


class TrimOnlyCopyPathTest(unittest.TestCase):
    """-c copy paths must NEVER carry a -vf or bt709 tags — the pixels are
    untouched passthrough; tagging them would be a lie (or, for -vf, simply
    incompatible with stream copy)."""

    def test_trim_only_is_stream_copy(self) -> None:
        params = MediaEditParams(trim_start=2.0, trim_end=10.0)
        cmd = build_media_edit_cmd(Path("in.mp4"), Path("out.mp4"), params)
        self.assertIn("-c", cmd)
        self.assertEqual(cmd[cmd.index("-c") + 1], "copy")

    def test_trim_only_ignores_hdr_prefilter(self) -> None:
        params = MediaEditParams(trim_start=2.0, trim_end=10.0)
        cmd = build_media_edit_cmd(
            Path("in.mp4"), Path("out.mp4"), params, hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertNotIn("-vf", cmd)
        self.assertNotIn("-colorspace", cmd)
        self.assertIn("copy", cmd)

    def test_noop_is_stream_copy(self) -> None:
        params = MediaEditParams()
        cmd = build_media_edit_cmd(Path("in.mp4"), Path("out.mp4"), params)
        self.assertIn("copy", cmd)
        self.assertNotIn("-vf", cmd)


class ReencodeBranchTest(unittest.TestCase):
    def test_reencode_always_carries_bt709_and_pix_fmt(self) -> None:
        params = MediaEditParams(normalize=True)
        cmd = build_media_edit_cmd(Path("in.mp4"), Path("out.mp4"), params)
        self.assertIn("-c:v", cmd)
        self.assertEqual(cmd[cmd.index("-c:v") + 1], "libx264")
        self.assertIn("-colorspace", cmd)
        self.assertIn("-pix_fmt", cmd)
        self.assertIn("yuv420p", cmd)

    def test_reencode_no_hdr_prefilter_means_no_vf(self) -> None:
        params = MediaEditParams(normalize=True)
        cmd = build_media_edit_cmd(Path("in.mp4"), Path("out.mp4"), params, hdr_prefilter=None)
        self.assertNotIn("-vf", cmd)

    def test_reencode_hdr_prefilter_added_as_vf(self) -> None:
        params = MediaEditParams(mix_to_mono=True)
        cmd = build_media_edit_cmd(
            Path("in.mp4"), Path("out.mp4"), params, hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertIn("-vf", cmd)
        self.assertEqual(cmd[cmd.index("-vf") + 1], _TONEMAP_CHAIN)

    def test_reencode_hdr_prefilter_and_audio_filters_coexist(self) -> None:
        params = MediaEditParams(normalize=True, gain_db=3.0)
        cmd = build_media_edit_cmd(
            Path("in.mp4"), Path("out.mp4"), params, hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertIn("-vf", cmd)
        self.assertIn("-af", cmd)
        self.assertEqual(cmd[cmd.index("-vf") + 1], _TONEMAP_CHAIN)


class ProcessMediaEditHdrProbeTest(unittest.TestCase):
    """process_media_edit probes the source and only computes a prefilter
    when is_hdr() is True; a probe failure must never block the edit."""

    def test_sdr_source_no_prefilter(self) -> None:
        from unittest.mock import patch
        from engine.probe import VideoInfo

        sdr_info = VideoInfo(
            width=1920, height=1080, duration=5.0,
            color_transfer="bt709", color_primaries="bt709", pix_fmt="yuv420p",
        )
        with patch("engine.media_edit.probe_video", return_value=sdr_info), \
             patch("engine.media_edit.subprocess.run") as mock_run, \
             patch("engine.media_edit.build_media_edit_cmd", wraps=build_media_edit_cmd) as mock_build:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stderr = ""
            mock_run.return_value.stdout = ""
            from engine.media_edit import process_media_edit
            process_media_edit(Path("in.mp4"), Path("out.mp4"), {"normalize": True})
        self.assertIsNone(mock_build.call_args.kwargs.get("hdr_prefilter"))

    def test_hdr_source_computes_prefilter(self) -> None:
        from unittest.mock import patch
        from engine.probe import VideoInfo

        hdr_info = VideoInfo(
            width=3840, height=2160, duration=5.0,
            color_transfer="arib-std-b67", color_primaries="bt2020", pix_fmt="yuv420p10le",
        )
        with patch("engine.media_edit.probe_video", return_value=hdr_info), \
             patch("engine.media_edit.subprocess.run") as mock_run, \
             patch("engine.media_edit.build_media_edit_cmd", wraps=build_media_edit_cmd) as mock_build:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stderr = ""
            mock_run.return_value.stdout = ""
            from engine.media_edit import process_media_edit
            process_media_edit(Path("in.mp4"), Path("out.mp4"), {"normalize": True})
        prefilter = mock_build.call_args.kwargs.get("hdr_prefilter")
        self.assertIsNotNone(prefilter)
        self.assertIn("format=yuv420p", prefilter)

    def test_probe_failure_never_blocks_edit(self) -> None:
        from unittest.mock import patch

        with patch("engine.media_edit.probe_video", side_effect=[RuntimeError("ffprobe boom"), None]) as mock_probe, \
             patch("engine.media_edit.subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stderr = ""
            mock_run.return_value.stdout = ""
            # Second probe_video call (post-encode, for duration) must still work —
            # only the first (HDR pre-check) call is made to fail here.
            from engine.probe import VideoInfo
            mock_probe.side_effect = [RuntimeError("ffprobe boom"), VideoInfo(width=1, height=1, duration=1.0)]
            from engine.media_edit import process_media_edit
            result = process_media_edit(Path("in.mp4"), Path("out.mp4"), {"trimStart": 1.0, "trimEnd": 2.0})
        self.assertEqual(result, {"duration": 1.0})


if __name__ == "__main__":
    unittest.main()

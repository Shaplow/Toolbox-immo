"""Tests for engine.color — HDR detection and the SDR/BT.709 garde-fou (P4).

Run with: python3 -m pytest tests/test_color.py -v
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from engine.color import (
    bt709_output_flags,
    has_zscale,
    hdr_to_sdr_prefilter,
    is_hdr,
)
from engine.probe import VideoInfo


def video_info(**overrides) -> VideoInfo:
    base = dict(width=1080, height=1920, duration=10.0)
    base.update(overrides)
    return VideoInfo(**base)


class IsHdrTest(unittest.TestCase):
    """Table from the plan: PQ, HLG, bt2020, 10-bit+bt2020, SDR bt709, untagged."""

    def test_pq(self) -> None:
        info = video_info(color_transfer="smpte2084", color_primaries="bt2020", pix_fmt="yuv420p10le")
        self.assertTrue(is_hdr(info))

    def test_hlg(self) -> None:
        # Real-world iPhone HLG tagging: transfer=arib-std-b67, primaries=bt2020,
        # matrix (color_space)=bt2020nc.
        info = video_info(
            color_transfer="arib-std-b67",
            color_primaries="bt2020",
            color_space="bt2020nc",
            pix_fmt="yuv420p10le",
        )
        self.assertTrue(is_hdr(info))

    def test_bt2020_primaries_alone(self) -> None:
        # Wide-gamut primaries even without a genuine HDR transfer curve.
        info = video_info(color_transfer="bt709", color_primaries="bt2020", pix_fmt="yuv420p")
        self.assertTrue(is_hdr(info))

    def test_10bit_plus_bt2020(self) -> None:
        info = video_info(pix_fmt="yuv420p10le", color_primaries="bt2020")
        self.assertTrue(is_hdr(info))

    def test_sdr_bt709(self) -> None:
        info = video_info(
            color_transfer="bt709",
            color_primaries="bt709",
            color_space="bt709",
            pix_fmt="yuv420p",
        )
        self.assertFalse(is_hdr(info))

    def test_untagged(self) -> None:
        # ffprobe reported no colorimetry metadata at all — must NEVER be
        # treated as HDR (that would tonemap perfectly healthy SDR footage).
        info = video_info()
        self.assertFalse(is_hdr(info))

    def test_10bit_alone_without_bt2020_is_not_hdr(self) -> None:
        # 10-bit BT.709 (e.g. some ProRes masters) is still SDR — bit depth
        # alone is not a signal, only 10-bit + BT.2020 together.
        info = video_info(pix_fmt="yuv420p10le", color_primaries="bt709", color_transfer="bt709")
        self.assertFalse(is_hdr(info))

    def test_bt2020_10_transfer_is_not_hdr(self) -> None:
        # "bt2020-10"/"bt2020-12" are BT.709-compatible gamma curves for
        # wide-gamut SDR-ish content, NOT a genuine HDR transfer function.
        info = video_info(color_transfer="bt2020-10", color_primaries="bt709")
        self.assertFalse(is_hdr(info))


class Bt709OutputFlagsTest(unittest.TestCase):
    def test_exact_flags(self) -> None:
        self.assertEqual(
            bt709_output_flags(),
            [
                "-colorspace", "bt709",
                "-color_primaries", "bt709",
                "-color_trc", "bt709",
                "-color_range", "tv",
            ],
        )

    def test_returns_a_fresh_list_each_call(self) -> None:
        # Callers do `*bt709_output_flags()` inline into command lists — a
        # shared mutable list would risk accidental cross-call mutation.
        a = bt709_output_flags()
        b = bt709_output_flags()
        self.assertIsNot(a, b)


class HdrToSdrPrefilterTest(unittest.TestCase):
    def test_full_tonemap_chain_when_zscale_available(self) -> None:
        with patch("engine.color.has_zscale", return_value=True):
            chain = hdr_to_sdr_prefilter()
        self.assertEqual(
            chain,
            "zscale=t=linear:npl=100,format=gbrpf32le,"
            "tonemap=hable:desat=0,"
            "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
            "format=yuv420p",
        )

    def test_fallback_without_zscale_never_raises(self) -> None:
        with patch("engine.color.has_zscale", return_value=False):
            with self.assertLogs("render-engine", level="WARNING") as cm:
                chain = hdr_to_sdr_prefilter()
        self.assertEqual(chain, "format=yuv420p")
        self.assertTrue(any("zscale" in msg for msg in cm.output))

    def test_prefilter_never_computed_for_sdr_source(self) -> None:
        # The calling convention used everywhere in the pipeline: callers gate
        # on is_hdr() themselves and pass None for SDR sources — this module
        # never decides that on its own.
        sdr_info = video_info(color_transfer="bt709", color_primaries="bt709", pix_fmt="yuv420p")
        prefilter = hdr_to_sdr_prefilter() if is_hdr(sdr_info) else None
        self.assertIsNone(prefilter)

    def test_prefilter_computed_for_hdr_source(self) -> None:
        hdr_info = video_info(color_transfer="smpte2084", pix_fmt="yuv420p10le")
        with patch("engine.color.has_zscale", return_value=True):
            prefilter = hdr_to_sdr_prefilter() if is_hdr(hdr_info) else None
        self.assertIsNotNone(prefilter)
        self.assertIn("tonemap=hable", prefilter)


class HasZscaleRealProbeTest(unittest.TestCase):
    """Sanity check against the real local ffmpeg binary (not mocked)."""

    def test_returns_a_bool_without_raising(self) -> None:
        has_zscale.cache_clear()
        try:
            result = has_zscale()
        finally:
            has_zscale.cache_clear()
        self.assertIsInstance(result, bool)

    def test_is_cached_across_calls(self) -> None:
        has_zscale.cache_clear()
        try:
            with patch("subprocess.run") as mock_run:
                mock_run.return_value.stdout = " .. zscale            V->V       Apply resize.\n"
                first = has_zscale()
                second = has_zscale()
                self.assertEqual(mock_run.call_count, 1, "lru_cache should prevent a second subprocess call")
            self.assertTrue(first)
            self.assertEqual(first, second)
        finally:
            has_zscale.cache_clear()

    def test_subprocess_failure_is_swallowed(self) -> None:
        has_zscale.cache_clear()
        try:
            with patch("subprocess.run", side_effect=FileNotFoundError("no ffmpeg")):
                result = has_zscale()
            self.assertFalse(result)
        finally:
            has_zscale.cache_clear()


if __name__ == "__main__":
    unittest.main()

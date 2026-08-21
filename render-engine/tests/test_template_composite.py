"""Tests for resolve_overlay_segments (end-anchored timed visibility) and the
HDR garde-fou (P4) wiring through the template composite builders.

Run with: python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import unittest

from engine.probe import VideoInfo
from engine.template_composite import (
    OverlaySegment,
    build_template_ffmpeg_cmd,
    build_template_ffmpeg_cmd_timed,
    build_template_ffmpeg_cmd_video_only,
    build_template_filter_complex,
    resolve_overlay_segments,
)


def seg(index: int, start: float, end: float | None) -> OverlaySegment:
    return {"index": index, "start": start, "end": end}


class ResolveOverlaySegmentsTest(unittest.TestCase):
    def test_identity_without_negative_bounds(self) -> None:
        segments = [seg(0, 0, 6.0), seg(1, 6.0, None)]
        result = resolve_overlay_segments(segments, clip_duration=None)
        self.assertIs(result, segments)

    def test_simple_end_anchor(self) -> None:
        # Block appears 3 s before the end: [{0, 0, fin-3}, {1, fin-3, None}]
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=10.0
        )
        self.assertEqual(result, [seg(0, 0.0, 7.0), seg(1, 7.0, None)])

    def test_end_anchor_with_max_duration_cap(self) -> None:
        # Clip probes at 20 s but -t caps output at 10 s → anchors resolve against 10.
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=20.0, max_duration=10.0
        )
        self.assertEqual(result, [seg(0, 0.0, 7.0), seg(1, 7.0, None)])

    def test_max_duration_longer_than_clip(self) -> None:
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=8.0, max_duration=15.0
        )
        self.assertEqual(result, [seg(0, 0.0, 5.0), seg(1, 5.0, None)])

    def test_short_clip_clamps_and_drops_degenerate(self) -> None:
        # Web assumed "long clip": A visible 0→5, B 5→fin-3, C fin-3→fin.
        # Actual clip = 2 s → middle window collapses, open-ended segment survives.
        result = resolve_overlay_segments(
            [seg(0, 0, 5.0), seg(1, 5.0, -3.0), seg(2, -3.0, None)], clip_duration=2.0
        )
        self.assertEqual(result, [seg(0, 0.0, 2.0), seg(2, 2.0, None)])

    def test_monotonicity_forced_on_short_clip(self) -> None:
        # fin-3 resolves to 1 with D=4, before the start-anchored 2 → clamped to 2.
        result = resolve_overlay_segments(
            [seg(0, 0, 2.0), seg(1, 2.0, -3.0), seg(2, -3.0, None)], clip_duration=4.0
        )
        self.assertEqual(result, [seg(0, 0.0, 2.0), seg(2, 2.0, None)])

    def test_merge_adjacent_same_index(self) -> None:
        # Middle segment dropped → neighbours with the same index become adjacent.
        result = resolve_overlay_segments(
            [seg(0, 0, 3.0), seg(1, 3.0, -8.0), seg(0, -8.0, -2.0), seg(1, -2.0, None)],
            clip_duration=10.0,
        )
        # fin-8 = 2 < 3 → clamped to 3, seg1 dropped, seg0 windows merge 0→3 and 3→8.
        self.assertEqual(result, [seg(0, 0.0, 8.0), seg(1, 8.0, None)])

    def test_raises_without_duration_when_negative(self) -> None:
        with self.assertRaises(ValueError):
            resolve_overlay_segments([seg(0, -3.0, None)], clip_duration=None)
        with self.assertRaises(ValueError):
            resolve_overlay_segments([seg(0, -3.0, None)], clip_duration=0.0)

    def test_negative_resolved_in_enable_expression(self) -> None:
        # End-to-end sanity: resolved bounds feed a valid enable expression.
        from engine.template_composite import build_template_filter_complex_timed

        resolved = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=10.0
        )
        block = {
            "x": 0, "y": 0, "w": 1080, "h": 1920,
            "canvas_w": 1080, "canvas_h": 1920,
            "fit": "cover", "crop_x": 0.5, "crop_y": 0.5,
        }
        graph = build_template_filter_complex_timed(block, resolved)
        self.assertIn("between(t,0,7.0)", graph)
        self.assertIn("gte(t,7.0)", graph)
        self.assertNotIn("-3", graph)


def _base_block() -> dict:
    return {
        "x": 0, "y": 0, "w": 1080, "h": 1920,
        "canvas_w": 1080, "canvas_h": 1920,
        "fit": "cover", "crop_x": 0.5, "crop_y": 0.5,
    }


_TONEMAP_CHAIN = (
    "zscale=t=linear:npl=100,format=gbrpf32le,"
    "tonemap=hable:desat=0,"
    "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)


class HdrPrefilterInjectionTest(unittest.TestCase):
    """P4 garde-fou — tonemap is injected SSI (if and only if) hdr_prefilter
    is passed; SDR sources must never see a zscale/tonemap filter."""

    def test_no_tonemap_on_sdr_filter_complex(self) -> None:
        graph = build_template_filter_complex(_base_block(), hdr_prefilter=None)
        self.assertIn("format=yuv420p", graph)
        self.assertNotIn("zscale", graph)
        self.assertNotIn("tonemap", graph)

    def test_tonemap_injected_before_overlay_when_hdr(self) -> None:
        graph = build_template_filter_complex(_base_block(), hdr_prefilter=_TONEMAP_CHAIN)
        self.assertIn("zscale=t=linear", graph)
        self.assertIn("tonemap=hable", graph)
        # Tonemap must land in the scale/crop stage — before the [base][1:v]
        # overlay composite (PNG overlays are always sRGB, never HDR).
        tonemap_pos = graph.index("tonemap=hable")
        overlay_pos = graph.index("[base][1:v]overlay")
        self.assertLess(tonemap_pos, overlay_pos)

    def test_single_overlay_command_sdr_vs_hdr(self) -> None:
        sdr_cmd = build_template_ffmpeg_cmd(
            video_path="in.mp4", overlay_path="ovl.png", out_path="out.mp4",
            block=_base_block(), video_codec="libx264", video_codec_args=[],
            hdr_prefilter=None,
        )
        hdr_cmd = build_template_ffmpeg_cmd(
            video_path="in.mp4", overlay_path="ovl.png", out_path="out.mp4",
            block=_base_block(), video_codec="libx264", video_codec_args=[],
            hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertNotIn("tonemap", " ".join(sdr_cmd))
        self.assertIn("tonemap=hable", " ".join(hdr_cmd))

    def test_timed_command_sdr_vs_hdr(self) -> None:
        segments = [{"index": 0, "start": 0.0, "end": None}]
        sdr_cmd = build_template_ffmpeg_cmd_timed(
            video_path="in.mp4", overlay_paths=["ovl.png"], out_path="out.mp4",
            block=_base_block(), segments=segments,
            video_codec="libx264", video_codec_args=[], hdr_prefilter=None,
        )
        hdr_cmd = build_template_ffmpeg_cmd_timed(
            video_path="in.mp4", overlay_paths=["ovl.png"], out_path="out.mp4",
            block=_base_block(), segments=segments,
            video_codec="libx264", video_codec_args=[], hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertNotIn("tonemap", " ".join(sdr_cmd))
        self.assertIn("tonemap=hable", " ".join(hdr_cmd))

    def test_video_only_command_sdr_vs_hdr(self) -> None:
        sdr_cmd = build_template_ffmpeg_cmd_video_only(
            video_path="in.mp4", out_path="out.mp4",
            block=_base_block(), video_codec="libx264", video_codec_args=[],
            hdr_prefilter=None,
        )
        hdr_cmd = build_template_ffmpeg_cmd_video_only(
            video_path="in.mp4", out_path="out.mp4",
            block=_base_block(), video_codec="libx264", video_codec_args=[],
            hdr_prefilter=_TONEMAP_CHAIN,
        )
        self.assertNotIn("tonemap", " ".join(sdr_cmd))
        self.assertIn("tonemap=hable", " ".join(hdr_cmd))


class Bt709FlagsAlwaysPresentTest(unittest.TestCase):
    """bt709 output tags are SYSTEMATIC — present on every encode built via
    engine.encoding_profiles, for SDR sources too (not gated on is_hdr)."""

    def _sdr_video_info(self) -> VideoInfo:
        return VideoInfo(
            width=1080, height=1920, duration=10.0,
            color_transfer="bt709", color_primaries="bt709",
            color_space="bt709", pix_fmt="yuv420p",
        )

    def test_caption_settings_libx264(self) -> None:
        from engine.encoding_profiles import build_caption_encoding_settings

        _, video_args, _, _, _ = build_caption_encoding_settings(
            "balanced", self._sdr_video_info(), use_nvenc=False, preview=False,
        )
        self.assertIn("-colorspace", video_args)
        self.assertIn("bt709", video_args)
        self.assertIn("-pix_fmt", video_args)
        self.assertIn("yuv420p", video_args)

    def test_caption_settings_nvenc(self) -> None:
        from engine.encoding_profiles import build_caption_encoding_settings

        _, video_args, _, _, _ = build_caption_encoding_settings(
            "balanced", self._sdr_video_info(), use_nvenc=True, preview=False, for_composite=True,
        )
        self.assertIn("-colorspace", video_args)
        self.assertIn("-color_primaries", video_args)
        self.assertIn("-color_trc", video_args)
        self.assertIn("-color_range", video_args)
        self.assertIn("-pix_fmt", video_args)

    def test_derush_settings_both_codecs(self) -> None:
        from engine.encoding_profiles import build_derush_encoding_settings

        for use_nvenc in (True, False):
            with self.subTest(use_nvenc=use_nvenc):
                _, video_args, _, _ = build_derush_encoding_settings(
                    source_bitrate=5_000_000, source_fps=30.0,
                    source_width=1080, source_height=1920, use_nvenc=use_nvenc,
                )
                self.assertIn("-colorspace", video_args)
                self.assertIn("-pix_fmt", video_args)
                self.assertIn("yuv420p", video_args)

    def test_flags_propagate_through_composite_command(self) -> None:
        # End-to-end: encoding_profiles output flows into video_codec_args,
        # which template_composite splices verbatim into the ffmpeg command.
        from engine.encoding_profiles import build_caption_encoding_settings

        codec, video_args, audio_codec, audio_args, _ = build_caption_encoding_settings(
            "template", self._sdr_video_info(), use_nvenc=False, preview=False, for_composite=True,
        )
        cmd = build_template_ffmpeg_cmd_video_only(
            video_path="in.mp4", out_path="out.mp4", block=_base_block(),
            video_codec=codec, video_codec_args=video_args,
            audio_codec=audio_codec, audio_codec_args=audio_args,
        )
        joined = " ".join(cmd)
        self.assertIn("-colorspace bt709", joined)
        self.assertIn("-color_primaries bt709", joined)
        self.assertIn("-color_trc bt709", joined)
        self.assertIn("-color_range tv", joined)


class VideoCodecFlagsEarlyReturnTest(unittest.TestCase):
    """engine.render._video_codec_flags — the early-return path (explicit
    video_codec + video_codec_args) is a pure passthrough: it trusts the
    caller (always engine.encoding_profiles in this codebase) to already
    carry bt709 tags + -pix_fmt. This is what mechanically fixed the old
    bug where the early return skipped even -pix_fmt for 10-bit sources."""

    def test_early_return_is_pure_passthrough(self) -> None:
        from engine.render import _video_codec_flags

        args = ["-preset", "p4", "-b:v", "8000000"]
        result = _video_codec_flags(False, "balanced", "h264_nvenc", args)
        self.assertEqual(result, ["-c:v", "h264_nvenc", *args])

    def test_early_return_does_not_inject_anything_extra(self) -> None:
        # Documents current behaviour precisely: if a hypothetical future
        # caller passed codec_args WITHOUT bt709/pix_fmt, render.py would not
        # add them — the guarantee lives entirely in encoding_profiles.py.
        from engine.render import _video_codec_flags

        result = _video_codec_flags(False, "balanced", "libx264", [])
        self.assertEqual(result, ["-c:v", "libx264"])

    def test_fallback_path_carries_bt709_and_pix_fmt(self) -> None:
        from engine.render import _video_codec_flags

        result = _video_codec_flags(False, "balanced", None, None)
        self.assertIn("-colorspace", result)
        self.assertIn("bt709", result)
        self.assertIn("-pix_fmt", result)
        self.assertIn("yuv420p", result)
        self.assertEqual(result[0:2], ["-c:v", "libx264"])


if __name__ == "__main__":
    unittest.main()

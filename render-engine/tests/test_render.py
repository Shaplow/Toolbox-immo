"""Tests for engine.render — hdr_prefilter injection points (P4 garde-fou).

These exercise command construction only (string-building helpers), never a
real ffmpeg subprocess: burn_subtitles/burn_png_overlays/render_preview_frame/
render_overlay_preview_frame all shell out via _run_ffmpeg, which is mocked.

Run with: python3 -m pytest tests/test_render.py -v
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from engine.render import (
    _overlay_filter_chain,
    _video_codec_flags,
    burn_png_overlays,
    burn_subtitles,
    render_overlay_preview_frame,
    render_preview_frame,
)

_TONEMAP_CHAIN = (
    "zscale=t=linear:npl=100,format=gbrpf32le,"
    "tonemap=hable:desat=0,"
    "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)


class BurnSubtitlesHdrTest(unittest.TestCase):
    def test_no_tonemap_on_sdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            burn_subtitles(
                input_video="in.mp4", ass_file="subs.ass", output_video="out.mp4",
                fonts_dir="fonts", video_codec="libx264", video_codec_args=[],
            )
        cmd = mock_run.call_args[0][0]
        vf_index = cmd.index("-vf")
        self.assertNotIn("tonemap", cmd[vf_index + 1])
        self.assertIn("subtitles=", cmd[vf_index + 1])

    def test_tonemap_prefixed_before_subtitles_when_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            burn_subtitles(
                input_video="in.mp4", ass_file="subs.ass", output_video="out.mp4",
                fonts_dir="fonts", video_codec="libx264", video_codec_args=[],
                hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf_value.startswith(_TONEMAP_CHAIN + ","))
        self.assertIn("subtitles=", vf_value)
        # Tonemap must precede the subtitles burn (subtitles are sRGB text/glyphs).
        self.assertLess(vf_value.index("tonemap"), vf_value.index("subtitles="))


class OverlayFilterChainHdrTest(unittest.TestCase):
    def test_no_prefilter_starts_at_input_video(self) -> None:
        chain, out_label = _overlay_filter_chain([("ovl.png", 0.0, 5.0, 0.0)])
        self.assertTrue(chain.startswith("[0:v]"))

    def test_prefilter_reroutes_base_before_overlay(self) -> None:
        chain, out_label = _overlay_filter_chain(
            [("ovl.png", 0.0, 5.0, 0.0)], hdr_prefilter=_TONEMAP_CHAIN
        )
        self.assertTrue(chain.startswith(f"[0:v]{_TONEMAP_CHAIN}[hdr_base]"))
        self.assertIn("[hdr_base][1:v]overlay", chain)
        self.assertNotIn("[0:v][1:v]overlay", chain)


class BurnPngOverlaysHdrTest(unittest.TestCase):
    def test_no_overlays_no_hdr_uses_plain_map(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            burn_png_overlays(
                input_video="in.mp4", overlays=[], output_video="out.mp4",
                video_codec="libx264", video_codec_args=[],
            )
        cmd = mock_run.call_args[0][0]
        self.assertIn("-map", cmd)
        self.assertNotIn("-filter_complex", cmd)

    def test_no_overlays_but_hdr_still_tonemaps_via_filter_complex(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            burn_png_overlays(
                input_video="in.mp4", overlays=[], output_video="out.mp4",
                video_codec="libx264", video_codec_args=[],
                hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        self.assertIn("-filter_complex", cmd)
        fc = cmd[cmd.index("-filter_complex") + 1]
        self.assertIn("tonemap=hable", fc)
        self.assertIn("[vout]", fc)
        self.assertIn("-map", cmd)
        map_index = cmd.index("-map")
        self.assertEqual(cmd[map_index + 1], "[vout]")

    def test_with_overlays_and_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            burn_png_overlays(
                input_video="in.mp4",
                overlays=[("ovl.png", 0.0, 5.0, 0.0)],
                output_video="out.mp4",
                video_codec="libx264", video_codec_args=[],
                hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        fc = cmd[cmd.index("-filter_complex") + 1]
        self.assertIn("tonemap=hable", fc)
        self.assertLess(fc.index("tonemap"), fc.index("overlay=0:0"))


class PreviewFrameHdrTest(unittest.TestCase):
    def test_render_preview_frame_no_tonemap_on_sdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            render_preview_frame(
                input_video="in.mp4", ass_file="subs.ass",
                output_image="out.jpg", fonts_dir="fonts",
            )
        cmd = mock_run.call_args[0][0]
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertNotIn("tonemap", vf_value)

    def test_render_preview_frame_tonemap_when_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            render_preview_frame(
                input_video="in.mp4", ass_file="subs.ass",
                output_image="out.jpg", fonts_dir="fonts",
                hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf_value.startswith(_TONEMAP_CHAIN + ","))

    def test_render_overlay_preview_frame_no_overlay_no_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            render_overlay_preview_frame(input_video="in.mp4", output_image="out.jpg")
        cmd = mock_run.call_args[0][0]
        self.assertNotIn("-filter_complex", cmd)
        self.assertIn("-map", cmd)

    def test_render_overlay_preview_frame_no_overlay_with_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            render_overlay_preview_frame(
                input_video="in.mp4", output_image="out.jpg", hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        fc = cmd[cmd.index("-filter_complex") + 1]
        self.assertIn("tonemap=hable", fc)

    def test_render_overlay_preview_frame_with_overlay_and_hdr(self) -> None:
        with patch("engine.render._run_ffmpeg") as mock_run:
            render_overlay_preview_frame(
                input_video="in.mp4", output_image="out.jpg",
                overlay_image="ovl.png", hdr_prefilter=_TONEMAP_CHAIN,
            )
        cmd = mock_run.call_args[0][0]
        fc = cmd[cmd.index("-filter_complex") + 1]
        self.assertIn("tonemap=hable", fc)
        self.assertLess(fc.index("tonemap"), fc.index("overlay=0:0"))


class EncodeConcatOverlayVideoTagsTest(unittest.TestCase):
    def test_bt709_tags_present_pix_fmt_stays_argb(self) -> None:
        import tempfile
        from pathlib import Path
        from engine.render import encode_concat_overlay_video

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "overlay.mov"
            with patch("engine.render._run_ffmpeg") as mock_run:
                encode_concat_overlay_video([("frame1.png", 1.0)], out)
            cmd = mock_run.call_args[0][0]
        self.assertIn("-colorspace", cmd)
        pix_fmt_index = cmd.index("-pix_fmt")
        self.assertEqual(cmd[pix_fmt_index + 1], "argb")


class VideoCodecFlagsTest(unittest.TestCase):
    def test_fallback_includes_bt709(self) -> None:
        flags = _video_codec_flags(False, "balanced", None, None)
        self.assertIn("-colorspace", flags)
        self.assertIn("-pix_fmt", flags)


if __name__ == "__main__":
    unittest.main()

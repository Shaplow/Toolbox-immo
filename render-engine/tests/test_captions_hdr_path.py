"""
Tests for the captions path HDR garde-fou wiring (P4, Lot 3 residual gap).

Covers the three concrete callers that previously only logged a "tonemap not
wired" warning: runpod_worker.py::_handle_captions, api.py's /api/preview and
/api/render routes — plus the app.py plumbing (_render_captions_video /
_render_captions_preview → engine.render) they all share.

Each caller-level test mocks out I/O (download/upload/font prep/encoding
settings) and asserts the ``hdr_prefilter`` kwarg it computes is forwarded
to the app.py wrapper. The app.py-level tests instead mock only the
colorimetry-probing context (not burn_subtitles/render_preview_frame
themselves) and assert the *actual* ffmpeg command constructed by
engine.render contains the tonemap chain — mirroring the pattern already
used in tests/test_render.py.

Run with: python3 -m pytest tests/test_captions_hdr_path.py -v
"""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from engine.probe import VideoInfo

_TONEMAP_CHAIN = (
    "zscale=t=linear:npl=100,format=gbrpf32le,"
    "tonemap=hable:desat=0,"
    "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)

_SRT_SAMPLE = "1\n00:00:00,000 --> 00:00:01,000\nhello\n"


def _sdr_video_info(**overrides) -> VideoInfo:
    base = dict(width=1080, height=1920, duration=5.0)
    base.update(overrides)
    return VideoInfo(**base)


def _hdr_video_info(**overrides) -> VideoInfo:
    base = dict(
        width=1080,
        height=1920,
        duration=5.0,
        color_transfer="arib-std-b67",
        color_primaries="bt2020",
        color_space="bt2020nc",
        pix_fmt="yuv420p10le",
    )
    base.update(overrides)
    return VideoInfo(**base)


# ── app.py plumbing: _render_captions_video / _render_captions_preview ──────


class RenderCaptionsVideoHdrForwardingTest(unittest.TestCase):
    """`app._render_captions_video` must forward hdr_prefilter into the real
    ffmpeg command built by engine.render.burn_subtitles."""

    def _run(self, **kwargs):
        import app as app_module

        video_info = _sdr_video_info()
        with patch.object(
            app_module, "_prepare_captions_context",
            return_value=(video_info, MagicMock(), Path("fonts")),
        ), patch.object(
            app_module, "_render_ass_from_context", return_value=Path("captions.ass"),
        ), patch("engine.render._run_ffmpeg") as mock_run:
            app_module._render_captions_video(
                words=[],
                video_path="in.mp4",
                cfg=MagicMock(),
                output_video="out.mp4",
                auto_safe_area=True,
                **kwargs,
            )
        return mock_run.call_args[0][0]

    def test_tonemap_in_command_when_hdr_prefilter_given(self) -> None:
        cmd = self._run(hdr_prefilter=_TONEMAP_CHAIN)
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf_value.startswith(_TONEMAP_CHAIN + ","))
        self.assertIn("subtitles=", vf_value)

    def test_no_tonemap_when_hdr_prefilter_default_none(self) -> None:
        cmd = self._run()
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertNotIn("tonemap", vf_value)


class RenderCaptionsPreviewHdrForwardingTest(unittest.TestCase):
    """`app._render_captions_preview` must forward hdr_prefilter into the
    real ffmpeg command built by engine.render.render_preview_frame."""

    def _run(self, **kwargs):
        import app as app_module

        video_info = _sdr_video_info()
        with patch.object(
            app_module, "_prepare_captions_context",
            return_value=(video_info, MagicMock(), Path("fonts")),
        ), patch.object(
            app_module, "_render_ass_from_context", return_value=Path("captions.ass"),
        ), patch("engine.render._run_ffmpeg") as mock_run:
            app_module._render_captions_preview(
                words=[],
                video_path="in.mp4",
                cfg=MagicMock(),
                output_image="out.jpg",
                at_seconds=1.0,
                auto_safe_area=True,
                **kwargs,
            )
        return mock_run.call_args[0][0]

    def test_tonemap_in_command_when_hdr_prefilter_given(self) -> None:
        cmd = self._run(hdr_prefilter=_TONEMAP_CHAIN)
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf_value.startswith(_TONEMAP_CHAIN + ","))

    def test_no_tonemap_when_hdr_prefilter_default_none(self) -> None:
        cmd = self._run()
        vf_value = cmd[cmd.index("-vf") + 1]
        self.assertNotIn("tonemap", vf_value)


# ── runpod_worker.py::_handle_captions ───────────────────────────────────────


class HandleCaptionsHdrWiringTest(unittest.TestCase):
    def _base_input(self) -> dict:
        return {
            "video_url": "https://example.com/video.mp4",
            "srt_content": _SRT_SAMPLE,
            "config": {},
            "output_key": "outputs/test.mp4",
        }

    def _run(self, video_info: VideoInfo):
        import runpod_worker

        encoding_debug = {
            "source_video_bitrate": 0,
            "effective_video_bitrate": 0,
            "maxrate": 0,
            "bufsize": 0,
            "audio_bitrate": 0,
        }
        with patch.object(runpod_worker, "_download_file"), patch.object(
            runpod_worker, "probe_video", return_value=video_info,
        ), patch.object(
            runpod_worker, "prepare_runtime_fonts", return_value=Path("/tmp/fonts"),
        ), patch.object(
            runpod_worker, "_nvenc_enabled", return_value=False,
        ), patch.object(
            runpod_worker, "build_caption_encoding_settings",
            return_value=("libx264", [], "aac", [], encoding_debug),
        ), patch.object(
            runpod_worker, "hdr_to_sdr_prefilter", return_value=_TONEMAP_CHAIN,
        ) as mock_prefilter, patch.object(
            runpod_worker, "_render_captions_video",
        ) as mock_render, patch.object(
            runpod_worker, "_upload_to_r2", return_value="https://r2.example/out.mp4",
        ):
            runpod_worker._handle_captions(self._base_input())
        return mock_prefilter, mock_render

    def test_hdr_source_forwards_prefilter(self) -> None:
        mock_prefilter, mock_render = self._run(_hdr_video_info())
        mock_prefilter.assert_called_once()
        self.assertEqual(mock_render.call_args.kwargs["hdr_prefilter"], _TONEMAP_CHAIN)

    def test_sdr_source_forwards_none(self) -> None:
        mock_prefilter, mock_render = self._run(_sdr_video_info())
        mock_prefilter.assert_not_called()
        self.assertIsNone(mock_render.call_args.kwargs["hdr_prefilter"])


# ── api.py: /api/preview and /api/render ─────────────────────────────────────


class ApiCaptionsHdrWiringTest(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient
        import api as api_module

        self.api_module = api_module
        self.client = TestClient(api_module.app)

    def _files(self):
        return {
            "video": ("in.mp4", b"fake video bytes", "video/mp4"),
            "subtitles": ("subs.srt", _SRT_SAMPLE.encode("utf-8"), "text/plain"),
        }

    def test_preview_forwards_prefilter_when_hdr(self) -> None:
        with patch.object(
            self.api_module, "probe_video", return_value=_hdr_video_info(),
        ), patch.object(
            self.api_module, "hdr_to_sdr_prefilter", return_value=_TONEMAP_CHAIN,
        ) as mock_prefilter, patch.object(
            self.api_module, "_render_captions_preview", return_value=Path("captions.ass"),
        ) as mock_preview:
            resp = self.client.post("/api/preview", files=self._files(), data={"config": "{}"})
        self.assertEqual(resp.status_code, 200)
        mock_prefilter.assert_called_once()
        self.assertEqual(mock_preview.call_args.kwargs["hdr_prefilter"], _TONEMAP_CHAIN)

    def test_preview_forwards_none_when_sdr(self) -> None:
        with patch.object(
            self.api_module, "probe_video", return_value=_sdr_video_info(),
        ), patch.object(
            self.api_module, "hdr_to_sdr_prefilter",
        ) as mock_prefilter, patch.object(
            self.api_module, "_render_captions_preview", return_value=Path("captions.ass"),
        ) as mock_preview:
            resp = self.client.post("/api/preview", files=self._files(), data={"config": "{}"})
        self.assertEqual(resp.status_code, 200)
        mock_prefilter.assert_not_called()
        self.assertIsNone(mock_preview.call_args.kwargs["hdr_prefilter"])

    def test_render_forwards_prefilter_when_hdr(self) -> None:
        with patch.object(
            self.api_module, "probe_video", return_value=_hdr_video_info(),
        ), patch.object(
            self.api_module, "hdr_to_sdr_prefilter", return_value=_TONEMAP_CHAIN,
        ) as mock_prefilter, patch.object(
            self.api_module, "_render_captions_video", return_value=Path("captions.ass"),
        ) as mock_render:
            resp = self.client.post(
                "/api/render", files=self._files(), data={"config": "{}", "preview_mode": "true"},
            )
        self.assertEqual(resp.status_code, 200)
        mock_prefilter.assert_called_once()
        self.assertEqual(mock_render.call_args.kwargs["hdr_prefilter"], _TONEMAP_CHAIN)

    def test_render_forwards_none_when_sdr(self) -> None:
        with patch.object(
            self.api_module, "probe_video", return_value=_sdr_video_info(),
        ), patch.object(
            self.api_module, "hdr_to_sdr_prefilter",
        ) as mock_prefilter, patch.object(
            self.api_module, "_render_captions_video", return_value=Path("captions.ass"),
        ) as mock_render:
            resp = self.client.post(
                "/api/render", files=self._files(), data={"config": "{}", "preview_mode": "true"},
            )
        self.assertEqual(resp.status_code, 200)
        mock_prefilter.assert_not_called()
        self.assertIsNone(mock_render.call_args.kwargs["hdr_prefilter"])


if __name__ == "__main__":
    unittest.main()

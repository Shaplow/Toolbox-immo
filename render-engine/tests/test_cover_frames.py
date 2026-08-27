"""Tests unitaires de engine.cover_frames — la commande ffmpeg et la politique
d'échec par frame. Aucun ffmpeg réel n'est lancé.

Run with: python3 -m pytest tests/test_cover_frames.py -v
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from engine.cover_frames import (
    ExtractSettings,
    build_frame_command,
    extract_cover_frames,
)

SETTINGS = ExtractSettings(max_edge=1920, concurrency=2, frame_timeout_s=30)
_TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0"


class BuildFrameCommandTest(unittest.TestCase):
    def test_scale_comes_before_any_other_filter(self) -> None:
        # Les rushs sont des .MOV iPhone 4K alors que la cover est composée en
        # 1080×1920 : tonemapper du 4K est du travail intégralement jeté, et c'est ce
        # qui faisait exploser le budget de la requête.
        cmd = build_frame_command(
            Path("in.mov"), 3.0, Path("out.jpg"), max_edge=1920, hdr_prefilter=_TONEMAP
        )
        vf = cmd[cmd.index("-vf") + 1]
        self.assertTrue(vf.startswith("scale=1920:1920:force_original_aspect_ratio=decrease"), vf)
        self.assertLess(vf.index("scale="), vf.index("tonemap="))

    def test_no_tonemap_on_an_sdr_source(self) -> None:
        cmd = build_frame_command(
            Path("in.mp4"), 1.0, Path("out.jpg"), max_edge=1280, hdr_prefilter=None
        )
        self.assertEqual(cmd[cmd.index("-vf") + 1], "scale=1280:1280:force_original_aspect_ratio=decrease")

    def test_seek_is_placed_before_the_input(self) -> None:
        # -ss AVANT -i = seek rapide sur keyframe. L'inverse décoderait tout le clip
        # depuis le début pour chacune des 36 frames.
        cmd = build_frame_command(Path("in.mp4"), 2.5, Path("out.jpg"), max_edge=1920, hdr_prefilter=None)
        self.assertLess(cmd.index("-ss"), cmd.index("-i"))
        self.assertEqual(cmd[cmd.index("-ss") + 1], "2.5")


class ExtractCoverFramesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.out_dir = Path(self._tmp.name)
        self.video = self.out_dir / "source.mov"
        self.video.write_bytes(b"\x00" * 16)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run(self, timestamps, side_effect):
        with patch("engine.cover_frames.subprocess.run", side_effect=side_effect) as mock_run:
            results = extract_cover_frames(
                self.video, timestamps, self.out_dir, settings=SETTINGS, hdr_prefilter=None
            )
        return results, mock_run

    @staticmethod
    def _ok(cmd, **kwargs):
        Path(cmd[-1]).write_bytes(b"\xff\xd8jpeg")
        return subprocess.CompletedProcess(cmd, 0, b"", b"")

    def test_input_order_is_preserved_despite_the_thread_pool(self) -> None:
        results, _ = self._run([3.0, 1.0, 2.0], self._ok)
        self.assertEqual([r.requested_timestamp for r in results], [3.0, 1.0, 2.0])
        self.assertTrue(all(r.ok for r in results))

    def test_a_failing_frame_does_not_raise_and_carries_its_reason(self) -> None:
        # La politique d'échec appartient à l'appelant (422 HTTP, job en échec) —
        # le cœur se contente de rapporter.
        def side_effect(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, b"", b"moov atom not found\nInvalid data found")

        results, _ = self._run([5.0], side_effect)
        self.assertFalse(results[0].ok)
        self.assertIn("Invalid data found", results[0].error or "")

    def test_fast_seek_failure_falls_back_half_a_second_earlier(self) -> None:
        def side_effect(cmd, **kwargs):
            if float(cmd[cmd.index("-ss") + 1]) >= 5.0:
                return subprocess.CompletedProcess(cmd, 1, b"", b"Output file does not contain any stream")
            return self._ok(cmd, **kwargs)

        results, _ = self._run([5.0], side_effect)
        self.assertTrue(results[0].ok)
        self.assertAlmostEqual(results[0].timestamp, 4.5)
        # requested_timestamp reste la position DEMANDÉE : c'est la clé de jointure
        # avec le pick d'origine côté appelant.
        self.assertAlmostEqual(results[0].requested_timestamp, 5.0)

    def test_no_fallback_below_half_a_second(self) -> None:
        # Un repli sous 0 n'aurait aucun sens : on ne retente pas.
        def side_effect(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, b"", b"boom")

        _, mock_run = self._run([0.2], side_effect)
        self.assertEqual(mock_run.call_count, 1)

    def test_a_timeout_is_reported_not_raised(self) -> None:
        def side_effect(cmd, **kwargs):
            raise subprocess.TimeoutExpired(cmd, SETTINGS.frame_timeout_s)

        results, _ = self._run([1.0], side_effect)
        self.assertFalse(results[0].ok)
        self.assertIn("timeout ffmpeg", results[0].error or "")

    def test_an_empty_output_file_counts_as_a_failure(self) -> None:
        # ffmpeg peut sortir en 0 et ne rien écrire d'exploitable.
        def side_effect(cmd, **kwargs):
            Path(cmd[-1]).write_bytes(b"")
            return subprocess.CompletedProcess(cmd, 0, b"", b"")

        results, _ = self._run([0.2], side_effect)
        self.assertFalse(results[0].ok)

    def test_local_paths_are_masked_in_the_reported_reason(self) -> None:
        # Le message remonte jusqu'à l'UI : il ne doit pas exposer l'arborescence
        # du conteneur.
        def side_effect(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, b"", f"{self.video}: Invalid data".encode())

        results, _ = self._run([0.2], side_effect)
        self.assertIn("<source>", results[0].error or "")
        self.assertNotIn(str(self.video), results[0].error or "")

    def test_no_timestamps_means_no_ffmpeg_at_all(self) -> None:
        results, mock_run = self._run([], self._ok)
        self.assertEqual(results, [])
        self.assertEqual(mock_run.call_count, 0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

"""Tests for /api/extract-covers — contrat de sortie quand ffmpeg échoue.

Historique : l'endpoint filtrait silencieusement les frames en échec et
répondait 200 + [] quand elles échouaient toutes. Côté web ça devenait
« Le render-engine n'a extrait aucune frame », un message qui masquait la
cause réelle et poussait l'utilisateur à relancer à l'aveugle.

Run with: python3 -m pytest tests/test_extract_covers.py -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

import api


class _FakeProc:
    """Remplace un asyncio.subprocess.Process pour ffmpeg."""

    def __init__(self, returncode: int, stderr: bytes, on_run=None) -> None:
        self.returncode = returncode
        self._stderr = stderr
        self._on_run = on_run

    async def communicate(self):
        if self._on_run is not None:
            self._on_run()
        return b"", self._stderr

    def kill(self) -> None:  # pragma: no cover - jamais atteint ici
        pass


def _ffmpeg_output_path(cmd) -> Path:
    """Le dernier argument de la commande ffmpeg est le fichier de sortie."""
    return Path(cmd[-1])


class ExtractCoversContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.outputs = Path(self._tmp.name)
        # Vidéo source locale bidon : _local_outputs_path_from_url la résout sans réseau.
        (self.outputs / "temp").mkdir(parents=True, exist_ok=True)
        self.video = self.outputs / "source.mp4"
        self.video.write_bytes(b"\x00" * 1024)
        self.client = TestClient(api.app)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _post(self, timestamps, subprocess_factory):
        with patch.object(api, "OUTPUTS_DIR", self.outputs), \
             patch.object(api, "probe_video", side_effect=RuntimeError("probe indisponible")), \
             patch("asyncio.create_subprocess_exec", side_effect=subprocess_factory):
            return self.client.post(
                "/api/extract-covers",
                data={
                    "video_url": "/outputs/source.mp4",
                    "timestamps_json": json.dumps(timestamps),
                },
            )

    def test_all_frames_fail_returns_422_with_the_real_reason(self) -> None:
        async def factory(*cmd, **kwargs):
            return _FakeProc(1, b"[mov,mp4] moov atom not found\nInvalid data found when processing input")

        res = self._post([1.0, 2.0, 3.0], factory)

        self.assertEqual(res.status_code, 422)
        detail = res.json()["detail"]
        self.assertIn("Aucune frame extraite", detail)
        self.assertIn("Invalid data found", detail)

    def test_partial_failure_still_returns_200_with_the_frames_obtained(self) -> None:
        async def factory(*cmd, **kwargs):
            out = _ffmpeg_output_path(cmd)
            # La frame à 2.000s échoue (et son repli à 1.500s aussi) ; les autres passent.
            if "2.000" in out.name or "1.500" in out.name:
                return _FakeProc(1, b"Output file is empty")
            return _FakeProc(0, b"", on_run=lambda: out.write_bytes(b"\xff\xd8jpeg"))

        res = self._post([1.0, 2.0, 3.0], factory)

        self.assertEqual(res.status_code, 200)
        frames = res.json()
        self.assertEqual(len(frames), 2)
        self.assertEqual(res.headers["X-Cover-Extract-Failures"], "1")
        # Le payload de succès reste un tableau nu — contrat inchangé pour les appelants.
        self.assertTrue(all("url" in frame and "timestamp" in frame for frame in frames))

    def test_fast_seek_failure_falls_back_half_a_second_earlier(self) -> None:
        async def factory(*cmd, **kwargs):
            out = _ffmpeg_output_path(cmd)
            # Le seek rapide à 5.000s ne rend rien (timestamp au-delà de la dernière
            # frame décodable) ; le repli à 4.500s réussit.
            if float(cmd[cmd.index("-ss") + 1]) >= 5.0:
                return _FakeProc(1, b"Output file does not contain any stream")
            return _FakeProc(0, b"", on_run=lambda: out.write_bytes(b"\xff\xd8jpeg"))

        res = self._post([5.0], factory)

        self.assertEqual(res.status_code, 200)
        frames = res.json()
        self.assertEqual(len(frames), 1)
        self.assertAlmostEqual(frames[0]["timestamp"], 4.5)
        # requestedTimestamp permet au web de retrouver le pick d'origine (provenance slot).
        self.assertAlmostEqual(frames[0]["requestedTimestamp"], 5.0)


    def test_frames_are_downscaled_before_any_other_filter(self) -> None:
        # Les rushs sont des .MOV iPhone 4K alors que la cover est composée en
        # 1080×1920 : tonemapper puis encoder du 4K est du travail jeté, et sur une
        # source HLG c'est ce qui faisait exploser le budget de la requête.
        seen: list[list[str]] = []

        async def factory(*cmd, **kwargs):
            seen.append(list(cmd))
            out = _ffmpeg_output_path(cmd)
            return _FakeProc(0, b"", on_run=lambda: out.write_bytes(b"\xff\xd8jpeg"))

        res = self._post([1.0], factory)

        self.assertEqual(res.status_code, 200)
        vf = seen[0][seen[0].index("-vf") + 1]
        self.assertTrue(vf.startswith("scale=1920:1920:force_original_aspect_ratio=decrease"), vf)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

"""Contrat HTTP de /api/extract-covers.

Le cœur ffmpeg (téléchargement, probe HDR, extraction) vit dans
engine/cover_frames.py et a ses propres tests unitaires — ici on ne teste que ce
que la ROUTE en fait : codes de statut, forme du payload, en-têtes.

Historique : l'endpoint filtrait silencieusement les frames en échec et répondait
200 + [] quand elles échouaient toutes. Côté web ça devenait « Le render-engine n'a
extrait aucune frame », un message qui masquait la cause réelle et poussait
l'utilisateur à relancer à l'aveugle.

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
from engine.cover_frames import FrameResult


def _frame(ts: float, *, extracted: float | None = None) -> FrameResult:
    return FrameResult(
        requested_timestamp=ts,
        timestamp=extracted if extracted is not None else ts,
        path=Path(f"/tmp/cover_{ts:.3f}.jpg"),
        error=None,
    )


def _failed(ts: float, reason: str = "moov atom not found") -> FrameResult:
    return FrameResult(requested_timestamp=ts, timestamp=ts, path=None, error=reason)


class ExtractCoversContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.outputs = Path(self._tmp.name)
        self.video = self.outputs / "source.mp4"
        self.video.write_bytes(b"\x00" * 1024)
        self.client = TestClient(api.app)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _post(self, timestamps, results):
        with patch.object(api, "OUTPUTS_DIR", self.outputs), \
             patch.object(api, "ensure_local_source", return_value=self.video), \
             patch.object(api, "extract_cover_frames", return_value=results):
            return self.client.post(
                "/api/extract-covers",
                data={
                    "video_url": "https://cdn.example/rush.mov",
                    "timestamps_json": json.dumps(timestamps),
                },
            )

    def test_all_frames_fail_returns_422_with_the_real_reason(self) -> None:
        res = self._post([1.0, 2.0, 3.0], [_failed(1.0), _failed(2.0), _failed(3.0)])

        self.assertEqual(res.status_code, 422)
        detail = res.json()["detail"]
        self.assertIn("Aucune frame extraite", detail)
        self.assertIn("moov atom not found", detail)

    def test_partial_failure_still_returns_200_with_the_frames_obtained(self) -> None:
        res = self._post([1.0, 2.0, 3.0], [_frame(1.0), _failed(2.0), _frame(3.0)])

        self.assertEqual(res.status_code, 200)
        frames = res.json()
        self.assertEqual(len(frames), 2)
        self.assertEqual(res.headers["X-Cover-Extract-Failures"], "1")
        # Le payload de succès reste un tableau nu — contrat inchangé pour les appelants.
        self.assertTrue(all("url" in f and "timestamp" in f for f in frames))

    def test_a_fallback_frame_echoes_the_requested_timestamp(self) -> None:
        # Sans ça, le web ne peut plus rattacher la frame à son pick d'origine
        # (la tolérance de matching est bien plus fine que le décalage du repli).
        res = self._post([5.0], [_frame(5.0, extracted=4.5)])

        frames = res.json()
        self.assertAlmostEqual(frames[0]["timestamp"], 4.5)
        self.assertAlmostEqual(frames[0]["requestedTimestamp"], 5.0)

    def test_a_frame_without_fallback_carries_no_requested_timestamp(self) -> None:
        res = self._post([5.0], [_frame(5.0)])
        self.assertNotIn("requestedTimestamp", res.json()[0])

    def test_empty_timestamps_is_rejected_before_any_work(self) -> None:
        res = self.client.post(
            "/api/extract-covers",
            data={"video_url": "https://cdn.example/rush.mov", "timestamps_json": "[]"},
        )
        self.assertEqual(res.status_code, 400)

    def test_an_unreachable_source_is_a_400_not_a_500(self) -> None:
        with patch.object(api, "OUTPUTS_DIR", self.outputs), \
             patch.object(api, "ensure_local_source", side_effect=api.CoverSourceError("hôte injoignable")):
            res = self.client.post(
                "/api/extract-covers",
                data={"video_url": "https://cdn.example/rush.mov", "timestamps_json": "[1.0]"},
            )
        self.assertEqual(res.status_code, 400)
        self.assertIn("hôte injoignable", res.json()["detail"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

"""Handler RunPod `cover_frames` — contrat d'entrée/sortie et politique d'échec.

Aucun réseau, aucun ffmpeg : `_download_file`, `extract_cover_frames` et
`_upload_to_r2` sont stubés. On teste l'orchestration, pas leurs internes.

Run with: python3 -m pytest tests/test_cover_frames_worker.py -v
"""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

import runpod_worker
from engine.cover_frames import FrameResult


def _ok(ts: float, path: str = "/tmp/f.jpg") -> FrameResult:
    return FrameResult(requested_timestamp=ts, timestamp=ts, path=Path(path), error=None)


def _ko(ts: float, reason: str = "moov atom not found") -> FrameResult:
    return FrameResult(requested_timestamp=ts, timestamp=ts, path=None, error=reason)


BASE_INPUT = {
    "job_type": "cover_frames",
    "pack_id": "pack-1",
    "attempt": 3,
    "key_prefix": "covers/user-1/pack-1/a3/",
    "sources": [
        {"source_url": "https://cdn.example/rush-a.mov", "frames": [{"id": "c1", "timestamp": 1.0}, {"id": "c2", "timestamp": 2.0}]},
        {"source_url": "https://cdn.example/rush-b.mov", "frames": [{"id": "c3", "timestamp": 1.5}]},
    ],
}


class CoverFramesHandlerTest(unittest.TestCase):
    def _run(self, *, extract_side_effect, download_side_effect=None, inp=None):
        with patch.object(runpod_worker, "_download_file", side_effect=download_side_effect or (lambda url, dest: dest.write_bytes(b"x"))), \
             patch.object(runpod_worker, "extract_cover_frames", side_effect=extract_side_effect), \
             patch.object(runpod_worker, "_upload_to_r2", side_effect=lambda key, path, ct: f"https://r2.example/{key}"):
            return runpod_worker.handler({"input": inp or BASE_INPUT})

    def test_uploads_one_object_per_candidate_id(self) -> None:
        # La clé porte l'id du candidat, pas un index : deux picks au même timestamp
        # (deux slots alimentés par le même rush) restent deux objets distincts.
        out = self._run(extract_side_effect=lambda path, ts, out_dir, **kw: [_ok(t) for t in ts])

        self.assertEqual(out["pack_id"], "pack-1")
        self.assertEqual(out["attempt"], 3)
        self.assertEqual({f["id"] for f in out["frames"]}, {"c1", "c2", "c3"})
        self.assertEqual(out["frames"][0]["key"], "covers/user-1/pack-1/a3/c1.jpg")
        self.assertEqual(out["failures"], [])

    def test_a_dead_source_costs_its_frames_not_the_pack(self) -> None:
        def download(url, dest):
            if "rush-b" in url:
                raise RuntimeError("404")
            dest.write_bytes(b"x")

        out = self._run(
            extract_side_effect=lambda path, ts, out_dir, **kw: [_ok(t) for t in ts],
            download_side_effect=download,
        )

        self.assertEqual({f["id"] for f in out["frames"]}, {"c1", "c2"})
        self.assertEqual([f["id"] for f in out["failures"]], ["c3"])

    def test_partial_extraction_is_reported_per_candidate(self) -> None:
        out = self._run(
            extract_side_effect=lambda path, ts, out_dir, **kw: [
                _ok(t) if t != 2.0 else _ko(t) for t in ts
            ],
        )
        self.assertEqual({f["id"] for f in out["frames"]}, {"c1", "c3"})
        self.assertEqual([f["id"] for f in out["failures"]], ["c2"])

    def test_raises_only_when_nothing_could_be_extracted(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            self._run(extract_side_effect=lambda path, ts, out_dir, **kw: [_ko(t) for t in ts])
        self.assertIn("aucune frame extraite", str(ctx.exception))

    def test_missing_required_fields_is_a_clear_error(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            runpod_worker.handler({"input": {"job_type": "cover_frames", "pack_id": "p"}})
        self.assertIn("key_prefix", str(ctx.exception))

    def test_each_source_is_removed_before_the_next_one(self) -> None:
        # Le disque du worker ne fait que quelques Go : deux rushs 4K simultanés
        # suffisent à provoquer un ENOSPC.
        alive: list[Path] = []

        def download(url, dest):
            dest.write_bytes(b"x")
            alive.append(dest)

        def extract(path, ts, out_dir, **kw):
            # Au moment d'extraire la 2e source, la 1re ne doit plus être là.
            self.assertEqual([p for p in alive if p.exists()], [path])
            return [_ok(t) for t in ts]

        self._run(extract_side_effect=extract, download_side_effect=download)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

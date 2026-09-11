"""Handler RunPod `media_autocut_batch` — budgets, isolation des échecs, contrat de sortie.

Aucun réseau, aucun GPU : `_download_file` et `analyze_autocut` sont stubés.
On teste l'orchestration (un pack ne doit plus jamais perdre son travail), pas
les internes de Whisper.

Contexte : un asset dont le téléchargement ne se terminait jamais figeait le
worker jusqu'au kill RunPod, sans `results`, sans log — les analyses déjà
réussies du pack étaient perdues et les 16 jobs recevaient un message générique.

Run with: python3 -m pytest tests/test_media_autocut_worker.py -v
"""
from __future__ import annotations

import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import runpod_worker


def _analysis(start: float = 0.4, end: float = 5.0) -> dict:
    return {
        "proposed_start": start,
        "proposed_end": end,
        "transcript_json": [{"text": "bonjour", "start": start, "end": end, "words": []}],
        "language": "fr",
        "fallback": False,
    }


def _input(n: int, batch_id: str = "batch-1", **extra) -> dict:
    return {
        "job_type": "media_autocut_batch",
        "batch_id": batch_id,
        "language": "fr",
        "model_size": "large-v3-turbo",
        "assets": [
            {
                "job_id": f"job{i}",
                "asset_url": f"https://cdn.example/rush-{i}.mp4",
                "filename": f"IMG_27{i}.mp4",
            }
            for i in range(n)
        ],
        **extra,
    }


def _noop_download(url, dest, *, budget_s=None):  # noqa: ANN001
    Path(dest).write_bytes(b"x")


class MediaAutocutBatchTest(unittest.TestCase):
    # ── Contrat de sortie ────────────────────────────────────────────────────
    def test_une_entree_par_job_id_dans_l_ordre(self):
        with patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            out = runpod_worker._handle_media_autocut_batch(_input(3))

        self.assertEqual(out["batch_id"], "batch-1")
        self.assertEqual([r["job_id"] for r in out["results"]], ["job0", "job1", "job2"])
        self.assertTrue(all("error" not in r for r in out["results"]))
        # transcript_json est sérialisé en JSON pour le webhook, pas laissé en liste.
        self.assertIsInstance(out["results"][0]["transcript_json"], str)

    def test_asset_url_manquant_sort_une_erreur_sans_bloquer(self):
        inp = _input(2)
        inp["assets"][0]["asset_url"] = ""
        with patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            out = runpod_worker._handle_media_autocut_batch(inp)

        self.assertEqual(out["results"][0]["error"], "asset_url manquant")
        self.assertNotIn("error", out["results"][1])

    # ── Isolation des échecs ─────────────────────────────────────────────────
    def test_une_exception_ne_coute_que_son_asset(self):
        def flaky(**kw):
            if "rush-1" in str(kw["audio_path"]) or kw["audio_path"].name == "asset_1.mp4":
                raise RuntimeError("[autocut] Aucun segment Whisper produit pour asset_1.mp4")
            return _analysis()

        with patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", flaky):
            out = runpod_worker._handle_media_autocut_batch(_input(3))

        self.assertEqual(len(out["results"]), 3)
        self.assertNotIn("error", out["results"][0])
        self.assertIn("Aucun segment Whisper", out["results"][1]["error"])
        self.assertNotIn("error", out["results"][2])

    # ── Watchdog : gel au téléchargement ─────────────────────────────────────
    def test_gel_au_download_la_boucle_continue(self):
        """Le cas de l'incident : un asset dont le corps HTTP n'arrive jamais.

        Le thread est abandonné, l'asset sort en erreur en nommant le fichier,
        et les assets SUIVANTS sont analysés normalement.
        """
        never = threading.Event()
        self.addCleanup(never.set)

        def hanging_download(url, dest, *, budget_s=None):  # noqa: ANN001
            if "rush-1" in url:
                never.wait(30)
            Path(dest).write_bytes(b"x")

        # item (0.4s) > download (0.1s) : le thread abandonné a forcément crevé
        # son propre budget, il lèvera DownloadBudgetExceeded et mourra seul.
        with patch.object(runpod_worker, "_AUTOCUT_ITEM_BUDGET_S", 0.4), \
             patch.object(runpod_worker, "_AUTOCUT_DOWNLOAD_BUDGET_S", 0.1), \
             patch.object(runpod_worker, "_download_file", hanging_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            out = runpod_worker._handle_media_autocut_batch(_input(3))

        self.assertEqual(len(out["results"]), 3)
        self.assertIn("Téléchargement", out["results"][1]["error"])
        self.assertIn("IMG_271.mp4", out["results"][1]["error"])
        # Le pack N'EST PAS interrompu : un thread bloqué en I/O réseau est inoffensif.
        self.assertNotIn("error", out["results"][0])
        self.assertNotIn("error", out["results"][2])

    def test_download_abandonne_avant_son_propre_budget_arrete_le_pack(self):
        """Fenêtre étroite mais réelle : en fin de pack, `item_timeout` est raboté
        par le budget restant et peut passer SOUS le budget de download. Le thread
        abandonné peut alors terminer son téléchargement et enchaîner sur
        analyze_autocut en fond — deux inférences Whisper concurrentes sur le même
        modèle en cache, sans verrou. Le pack doit s'arrêter dans ce cas."""
        never = threading.Event()
        self.addCleanup(never.set)

        def hanging_download(url, dest, *, budget_s=None):  # noqa: ANN001
            if "rush-1" in url:
                never.wait(30)
            Path(dest).write_bytes(b"x")

        # item (0.3s) < download (5s) : rien ne garantit la mort du thread.
        with patch.object(runpod_worker, "_AUTOCUT_ITEM_BUDGET_S", 0.3), \
             patch.object(runpod_worker, "_AUTOCUT_DOWNLOAD_BUDGET_S", 5.0), \
             patch.object(runpod_worker, "_download_file", hanging_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            out = runpod_worker._handle_media_autocut_batch(_input(3))

        self.assertEqual(len(out["results"]), 3)
        self.assertIn("fin du budget du pack", out["results"][1]["error"])
        self.assertIn("pack interrompu", out["results"][2]["error"])

    def test_le_partiel_d_un_download_abandonne_est_supprime(self):
        """Sans ça, chaque abandon laisse son fichier partiel jusqu'à la fin du
        pack — c'est le [Errno 28] documenté dans _download_file."""
        seen: list[Path] = []
        never = threading.Event()
        self.addCleanup(never.set)

        def hanging_download(url, dest, *, budget_s=None):  # noqa: ANN001
            Path(dest).write_bytes(b"x" * 4096)
            seen.append(Path(dest))
            if "rush-0" in url:
                never.wait(30)

        with patch.object(runpod_worker, "_AUTOCUT_ITEM_BUDGET_S", 0.3), \
             patch.object(runpod_worker, "_AUTOCUT_DOWNLOAD_BUDGET_S", 0.05), \
             patch.object(runpod_worker, "_download_file", hanging_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            runpod_worker._handle_media_autocut_batch(_input(2))

        self.assertTrue(seen, "le stub de download doit avoir été appelé")
        for path in seen:
            self.assertFalse(path.exists(), f"{path.name} aurait dû être supprimé")

    # ── Watchdog : gel à l'analyse ───────────────────────────────────────────
    def test_gel_a_l_analyse_interrompt_le_pack_proprement(self):
        """Un thread coincé dans Whisper détient le modèle CTranslate2 en cache :
        on rend les résultats acquis plutôt que d'enchaîner sur la même instance."""
        never = threading.Event()
        self.addCleanup(never.set)

        def hanging_analyze(**kw):
            if kw["audio_path"].name.startswith("asset_1"):
                never.wait(30)
            return _analysis()

        with patch.object(runpod_worker, "_AUTOCUT_ITEM_BUDGET_S", 0.4), \
             patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", hanging_analyze):
            out = runpod_worker._handle_media_autocut_batch(_input(3))

        self.assertEqual(len(out["results"]), 3)
        self.assertNotIn("error", out["results"][0])
        self.assertIn("bloquée", out["results"][1]["error"])
        # Message DISTINCT pour les suivants : l'admin doit pouvoir les relancer
        # sans croire qu'ils sont eux-mêmes défectueux.
        self.assertIn("pack interrompu", out["results"][2]["error"])
        self.assertNotEqual(out["results"][1]["error"], out["results"][2]["error"])

    # ── Budget du pack ───────────────────────────────────────────────────────
    def test_budget_du_pack_epuise_retourne_les_resultats_acquis(self):
        def slow_analyze(**kw):
            time.sleep(0.25)
            return _analysis()

        with patch.object(runpod_worker, "_AUTOCUT_MIN_ITEM_S", 0.2), \
             patch.object(runpod_worker, "_AUTOCUT_RETURN_MARGIN_S", 0.0), \
             patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", slow_analyze):
            out = runpod_worker._handle_media_autocut_batch(_input(5, pack_budget_s=0.4))

        # Le handler RETOURNE (ne meurt pas), avec une entrée par job.
        self.assertEqual(len(out["results"]), 5)
        self.assertNotIn("error", out["results"][0])
        skipped = [r for r in out["results"] if "temps de traitement du pack épuisé" in r.get("error", "")]
        self.assertTrue(skipped, "les assets non traités doivent être marqués explicitement")

    def test_pack_budget_s_invalide_retombe_sur_le_defaut(self):
        with patch.object(runpod_worker, "_download_file", _noop_download), \
             patch.object(runpod_worker, "analyze_autocut", lambda **kw: _analysis()):
            out = runpod_worker._handle_media_autocut_batch(_input(1, pack_budget_s="oops"))
        self.assertNotIn("error", out["results"][0])


class DownloadBudgetTest(unittest.TestCase):
    """_download_file : le budget est opt-in, les 12 autres appelants ne bougent pas."""

    class _FakeStream:
        def __init__(self, chunks, delay=0.0):
            self._chunks, self._delay = chunks, delay

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self, chunk_size=65536):  # noqa: ARG002
            for c in self._chunks:
                if self._delay:
                    time.sleep(self._delay)
                yield c

    def _patch_stream(self, chunks, delay=0.0):
        return patch.object(
            runpod_worker.httpx, "stream",
            lambda *a, **kw: DownloadBudgetTest._FakeStream(chunks, delay),
        )

    def test_leve_quand_le_transfert_deborde_du_budget(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "slow.mp4"
            with self._patch_stream([b"x" * 1024] * 20, delay=0.05):
                with self.assertRaises(runpod_worker.DownloadBudgetExceeded) as ctx:
                    runpod_worker._download_file("https://cdn/x.mp4", dest, budget_s=0.1)
        # Le message doit porter le volume et le débit : c'est ce qui permettra de
        # trancher entre CDN dégradé et autre chose sans relire tous les logs.
        self.assertIn("Mo reçus", str(ctx.exception))
        self.assertIn("Mo/s", str(ctx.exception))

    def test_sans_budget_ne_leve_jamais_non_regression(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "slow.mp4"
            with self._patch_stream([b"x" * 1024] * 5, delay=0.02):
                runpod_worker._download_file("https://cdn/x.mp4", dest)
            self.assertEqual(dest.stat().st_size, 5 * 1024)


if __name__ == "__main__":
    unittest.main()

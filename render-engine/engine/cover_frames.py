"""
cover_frames.py — extraction des frames candidates d'une cover.

Cœur partagé entre les deux appelants :
  - `api.py` (`POST /api/extract-covers`) — chemin de repli, exécuté sur le VPS ;
  - `runpod_worker.py` (`job_type: "cover_frames"`) — chemin nominal, exécuté sur RunPod.

**Tout ici est SYNCHRONE, volontairement.** `runpod.serverless` appelle le handler
depuis une boucle asyncio déjà active : un `asyncio.run()` dans le worker lèverait
`RuntimeError: cannot be called from a running event loop` — et **uniquement en
Serverless**, le chemin pod (thread sans boucle) et les tests locaux passeraient.
Même piège pour les verrous : un `asyncio.Lock` se lie à la boucle de son premier
`await`, donc un dict module-global de verrous crashe au deuxième job d'un worker
tiède avec « bound to a different event loop ».

`api.py` appelle donc ce module derrière `asyncio.to_thread`, comme il le fait déjà
pour ffmpeg et Whisper. C'est aussi la convention de tout `engine/` (probe, color,
media_edit : `subprocess.run` partout).
"""

from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

import httpx

from engine.color import hdr_to_sdr_prefilter, is_hdr
from engine.probe import probe_video

logger = logging.getLogger("render-engine")

# Plus grande dimension des frames extraites. Les covers sont composées en
# 1080×1920 : extraire du 4K natif ne sert à rien et coûte un tonemap par frame
# sur une image quatre fois plus grande.
COVER_FRAME_MAX_EDGE_DEFAULT = 1920


class _Unset:
    """Sentinelle « argument non fourni ».

    `None` ne peut pas jouer ce rôle pour `hdr_prefilter` : c'est une valeur
    légitime qui signifie « source SDR, aucun tonemap ». Les confondre ferait
    reprober la source à chaque appel qui passe explicitement None.
    """

    def __repr__(self) -> str:  # pragma: no cover - debug only
        return "<unset>"


UNSET = _Unset()


class CoverSourceError(RuntimeError):
    """Source vidéo introuvable, illisible ou non téléchargeable."""


@dataclass(frozen=True)
class ExtractSettings:
    max_edge: int = COVER_FRAME_MAX_EDGE_DEFAULT
    concurrency: int = 4
    frame_timeout_s: int = 90

    @classmethod
    def from_env(cls) -> "ExtractSettings":
        return cls(
            max_edge=max(320, int(os.environ.get("COVER_FRAME_MAX_EDGE", COVER_FRAME_MAX_EDGE_DEFAULT))),
            concurrency=max(1, min(8, int(os.environ.get("COVER_EXTRACT_CONCURRENCY", "4")))),
            frame_timeout_s=max(10, int(os.environ.get("COVER_EXTRACT_FRAME_TIMEOUT", "90"))),
        )


@dataclass(frozen=True)
class FrameResult:
    """Résultat d'UNE frame. `requested_timestamp` est toujours rempli — c'est la
    clé de jointure avec le pick d'origine côté appelant."""

    requested_timestamp: float
    #: Position réellement extraite : diffère de `requested_timestamp` après un repli.
    timestamp: float
    path: Path | None
    error: str | None

    @property
    def ok(self) -> bool:
        return self.path is not None


# ─── Source : téléchargement et cache ─────────────────────────────────────────

# Un verrou par source. Sans lui, deux extractions concurrentes sur la même URL
# écrivent le même fichier de cache en même temps et ffmpeg lit un MP4 tronqué —
# toutes les frames échouent d'un coup, et un simple retry « répare » le pack.
# `threading.Lock` et non `asyncio.Lock` : voir le docstring du module.
_source_locks: dict[str, threading.Lock] = {}
_source_locks_guard = threading.Lock()


def _source_lock(key: str) -> threading.Lock:
    with _source_locks_guard:
        lock = _source_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _source_locks[key] = lock
        return lock


def _is_usable(path: Path) -> bool:
    """Le cache fait autorité sur le disque, pas en mémoire : un fichier présent et
    non vide est réutilisable, y compris après un redémarrage du process."""
    try:
        return path.exists() and path.stat().st_size > 0
    except OSError:
        return False


def cache_path_for(video_url: str, cache_dir: Path) -> Path:
    url_hash = hashlib.sha256(video_url.encode()).hexdigest()[:16]
    return cache_dir / f"video_{url_hash}.mp4"


def cache_source_bytes(video_bytes: bytes, cache_dir: Path) -> Path:
    """Matérialise un upload direct (chemin dev local sans réseau cross-container)."""
    if not video_bytes:
        raise CoverSourceError("Fichier vidéo reçu vide (0 octets)")
    cache_dir.mkdir(parents=True, exist_ok=True)
    url_hash = hashlib.sha256(video_bytes[:4096]).hexdigest()[:16]
    video_path = cache_dir / f"video_{url_hash}.mp4"
    with _source_lock(url_hash):
        if _is_usable(video_path):
            logger.info("[covers] Using cached uploaded video %s", video_path.name)
            return video_path
        tmp_path = video_path.with_name(video_path.name + ".part")
        tmp_path.write_bytes(video_bytes)
        os.replace(tmp_path, video_path)
        logger.info("[covers] Received uploaded video → %s", video_path.name)
    return video_path


def ensure_local_source(
    video_url: str,
    cache_dir: Path,
    *,
    local_resolver: Callable[[str], Path | None] | None = None,
    timeout_s: int = 180,
) -> Path:
    """
    Retourne un chemin local lisible pour `video_url`, en le téléchargeant si besoin.

    `local_resolver` permet à `api.py` de court-circuiter le réseau quand l'URL
    désigne un fichier qu'il sert lui-même (`/outputs/...`). Le worker RunPod n'en
    a pas : rien n'est local chez lui.
    """
    if local_resolver is not None:
        local_path = local_resolver(video_url)
        if local_path and local_path.exists():
            logger.info("[covers] Using local output video %s", local_path.name)
            return local_path

    cache_dir.mkdir(parents=True, exist_ok=True)
    video_path = cache_path_for(video_url, cache_dir)
    url_hash = video_path.stem.removeprefix("video_")

    # Le verrou fait attendre la 2e extraction plutôt que de la laisser réécrire le
    # fichier pendant que la 1re le lit.
    with _source_lock(url_hash):
        if _is_usable(video_path):
            logger.info("[covers] Using cached video %s", video_path.name)
            return video_path

        logger.info("[covers] Downloading video %s → %s", video_url, video_path.name)
        tmp_path = video_path.with_name(video_path.name + ".part")
        try:
            # Streaming plutôt qu'un buffer complet : un rush 4K de plusieurs centaines
            # de Mo ne doit pas être chargé entier en RAM.
            with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                with client.stream("GET", video_url) as resp:
                    resp.raise_for_status()
                    with tmp_path.open("wb") as handle:
                        for chunk in resp.iter_bytes(1024 * 1024):
                            handle.write(chunk)
            if tmp_path.stat().st_size == 0:
                raise ValueError("réponse vide (0 octet)")
            # Publication atomique : un lecteur concurrent ne voit jamais un MP4 partiel.
            os.replace(tmp_path, video_path)
        except Exception as exc:
            tmp_path.unlink(missing_ok=True)
            raise CoverSourceError(f"Impossible de télécharger la vidéo : {exc}") from exc

    return video_path


# ─── FFmpeg ───────────────────────────────────────────────────────────────────


def hdr_prefilter_for(video_path: Path) -> str | None:
    """
    Probe la source UNE fois et retourne le pré-filtre de tonemap si elle est HDR.

    Un rush HLG/PQ converti naïvement en 8 bits ressort délavé. L'échec du probe
    n'est jamais bloquant : on retombe sur le traitement SDR.
    """
    try:
        if is_hdr(probe_video(video_path)):
            logger.info("[covers] HDR source detected — tonemapping to SDR/BT.709: %s", video_path.name)
            return hdr_to_sdr_prefilter()
    except Exception as exc:
        logger.warning("[covers] HDR probe failed (continuing as SDR) for %s: %s", video_path.name, exc)
    return None


def build_frame_command(
    video_path: Path,
    timestamp: float,
    frame_path: Path,
    *,
    max_edge: int,
    hdr_prefilter: str | None,
) -> list[str]:
    """
    Commande d'extraction d'une frame. Fonction pure — c'est la cible des tests.

    La réduction vient AVANT tout autre filtre : sur une source HLG, tonemapper du
    4K coûte plusieurs secondes par frame contre une fraction de seconde une fois
    réduit, et la cover est de toute façon composée en 1080×1920.
    `force_original_aspect_ratio=decrease` borne la plus grande dimension sans
    jamais agrandir une source déjà plus petite.
    """
    filters = [f"scale={max_edge}:{max_edge}:force_original_aspect_ratio=decrease"]
    if hdr_prefilter:
        filters.append(hdr_prefilter)
    return [
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-vframes", "1",
        "-q:v", "2",
        "-vf", ",".join(filters),
        str(frame_path),
    ]


def _run_ffmpeg(
    video_path: Path,
    timestamp: float,
    frame_path: Path,
    *,
    settings: ExtractSettings,
    hdr_prefilter: str | None,
) -> tuple[bool, str]:
    """Extrait une frame. Retourne (succès, raison de l'échec)."""
    cmd = build_frame_command(
        video_path, timestamp, frame_path, max_edge=settings.max_edge, hdr_prefilter=hdr_prefilter
    )
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=settings.frame_timeout_s)
    except subprocess.TimeoutExpired:
        # subprocess.run tue déjà le process et draine ses pipes sur timeout.
        return False, f"timeout ffmpeg ({settings.frame_timeout_s}s)"

    if proc.returncode != 0 or not frame_path.exists() or frame_path.stat().st_size == 0:
        lines = [line for line in (proc.stderr or b"").decode(errors="replace").strip().splitlines() if line.strip()]
        if not lines:
            return False, f"ffmpeg rc={proc.returncode}, aucune image produite"
        # Le message remonte jusqu'à l'UI : on masque les chemins locaux.
        reason = lines[-1].replace(str(video_path), "<source>").replace(str(frame_path), "<frame>")
        return False, reason[:200]
    return True, ""


def _default_filename(index: int, timestamp: float) -> str:
    return f"frame_{index:03d}_{timestamp:.3f}.jpg"


def extract_cover_frames(
    video_path: Path,
    timestamps: Sequence[float],
    out_dir: Path,
    *,
    settings: ExtractSettings | None = None,
    hdr_prefilter: str | None | _Unset = UNSET,
    filename_for: Callable[[int, float], str] | None = None,
) -> list[FrameResult]:
    """
    Extrait une frame par timestamp. Ne lève JAMAIS pour l'échec d'une frame :
    l'appelant décide de sa politique (HTTP 422, job en échec, dégradation).

    L'ordre d'entrée est préservé. `hdr_prefilter` omis déclenche un probe interne
    unique, partagé par toutes les frames de cette source ; passer explicitement
    `None` signifie « source SDR, pas de tonemap » et n'en déclenche aucun.

    Le pool de threads est DÉDIÉ : utiliser l'exécuteur par défaut ferait se
    disputer le même pool avec le `to_thread` externe d'`api.py` — famine garantie
    dès deux extractions concurrentes.
    """
    indexed = list(enumerate(float(ts) for ts in timestamps))
    if not indexed:
        return []

    settings = settings or ExtractSettings.from_env()
    naming = filename_for or _default_filename
    out_dir.mkdir(parents=True, exist_ok=True)
    # Probe une seule fois par source, et seulement s'il y a du travail.
    prefilter = hdr_prefilter_for(video_path) if isinstance(hdr_prefilter, _Unset) else hdr_prefilter

    def extract_one(item: tuple[int, float]) -> FrameResult:
        index, requested = item
        safe_ts = max(0.0, requested)
        frame_path = out_dir / naming(index, safe_ts)

        ok, reason = _run_ffmpeg(
            video_path, safe_ts, frame_path, settings=settings, hdr_prefilter=prefilter
        )
        if not ok and safe_ts > 0.5:
            # Même repli que /api/generate-poster : un timestamp qui tombe après la
            # dernière frame décodable (durée surestimée en base, clip re-tronqué) ne
            # produit rien en seek rapide. On retente 0,5 s plus tôt, dans le MÊME
            # fichier — aucune collision de nom, aucune dépendance à une durée probée
            # qui peut elle-même être fausse.
            retry_ts = max(0.0, safe_ts - 0.5)
            ok, retry_reason = _run_ffmpeg(
                video_path, retry_ts, frame_path, settings=settings, hdr_prefilter=prefilter
            )
            if ok:
                logger.info("[covers] ts=%.3f récupéré au repli %.3f", safe_ts, retry_ts)
                return FrameResult(requested_timestamp=safe_ts, timestamp=retry_ts, path=frame_path, error=None)
            reason = f"{reason} | repli {retry_ts:.3f}s : {retry_reason}"

        if not ok:
            logger.warning("[covers] FFmpeg failed at ts=%.3f — %s", safe_ts, reason)
            return FrameResult(requested_timestamp=safe_ts, timestamp=safe_ts, path=None, error=reason)

        return FrameResult(requested_timestamp=safe_ts, timestamp=safe_ts, path=frame_path, error=None)

    with ThreadPoolExecutor(max_workers=settings.concurrency) as pool:
        return list(pool.map(extract_one, indexed))

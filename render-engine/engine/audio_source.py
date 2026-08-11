"""
audio_source — obtention de l'audio d'un média distant, sans le stocker sur disque.

## Le problème résolu

`_handle_transcribe` téléchargeait le média **entier** dans un `TemporaryDirectory`
avant d'en extraire l'audio. Sur RunPod, ce dossier vit dans `/tmp`, c'est-à-dire
sur le disque du conteneur — quelques Go seulement, une fois l'image déduite
(CUDA + torch + whisperx + pyannote + modèles pré-bakés).

Symptôme observé en production (Serverless, worker obgwfoe5a5x0c0) :

    OSError: [Errno 28] No space left on device
      File "/app/runpod_worker.py", line 1372, in _handle_transcribe
        _download_file(audio_url, audio_path)
      File "/app/runpod_worker.py", line 110, in _download_file
        f.write(chunk)

Sur un rush de ~20 Go. Le plafond d'upload annoncé côté web était donc fictif :
le disque du worker cédait bien avant.

## La solution

Whisper ne consomme que de l'audio 16 kHz mono. On demande donc à ffmpeg de lire
l'URL R2 directement et de n'écrire que cet audio : un WAV PCM s16 pèse 32 ko/s,
soit ~115 Mo par heure de média. Un rush de 100 Go (≈ 45 min de ProRes) produit
~86 Mo. Aucun octet de vidéo ne touche le disque, quelle que soit la taille du
fichier source.

À énoncer clairement pour éviter un malentendu : **le transfert réseau subsiste**
(ffmpeg doit parcourir le conteneur pour démuxer l'audio — mesuré à ~65-70 % du
fichier sur des `.mov` interleavés). Ce qu'on supprime, c'est le stockage. C'est
bien le disque qui bloquait, pas la bande passante : l'egress R2 est gratuit.

## Prérequis vérifiés sur l'image

Le build BtbN GPL linux64 épinglé dans `Dockerfile.runpod` embarque
`--enable-openssl`, le protocole `https`, et les options `-reconnect*`,
`-multiple_requests`, `-rw_timeout` utilisées ci-dessous.

Ce module est volontairement dans `engine/` et non dans `runpod_worker.py` :
`api.py` (FastAPI local) doit pouvoir l'importer, la parité local ↔ RunPod étant
un invariant du projet.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import httpx

# Fréquence d'échantillonnage attendue par WhisperX. `whisperx.load_audio` décode
# de toute façon vers ce format ; le produire directement rend ce second passage
# quasi gratuit et garantit des échantillons identiques à l'existant (donc aucune
# régression de qualité de transcription).
WHISPER_SR = 16_000

# Ratio d'octets réellement transférés par ffmpeg en mode `-vn`, mesuré sur des
# `.mov` interleavés (H264+AAC : 65 %, MJPEG+PCM : 69 %). Sert à dimensionner le
# timeout, pas à garantir un volume.
_STREAM_READ_RATIO = 0.7

_STDERR_TAIL_LINES = 200


class AudioExtractionError(RuntimeError):
    """
    Échec d'extraction, avec un message déjà rédigé pour l'utilisateur final.

    Ce message remonte tel quel jusqu'à `TranscriptionJob.errorMsg` puis à l'UI
    (`pod_server` / le handler renvoient `str(exc)`), d'où le soin apporté à sa
    formulation : il doit dire quoi faire, pas seulement ce qui a cassé.
    """


@dataclass(slots=True)
class RemoteSourceInfo:
    """Ce qu'on sait d'une URL avant de lancer ffmpeg."""

    size_bytes: int | None
    accepts_ranges: bool
    content_type: str | None


@dataclass(slots=True)
class AudioExtractResult:
    wav_path: Path
    duration_s: float
    wav_bytes: int
    elapsed_s: float
    mode: str  # "stream" | "local"


def probe_remote_source(url: str, *, timeout: float = 30.0) -> RemoteSourceInfo:
    """
    Interroge l'URL pour connaître sa taille et le support des range requests.

    Ne lève jamais : une sonde qui échoue ne doit pas empêcher la tentative
    d'extraction, seulement priver des garde-fous (timeout dimensionné, refus
    anticipé). Repli en GET `Range: bytes=0-0` si le HEAD est refusé — certains
    CDN n'autorisent pas HEAD.
    """
    size: int | None = None
    accepts_ranges = False
    content_type: str | None = None

    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            resp = client.head(url)
            if resp.status_code >= 400:
                resp = client.get(url, headers={"Range": "bytes=0-0"})

            content_type = resp.headers.get("content-type")
            accepts_ranges = (
                resp.headers.get("accept-ranges", "").lower() == "bytes"
                or resp.status_code == 206
            )

            # Sur une réponse 206, content-length vaut la taille du fragment :
            # la taille totale est dans content-range.
            content_range = resp.headers.get("content-range")
            if content_range and "/" in content_range:
                total = content_range.rsplit("/", 1)[-1].strip()
                if total.isdigit():
                    size = int(total)
            if size is None:
                raw_len = resp.headers.get("content-length")
                if raw_len and raw_len.isdigit() and resp.status_code != 206:
                    size = int(raw_len)
    except Exception as exc:  # noqa: BLE001 — sonde best-effort par conception
        print(f"[audio_source] probe échouée pour {url[:100]}: {exc}", flush=True)

    return RemoteSourceInfo(size_bytes=size, accepts_ranges=accepts_ranges, content_type=content_type)


def extraction_timeout_s(size_bytes: int | None) -> int:
    """
    Dimensionne le timeout du subprocess d'après la taille de la source.

    Une constante fixe serait fausse dans les deux sens : trop courte pour 100 Go,
    absurdement longue pour un mp3. On part d'un débit plancher configurable et on
    borne le résultat.
    """
    floor_mbps = float(os.environ.get("TRANSCRIBE_EXTRACT_MIN_MBPS", "8"))
    cap = int(os.environ.get("TRANSCRIBE_EXTRACT_TIMEOUT_MAX_S", str(4 * 3600)))

    if not size_bytes:
        return min(cap, 3600)

    estimated = int(size_bytes * _STREAM_READ_RATIO / (floor_mbps * 1024 * 1024))
    # +600 s : démarrage ffmpeg, parsing d'en-tête (seek vers le moov), upload du WAV.
    return max(900, min(cap, estimated + 600))


def build_extract_audio_cmd(
    source: str | Path,
    dest: Path,
    *,
    remote: bool,
) -> list[str]:
    """
    Construit la commande d'extraction audio.

    Chaque flag distant est justifié :

    - `-nostdin` : lancé en subprocess sans stdin interactif ; sans ça ffmpeg peut
      se bloquer en attente d'entrée.
    - `-loglevel warning` : pas `error` (on veut les warnings de démuxage dans la
      queue conservée pour le message d'erreur), pas `info` (40 min de logs).
    - `-stats_period 30 -progress pipe:1` : indispensable. Sans progression, un
      subprocess de 40 min est muet et on ne peut pas distinguer « ça avance » de
      « c'est bloqué ».
    - `-seekable 1` : explicite le comportement critique. Sans seek, un `.mov` dont
      le `moov` est en fin de fichier impose la lecture intégrale AVANT même de
      connaître les pistes — soit 100 Go dans le tuyau pour rien.
    - `-multiple_requests 1` : connexions persistantes entre range requests ; évite
      N handshakes TLS sur un fichier qui génère beaucoup de seeks.
    - `-rw_timeout` : garde-fou anti-hang, en microsecondes. Un socket muet 60 s
      lève une erreur que `-reconnect` reprend, au lieu de figer le job.
    - `-reconnect*` : sur 30-40 min de transfert HTTPS, une coupure est probable,
      pas hypothétique. `-reconnect_on_http_error 5xx` volontairement SANS 4xx :
      un 403/404 est définitif, on veut échouer vite avec un message clair plutôt
      que boucler jusqu'au timeout.
    - `-reconnect_delay_max` / `-reconnect_max_retries` : backoff borné. Le défaut
      (-1, infini) transformerait une panne R2 en job zombie.
    - `-vn -sn -dn` : marque vidéo/sous-titres/data en `AVDISCARD_ALL`, donc seuls
      les samples audio sont lus. Le codec vidéo n'est jamais décodé : **ProRes et
      DNxHD ne posent aucun problème**, on ne fait que démuxer.
    - pas de `-map` : sélection automatique de la meilleure piste audio, soit le
      comportement actuel de `whisperx.load_audio`. Un `-map 0:a` planterait sur un
      rush multi-pistes (« cannot write 2 streams to wav »).
    - pas de `-protocol_whitelist` : la whitelist ne concerne que les protocoles
      imbriqués (concat/hls/subfile). L'ajouter par excès de zèle casserait plus
      qu'elle ne protégerait.
    """
    cmd: list[str] = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "warning"]
    cmd += ["-stats_period", "30", "-progress", "pipe:1"]

    if remote:
        cmd += [
            "-seekable", "1",
            "-multiple_requests", "1",
            "-rw_timeout", "60000000",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_on_network_error", "1",
            "-reconnect_on_http_error", "5xx",
            "-reconnect_delay_max", "15",
            "-reconnect_max_retries", "10",
        ]

    cmd += ["-i", str(source)]
    cmd += ["-vn", "-sn", "-dn"]
    cmd += ["-ac", "1", "-ar", str(WHISPER_SR), "-c:a", "pcm_s16le"]
    cmd += ["-f", "wav", str(dest)]
    return cmd


def _friendly_error(stderr_tail: str, *, timed_out: bool, timeout_s: int, size_bytes: int | None) -> str:
    """Traduit la sortie ffmpeg en message actionnable pour l'utilisateur."""
    if timed_out:
        size_txt = f" (source {size_bytes / 1024 ** 3:.1f} Go)" if size_bytes else ""
        return (
            f"Extraction audio interrompue après {timeout_s // 60} min{size_txt}. "
            "Le débit vers le stockage est insuffisant — réessayez, ou fournissez un export plus léger."
        )

    lowered = stderr_tail.lower()

    # ⚠️ L'ORDRE de ces tests est significatif, et une version antérieure s'est
    # fait piéger : « moov atom not found » contient « not found », donc un
    # conteneur illisible était rapporté comme « fichier introuvable, relancez
    # l'upload » — l'utilisateur cherchait au mauvais endroit. Les motifs sont
    # désormais ancrés sur les formulations exactes de ffmpeg, et les cas
    # spécifiques passent avant les génériques.

    if "does not contain any stream" in lowered:
        return (
            "Aucune piste audio détectée dans le fichier source. "
            "Vérifiez l'export : le fichier ne contient probablement que de la vidéo."
        )

    # Serveur qui ignore les range requests : il renvoie le fichier depuis 0 alors
    # que ffmpeg demandait un offset. Symptôme distinctif, et cause racine bien
    # différente d'un fichier corrompu.
    if "unexpected offset" in lowered:
        return (
            "Le stockage ne respecte pas les lectures partielles (range requests) : "
            "impossible de lire l'en-tête du fichier sans le télécharger en entier. "
            "Vérifiez la configuration du CDN devant le bucket."
        )

    if "http error 404" in lowered or "server returned 404" in lowered:
        return (
            "Fichier source introuvable dans le stockage (HTTP 404) — "
            "l'upload a probablement échoué. Relancez l'upload."
        )
    if "http error 403" in lowered or "server returned 403" in lowered or "access denied" in lowered:
        return "Accès refusé au fichier source dans le stockage (HTTP 403)."

    if "moov atom not found" in lowered or "invalid data found" in lowered:
        return (
            "Fichier source illisible ou incomplet — conteneur corrompu "
            "(upload interrompu ?). Relancez l'upload."
        )

    tail = "\n".join(stderr_tail.strip().splitlines()[-3:])
    return f"Extraction audio échouée : {tail}" if tail else "Extraction audio échouée."


def extract_audio_16k_mono(
    source: str | Path,
    dest: Path,
    *,
    timeout_s: int,
    log_prefix: str = "[audio_source]",
    progress_every_s: int = 60,
) -> AudioExtractResult:
    """
    Extrait l'audio en WAV 16 kHz mono, depuis une URL distante ou un fichier local.

    Loggue la progression à intervalle régulier — sans quoi un job de 40 min
    n'émettrait rien et serait indistinguable d'un blocage.

    :raises AudioExtractionError: message déjà destiné à l'utilisateur final.
    """
    remote = isinstance(source, str) and source.lower().startswith(("http://", "https://"))
    cmd = build_extract_audio_cmd(source, dest, remote=remote)
    print(f"{log_prefix} extraction ({'stream' if remote else 'local'}): {shlex.join(cmd)}", flush=True)

    started = time.monotonic()
    stderr_tail: deque[str] = deque(maxlen=_STDERR_TAIL_LINES)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_tail.append(line.rstrip("\n"))

    stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
    stderr_thread.start()

    out_time_s = 0.0
    total_size = 0
    last_log = started
    timed_out = False

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_ms="):
                raw = line.split("=", 1)[1]
                if raw.isdigit():
                    out_time_s = int(raw) / 1_000_000
            elif line.startswith("total_size="):
                raw = line.split("=", 1)[1]
                if raw.isdigit():
                    total_size = int(raw)

            now = time.monotonic()
            if now - last_log >= progress_every_s:
                last_log = now
                print(
                    f"{log_prefix} progression : {out_time_s:.0f}s d'audio extraits, "
                    f"{total_size / 1024 ** 2:.0f} Mo écrits, {now - started:.0f}s écoulées",
                    flush=True,
                )

            if time.monotonic() - started > timeout_s:
                timed_out = True
                break

        if timed_out:
            proc.kill()
        else:
            proc.wait(timeout=max(1, int(timeout_s - (time.monotonic() - started))))
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
    finally:
        stderr_thread.join(timeout=5)

    elapsed = time.monotonic() - started
    tail = "\n".join(stderr_tail)

    if timed_out or proc.returncode != 0:
        print(f"{log_prefix} échec rc={proc.returncode} timeout={timed_out}", flush=True)
        if tail:
            print(f"{log_prefix} stderr:\n{tail[-4000:]}", flush=True)
        dest.unlink(missing_ok=True)
        raise AudioExtractionError(
            _friendly_error(tail, timed_out=timed_out, timeout_s=timeout_s, size_bytes=None)
        )

    if not dest.exists() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise AudioExtractionError(
            "Extraction audio vide — le fichier source ne contient probablement aucune piste audio."
        )

    wav_bytes = dest.stat().st_size
    print(
        f"{log_prefix} audio extrait : {out_time_s:.1f}s, {wav_bytes / 1024 ** 2:.0f} Mo, "
        f"{elapsed:.0f}s ({'stream' if remote else 'local'})",
        flush=True,
    )
    return AudioExtractResult(
        wav_path=dest,
        duration_s=out_time_s,
        wav_bytes=wav_bytes,
        elapsed_s=elapsed,
        mode="stream" if remote else "local",
    )

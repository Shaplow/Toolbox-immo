"""
Auto-vérification de engine/audio_source.py — déterministe et hors-ligne.

    cd render-engine && python3 scripts/check_audio_source.py

Ne nécessite que ffmpeg et la stdlib (pas de pytest, pas de réseau externe) :
fabrique un mp4 avec piste audio, le sert sur localhost via un serveur qui gère
les `Range` — et une variante qui les ignore — puis valide le chemin complet :
sonde, construction de la commande, parsing de `-progress`, écriture du WAV,
et traduction des erreurs.

À lancer après toute modification de `engine/audio_source.py`, et après un rebuild
de l'image worker (le build ffmpeg change : vérifier que `https` et les options
`-reconnect*` sont toujours là).

Vérifie notamment les deux cas que le plan qualifiait de « risques acceptables »,
ici réellement éprouvés :
  - moov atom en FIN de fichier (cas des exports caméra) ;
  - stockage qui n'honore pas les range requests.

Sur ce dernier point, la mesure est parlante : sur un fichier de 145 Ko,
l'extraction prend ~0 s avec les ranges et ~52 s sans.
"""

import http.server
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# Racine render-engine, quel que soit le cwd d'appel.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.audio_source import (  # noqa: E402
    AudioExtractionError,
    WHISPER_SR,
    build_extract_audio_cmd,
    extract_audio_16k_mono,
    extraction_timeout_s,
    probe_remote_source,
)

failures = []


def check(label, cond, detail=""):
    print(f"[{'OK  ' if cond else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not cond:
        failures.append(label)


# ─── Serveur HTTP local ──────────────────────────────────────────────────────

class RangeHandler(http.server.BaseHTTPRequestHandler):
    """Sert un fichier unique, avec ou sans support des Range selon `honor_range`."""

    directory: Path = Path()
    honor_range: bool = True

    def log_message(self, *args):  # silence
        pass

    def _resolve(self):
        name = self.path.lstrip("/").split("?")[0]
        return self.directory / name

    def do_HEAD(self):
        path = self._resolve()
        if not path.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Content-Type", "video/mp4")
        if self.honor_range:
            self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self):
        path = self._resolve()
        if not path.is_file():
            self.send_error(404)
            return
        size = path.stat().st_size
        rng = self.headers.get("Range")

        if rng and self.honor_range:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            start = int(m.group(1)) if m and m.group(1) else 0
            end = int(m.group(2)) if m and m.group(2) else size - 1
            end = min(end, size - 1)
            length = max(0, end - start + 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", "video/mp4")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                self.wfile.write(f.read(length))
            return

        # Pas de Range, ou serveur qui les ignore : tout depuis 0.
        self.send_response(200)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Type", "video/mp4")
        if self.honor_range:
            self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with open(path, "rb") as f:
            self.wfile.write(f.read())


def serve(directory: Path, honor_range: bool):
    handler = type("H", (RangeHandler,), {"directory": directory, "honor_range": honor_range})
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


# ─── 1. Commande ─────────────────────────────────────────────────────────────

print("=== 1. Construction de la commande ===")
joined = " ".join(build_extract_audio_cmd("https://x/y.mov", Path("/tmp/o.wav"), remote=True))
check("reconnect_on_http_error limité à 5xx", "-reconnect_on_http_error 5xx" in joined and "4xx" not in joined,
      "un 403/404 doit échouer vite")
check("options de protocole avant -i", joined.index("-reconnect") < joined.index("-i"))
check("vidéo/sous-titres/data écartés", "-vn -sn -dn" in joined)
check(f"audio mono {WHISPER_SR} Hz pcm_s16le", f"-ac 1 -ar {WHISPER_SR} -c:a pcm_s16le" in joined)
check("pas de -map (rush multi-pistes)", "-map" not in joined)
check("pas de -protocol_whitelist", "-protocol_whitelist" not in joined)
local = " ".join(build_extract_audio_cmd(Path("/tmp/i.mov"), Path("/tmp/o.wav"), remote=False))
check("mode local sans flags HTTP", "-reconnect" not in local and "-rw_timeout" not in local)

# ─── 2. Timeout ──────────────────────────────────────────────────────────────

print("\n=== 2. Dimensionnement du timeout ===")
check("taille inconnue → 1 h", extraction_timeout_s(None) == 3600)
check("petit fichier → plancher 900 s", extraction_timeout_s(10 * 1024**2) == 900)
t20, t100 = extraction_timeout_s(20 * 1024**3), extraction_timeout_s(100 * 1024**3)
check("croît avec la taille", t20 < t100, f"20 Go={t20/3600:.1f}h  100 Go={t100/3600:.1f}h")
check("jamais au-delà du plafond 4 h", t100 <= 4 * 3600, f"{t100/3600:.1f}h")

# ─── 3-5. Extraction réelle ──────────────────────────────────────────────────

with tempfile.TemporaryDirectory() as tmp:
    tmpd = Path(tmp)
    media = tmpd / "clip.mp4"

    # mp4 avec vidéo + audio. SANS +faststart : le moov reste en FIN de fichier,
    # exactement le cas des exports caméra qu'on redoutait.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=15",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
         "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
         "-movflags", "-faststart", str(media)],
        check=True, capture_output=True,
    )
    print(f"\n=== 3. Média de test : {media.stat().st_size} octets ===")

    # Confirme que le moov est bien en fin de fichier, par OFFSET (des tranches
    # fixes se recouvrent sur un petit fichier — piège de la version précédente).
    blob = media.read_bytes()
    moov_at = blob.find(b"moov")
    check("moov en FIN de fichier (cas export caméra)",
          moov_at > len(blob) * 0.5,
          f"offset {moov_at} / {len(blob)} ({moov_at / len(blob):.0%})")

    httpd, port = serve(tmpd, honor_range=True)
    url = f"http://127.0.0.1:{port}/clip.mp4"

    print("\n=== 4. Sonde + extraction avec ranges supportées ===")
    info = probe_remote_source(url)
    check("taille détectée", info.size_bytes == media.stat().st_size, str(info.size_bytes))
    check("ranges détectées", info.accepts_ranges)

    dest = tmpd / "out.wav"
    try:
        res = extract_audio_16k_mono(url, dest, timeout_s=120, log_prefix="[test]", progress_every_s=1)
        check("WAV produit", dest.exists() and res.wav_bytes > 0, f"{res.wav_bytes} octets")
        check("durée remontée par -progress", 5.0 < res.duration_s < 7.0, f"{res.duration_s:.2f}s")
        check("mode = stream", res.mode == "stream")
        expected = res.duration_s * WHISPER_SR * 2
        ratio = res.wav_bytes / expected if expected else 0
        check("taille cohérente 16 kHz mono s16", 0.85 < ratio < 1.15, f"ratio={ratio:.2f}")
        # Le point central du chantier : la vidéo ne doit PAS atterrir sur disque.
        leftovers = [p.name for p in tmpd.iterdir() if p.suffix == ".mp4" and p.name != "clip.mp4"]
        check("aucune copie de la vidéo sur disque", not leftovers, str(leftovers))
    except AudioExtractionError as exc:
        check("extraction réussie", False, str(exc))
    httpd.shutdown()

    print("\n=== 5. Serveur qui IGNORE les ranges ===")
    httpd2, port2 = serve(tmpd, honor_range=False)
    url2 = f"http://127.0.0.1:{port2}/clip.mp4"
    info2 = probe_remote_source(url2)
    check("sonde détecte l'absence de ranges", not info2.accepts_ranges)
    dest2 = tmpd / "out2.wav"
    try:
        extract_audio_16k_mono(url2, dest2, timeout_s=60, log_prefix="[test-norange]")
        # Sur un petit fichier ffmpeg peut s'en sortir en lisant tout : acceptable.
        print("     (extraction passée quand même — fichier petit, lecture intégrale)")
    except AudioExtractionError as exc:
        msg = str(exc)
        check("message pointe le CDN, pas un faux 'fichier introuvable'",
              "range" in msg.lower() or "partielle" in msg.lower(), msg[:120])
    httpd2.shutdown()

    print("\n=== 6. Erreurs traduites ===")
    httpd3, port3 = serve(tmpd, honor_range=True)
    dest3 = tmpd / "out3.wav"
    try:
        extract_audio_16k_mono(f"http://127.0.0.1:{port3}/nope.mp4", dest3,
                               timeout_s=30, log_prefix="[test-404]")
        check("404 lève une erreur", False, "aucune exception")
    except AudioExtractionError as exc:
        msg = str(exc)
        check("404 → message actionnable", "introuvable" in msg.lower(), msg[:120])
        check("pas de WAV résiduel", not dest3.exists())
    httpd3.shutdown()

    print("\n=== 7. Fichier sans piste audio ===")
    silent = tmpd / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
         "-c:v", "libx264", "-preset", "ultrafast", "-an", str(silent)],
        check=True, capture_output=True,
    )
    httpd4, port4 = serve(tmpd, honor_range=True)
    dest4 = tmpd / "out4.wav"
    try:
        extract_audio_16k_mono(f"http://127.0.0.1:{port4}/silent.mp4", dest4,
                               timeout_s=60, log_prefix="[test-silent]")
        check("vidéo muette → erreur", False, "aucune exception")
    except AudioExtractionError as exc:
        check("vidéo muette → message clair",
              "audio" in str(exc).lower(), str(exc)[:120])
    httpd4.shutdown()

print()
if failures:
    print(f"❌ {len(failures)} échec(s) : {failures}")
    sys.exit(1)
print("✅ tous les contrôles passent")

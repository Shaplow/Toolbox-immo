"""
autocut.py — Analyse Whisper pour détection automatique des points de coupe.

Utilise transcribe_with_word_timestamps() existant (avec cache modèle entre les jobs).
Retourne les timings de début/fin proposés à partir du premier et dernier mot détecté,
avec un padding configurable.

Usage
-----
    from engine.autocut import analyze_autocut

    result = analyze_autocut(
        audio_path=Path("/tmp/rush.mp4"),
        language="fr",
    )
    # result: {
    #   "proposed_start": 0.45,
    #   "proposed_end": 18.72,
    #   "transcript_json": [{ "text": "...", "start": 0.45, "end": 3.2 }, ...],
    #   "language": "fr",
    #   "fallback": False,   # True si l'alignement mot a échoué
    # }
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from engine.transcribe import transcribe_with_word_timestamps
from engine.probe import probe_video


def analyze_autocut(
    audio_path: Path | str,
    model_size: str = "large-v3-turbo",
    language: str = "fr",
    padding_start: float = 0.15,
    padding_end: float = 0.20,
) -> dict[str, Any]:
    """
    Analyse un fichier audio/vidéo et retourne les timings de coupe proposés.

    Stratégie :
    1. Appelle transcribe_with_word_timestamps() (cache Whisper réutilisé entre assets du pack).
    2. Recherche le premier et dernier mot avec timestamps alignés (champ "words" dans les segments).
    3. Applique un padding et clamp aux bornes de la durée réelle.
    4. Si l'alignement mot-à-mot échoue ou ne produit aucun mot, fallback sur les bornes
       des segments bruts Whisper (moins précis mais non-bloquant).

    Args:
        audio_path:    Chemin vers le fichier audio ou vidéo.
        model_size:    Modèle Whisper (ex: "large-v3-turbo").
        language:      Code langue (ex: "fr", "en").
        padding_start: Marge en secondes avant le premier mot.
        padding_end:   Marge en secondes après le dernier mot.

    Returns:
        {
            "proposed_start":  float,
            "proposed_end":    float,
            "transcript_json": list[{ "text", "start", "end" }],  # niveau segment
            "language":        str,
            "fallback":        bool,  # True = alignement mot échoué, bornes moins précises
        }

    Raises:
        RuntimeError si Whisper échoue complètement (aucun segment produit).
    """
    audio_path = Path(audio_path)
    print(
        f"[autocut] Analyse: {audio_path.name} "
        f"model={model_size} lang={language} "
        f"padding={padding_start}/{padding_end}",
        flush=True,
    )

    # ── Durée réelle via probe ───────────────────────────────────────────────
    try:
        probe = probe_video(str(audio_path))
        real_duration: float = probe.duration or 0.0
    except Exception as e:
        print(f"[autocut] probe échoué ({e}), durée inconnue — clamp désactivé", flush=True)
        real_duration = 0.0

    # ── Transcription + alignement ───────────────────────────────────────────
    segments = transcribe_with_word_timestamps(
        audio_path=audio_path,
        model_size=model_size,
        language=language,
        enable_diarization=False,
    )

    if not segments:
        raise RuntimeError(f"[autocut] Aucun segment Whisper produit pour {audio_path.name}")

    # ── Construire transcript_json (niveau segment + mots pour la détection frontend) ──
    transcript_json = [
        {
            "text": seg.get("text", "").strip(),
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
            # Inclure les timestamps mot-à-mot pour la détection de prises côté UI.
            # WhisperX produit ces timestamps via l'alignement forced-alignment.
            # Sans eux, la détection travaille sur les gaps entre segments (moins fiable).
            "words": [
                {
                    "word": w.get("word", "").strip(),
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    # score = confiance Whisper par mot (0.0–1.0).
                    # Utilisé côté UI pour scorer les prises : mots nets → score élevé.
                    "score": float(w.get("score") or 0.8),
                }
                for w in seg.get("words", [])
                if w.get("start") is not None and w.get("end") is not None
            ],
        }
        for seg in segments
        if seg.get("text", "").strip()
    ]

    # ── Extraire les timestamps mot-à-mot ────────────────────────────────────
    fallback = False
    first_word_start: float | None = None
    last_word_end: float | None = None

    for seg in segments:
        words = seg.get("words", [])
        for word in words:
            ws = word.get("start")
            we = word.get("end")
            if ws is not None and first_word_start is None:
                first_word_start = float(ws)
            if we is not None:
                last_word_end = float(we)

    if first_word_start is None or last_word_end is None:
        # Fallback : pas de timestamps mot-à-mot (alignement non disponible ou vide)
        fallback = True
        print(
            "[autocut] Aucun timestamp mot trouvé — fallback sur bornes de segments",
            flush=True,
        )
        first_word_start = float(segments[0].get("start", 0.0))
        last_word_end = float(segments[-1].get("end", 0.0))

    # ── Appliquer padding + clamp ────────────────────────────────────────────
    proposed_start = max(0.0, first_word_start - padding_start)
    proposed_end = last_word_end + padding_end
    if real_duration > 0.0:
        proposed_end = min(proposed_end, real_duration)

    print(
        f"[autocut] Résultat: start={proposed_start:.3f}s end={proposed_end:.3f}s "
        f"fallback={fallback}",
        flush=True,
    )

    return {
        "proposed_start": round(proposed_start, 3),
        "proposed_end": round(proposed_end, 3),
        "transcript_json": transcript_json,
        "language": language,
        "fallback": fallback,
    }

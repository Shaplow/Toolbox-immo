from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from .models import WordTimestamp


def _resolve_device() -> tuple[str, str]:
    """Returns (device, compute_type) for WhisperX. CUDA on RunPod, CPU fallback."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except ImportError:
        pass
    return "cpu", "int8"


# ─── Module-level model cache ─────────────────────────────────────────────────
# Les workers RunPod restent vivants entre les jobs (idle timeout).
# On réutilise les modèles déjà chargés pour éviter un rechargement à chaque job.

_WHISPER_CACHE: dict[str, Any] = {}
_ALIGN_CACHE: dict[str, tuple[Any, Any]] = {}
_VAD_MODEL: Any = None  # silero-VAD, chargé à la demande
_VAD_GET_SPEECH_TS: Any = None  # utils[0] de silero-VAD, mis en cache avec le modèle


def _optimal_batch_size(device: str) -> int:
    """
    Retourne un batch_size adapté à la VRAM disponible.
    large-v3-turbo occupe ~3-4 GB VRAM — le reste peut servir au batch.
    Valeurs conservatrices : on garde de la marge pour le décodage audio.
    CPU : int8 peu demand, batch=8 suffit.
    """
    if device != "cuda":
        return 8
    try:
        import torch
        vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
        if vram_gb >= 24:
            return 32
        if vram_gb >= 16:
            return 24
        if vram_gb >= 10:
            return 16
        return 8
    except Exception:
        return 16


def _get_whisper_model(model_size: str, device: str, compute_type: str) -> Any:
    import whisperx
    key = f"{model_size}|{device}|{compute_type}"
    if key in _WHISPER_CACHE:
        print(f"[transcribe] modèle {model_size} réutilisé depuis le cache ({device}/{compute_type})", flush=True)
        return _WHISPER_CACHE[key]

    t0 = time.time()
    print(f"[transcribe] chargement modèle {model_size} ({device}/{compute_type})...", flush=True)
    _WHISPER_CACHE[key] = whisperx.load_model(model_size, device, compute_type=compute_type)
    print(f"[transcribe] modèle {model_size} prêt — {time.time()-t0:.1f}s", flush=True)
    return _WHISPER_CACHE[key]


def _get_align_model(language: str, device: str) -> tuple[Any, Any]:
    import whisperx
    key = f"{language}|{device}"
    if key in _ALIGN_CACHE:
        print(f"[transcribe] alignement {language} réutilisé depuis le cache ({device})", flush=True)
        return _ALIGN_CACHE[key]

    t0 = time.time()
    print(f"[transcribe] chargement modèle d'alignement ({language})...", flush=True)
    _ALIGN_CACHE[key] = whisperx.load_align_model(language_code=language, device=device)
    print(f"[transcribe] alignement {language} prêt — {time.time()-t0:.1f}s", flush=True)
    return _ALIGN_CACHE[key]


def _apply_vad_trim(
    audio: Any,  # numpy float32 array at 16kHz
    segments: list[dict[str, Any]],
    *,
    sample_rate: int = 16000,
    speech_pad_ms: int = 80,
) -> list[dict[str, Any]]:
    """
    Post-processing VAD : clippe les timestamps de fin des mots et segments
    qui débordent au-delà de la fin de parole détectée par silero-VAD.

    Seuls les derniers mots de chaque segment sont candidats à la correction.
    La musique de fond (moins forte que la voix) est gérée correctement par
    silero-VAD qui détecte la parole humaine spécifiquement.

    Dégradation gracieuse : si silero-VAD est indisponible ou échoue,
    les segments sont retournés sans modification.
    """
    global _VAD_MODEL, _VAD_GET_SPEECH_TS
    try:
        import torch

        if _VAD_MODEL is None:
            print("[transcribe] chargement silero-VAD via torch.hub...", flush=True)
            t0 = time.time()
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                trust_repo=True,
            )
            _VAD_MODEL = _vad_model
            _VAD_GET_SPEECH_TS = _vad_utils[0]
            print(f"[transcribe] silero-VAD prêt — {time.time()-t0:.1f}s", flush=True)

        get_speech_timestamps = _VAD_GET_SPEECH_TS
        audio_tensor = torch.from_numpy(audio).float()

        # threshold=0.85 (vs défaut 0.5) : silero-VAD est entraîné sur parole
        # humaine pure ; un threshold élevé filtre la musique de fond et les
        # ambiances. Sur des templates avec musique mixée à la voix (RVA4,
        # cover bands, etc.), 0.5 laissait passer la musique comme "parole"
        # → last_speech_end restait à la fin de la zone musicale → les mots
        # finaux étirés par WhisperX (cas connu : Whisper extend l'`end` du
        # dernier mot dans le silence qui suit) n'étaient pas clippés.
        #
        # min_silence_duration_ms=250 (vs 100) : cut dès qu'il y a 250ms de
        # non-parole continue, ce qui resserre les zones VAD autour des
        # phrases parlées réelles.
        speech_ts = get_speech_timestamps(
            audio_tensor,
            _VAD_MODEL,
            sampling_rate=sample_rate,
            threshold=0.85,
            min_silence_duration_ms=250,
            speech_pad_ms=speech_pad_ms,
        )
    except Exception as exc:
        print(f"[transcribe] VAD indisponible (non bloquant) : {exc}", flush=True)
        return segments

    if not speech_ts:
        return segments

    # Convertir en secondes
    speech_intervals: list[tuple[float, float]] = [
        (ts["start"] / sample_rate, ts["end"] / sample_rate)
        for ts in speech_ts
    ]

    trimmed_count = 0

    for seg in segments:
        words = seg.get("words", [])
        if not words:
            continue

        seg_start = seg.get("start", 0.0)
        seg_end = seg.get("end", words[-1]["end"])

        # Intervalles VAD qui chevauchent la zone de ce segment (avec 500ms de marge)
        relevant = [
            (s, e) for s, e in speech_intervals
            if e >= seg_start - 0.5 and s <= seg_end + 0.5
        ]
        if not relevant:
            continue

        last_speech_end = max(e for _, e in relevant)
        cap = last_speech_end  # padding déjà inclus dans speech_pad_ms de silero

        for word in words:
            if word["end"] > cap + 0.03:  # 30ms de tolérance
                if cap < word["start"]:
                    # Mot entièrement hors zone VAD — cas extrême, on ne touche pas
                    continue
                old_end = word["end"]
                word["end"] = round(max(cap, word["start"]), 3)
                trimmed_count += 1
                print(
                    f"[transcribe] VAD trim : mot «{word.get('word', '?')}» "
                    f"{old_end:.3f}s → {word['end']:.3f}s",
                    flush=True,
                )

        if seg_end > cap + 0.03:
            seg["end"] = round(min(cap, words[-1]["end"]), 3)

    if trimmed_count > 0:
        print(f"[transcribe] VAD : {trimmed_count} mots finaux clippés au total", flush=True)
    else:
        print("[transcribe] VAD : aucun débordement détecté", flush=True)

    return segments


def transcribe_with_word_timestamps(
    audio_path: str | Path,
    model_size: str = "large-v3-turbo",
    language: str = "fr",
    enable_diarization: bool = False,
    hf_token: str | None = None,
) -> list[dict[str, Any]]:
    """
    Transcrit un fichier audio/vidéo avec WhisperX et retourne les segments.

    Args:
        audio_path: Chemin vers le fichier audio ou vidéo.
        model_size: Modèle Whisper à utiliser (ex: "turbo", "large-v3").
        language: Code langue (ex: "fr", "en").
        enable_diarization: Active l'identification des intervenants (requiert hf_token).
        hf_token: Token HuggingFace pour pyannote (requis si enable_diarization=True).

    Returns:
        Liste de dicts { start, end, text, speaker? }.
        Le champ "speaker" est présent uniquement si la diarisation a réussi.
    """
    import whisperx

    audio_path = str(audio_path)
    device, compute_type = _resolve_device()

    # WhisperX ne supporte pas MPS — forcer CPU si besoin
    whisper_device = device if device == "cuda" else "cpu"

    # Normalise le nom de modèle ("turbo" → "large-v3-turbo" comme dans le module externe)
    if model_size == "turbo":
        model_size = "large-v3-turbo"

    t0 = time.time()
    print(f"[transcribe] device={whisper_device} ({compute_type}) model={model_size} lang={language}", flush=True)

    # 1. Charger l'audio
    audio = whisperx.load_audio(audio_path)
    total_minutes = len(audio) / 16000 / 60
    print(f"[transcribe] audio chargé — {total_minutes:.1f} min", flush=True)

    # 2. Transcription Whisper (modèle mis en cache entre les jobs)
    print(f"[transcribe] transcription...", flush=True)
    model = _get_whisper_model(model_size, whisper_device, compute_type)
    batch_size = _optimal_batch_size(whisper_device)
    print(f"[transcribe] batch_size={batch_size}", flush=True)
    result = model.transcribe(audio, batch_size=batch_size, language=language)
    print(f"[transcribe] {len(result['segments'])} segments bruts — {time.time()-t0:.0f}s", flush=True)

    # 3. Alignement timestamps mot par mot (modèle mis en cache entre les jobs)
    print(f"[transcribe] alignement...", flush=True)
    align_model, align_metadata = _get_align_model(language, whisper_device)
    result = whisperx.align(
        result["segments"], align_model, align_metadata, audio, whisper_device,
        return_char_alignments=False,
    )
    print(f"[transcribe] alignement terminé — {time.time()-t0:.0f}s", flush=True)

    # 3b. VAD post-processing : clippe les débordements de mots en fin de segment
    print("[transcribe] VAD post-processing...", flush=True)
    result["segments"] = _apply_vad_trim(audio, result["segments"])

    # 4. Diarisation (optionnelle)
    has_diarization = False
    if enable_diarization and hf_token:
        try:
            print(f"[transcribe] diarisation...", flush=True)
            from whisperx.diarize import DiarizationPipeline
            diarize_model = DiarizationPipeline(token=hf_token, device=device)
            diarize_segments = diarize_model(audio)
            result = whisperx.assign_word_speakers(diarize_segments, result)
            has_diarization = True
            print(f"[transcribe] diarisation terminée — {time.time()-t0:.0f}s", flush=True)
        except Exception as exc:
            print(f"[transcribe] diarisation échouée (non bloquant) : {exc}", flush=True)
    elif enable_diarization and not hf_token:
        print("[transcribe] diarisation demandée mais HF_TOKEN absent — ignorée", flush=True)

    # 5. Normaliser les segments en dicts simples
    segments: list[dict[str, Any]] = []
    for seg in result.get("segments", []):
        words = [
            {
                "word": str(w["word"]).strip(),
                "start": float(w["start"]),
                "end": float(w["end"]),
                "score": float(w.get("score", 1.0)),  # WhisperX per-word confidence
            }
            for w in seg.get("words", [])
            if "word" in w and "start" in w and "end" in w
        ]
        avg_confidence = (
            sum(ww["score"] for ww in words) / len(words)
            if words else 1.0
        )
        entry: dict[str, Any] = {
            "start": float(seg.get("start", 0)),
            "end": float(seg.get("end", 0)),
            "text": seg.get("text", "").strip(),
            "words": words,
            "avg_confidence": round(avg_confidence, 3),
        }
        speaker = seg.get("speaker")
        if speaker:
            entry["speaker"] = speaker
        segments.append(entry)

    print(
        f"[transcribe] terminé — {len(segments)} segments, "
        f"diarisation={has_diarization}, durée_totale={time.time()-t0:.0f}s",
        flush=True,
    )
    return segments


# ─── Mode multi-langue (chemin séparé du mono) ────────────────────────────────
#
# Sépare strictement le flux mono-langue (fonction historique ci-dessus) du flux
# multi-langue. Aucune modification de transcribe_with_word_timestamps : tout le
# code multi vit ici. Cf. plan dewdrop pour les invariants.


def _overlap_ratio(a: dict[str, Any], b: dict[str, Any]) -> float:
    a_start, a_end = a.get("start", 0.0), a.get("end", 0.0)
    b_start, b_end = b.get("start", 0.0), b.get("end", 0.0)
    if a_end <= b_start or b_end <= a_start:
        return 0.0
    overlap = min(a_end, b_end) - max(a_start, b_start)
    shorter = min(a_end - a_start, b_end - b_start)
    if shorter <= 0:
        return 0.0
    return overlap / shorter


def _merge_multilingual_segments_by_confidence(
    passes_by_language: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """
    Fusionne les segments produits par N passes Whisper (une par langue forcée)
    en gardant, pour chaque tranche temporelle, le segment avec la meilleure
    avg_confidence WhisperX.

    Algorithme :
      1. Collecte tous les segments de toutes les passes dans une liste unique.
      2. Trie par (start, end).
      3. Itère : si un segment chevauche un segment déjà retenu à ≥50% de la
         durée du plus court, on garde celui avec la confiance la plus haute.
         Sinon on l'ajoute aux retenus.
      4. Re-trie la liste finale par start.

    Compromis : algo glouton simple — peut produire des résultats sous-optimaux
    sur des chaînes de chevauchements croisés. Suffisant pour le MVP "récurrent
    léger" sur du code-switching par blocs >5s.
    """
    if not passes_by_language:
        return []

    all_segments: list[dict[str, Any]] = []
    for lang_segs in passes_by_language.values():
        all_segments.extend(lang_segs)

    if not all_segments:
        return []

    all_segments.sort(key=lambda s: (s.get("start", 0.0), s.get("end", 0.0)))

    retained: list[dict[str, Any]] = []
    multi_overlap_count = 0

    for seg in all_segments:
        # Collecte TOUS les conflits (≥1) — un long segment d'une passe peut
        # chevaucher plusieurs segments courts déjà retenus d'une autre passe.
        # Le code initial ne gérait que le premier conflict trouvé, ce qui
        # laissait passer des duplicats. On retient ici le seg uniquement si
        # son avg_confidence dépasse celle du conflit le plus confiant ; on
        # log un warning quand >1 conflits sont rencontrés pour faciliter le
        # debug sur des fusions atypiques.
        conflict_indices: list[int] = []
        for idx, kept in enumerate(retained):
            if _overlap_ratio(seg, kept) >= 0.5:
                conflict_indices.append(idx)

        if not conflict_indices:
            retained.append(seg)
            continue

        if len(conflict_indices) > 1:
            multi_overlap_count += 1
            print(
                f"[transcribe-multi] fusion : segment {seg.get('language')} "
                f"[{seg.get('start', 0):.2f}-{seg.get('end', 0):.2f}] chevauche "
                f"{len(conflict_indices)} segments retenus — résolu en "
                f"comparant à la meilleure confidence",
                flush=True,
            )

        best_conflict_idx = max(
            conflict_indices,
            key=lambda i: retained[i].get("avg_confidence", 0.0),
        )
        best_kept = retained[best_conflict_idx]
        if seg.get("avg_confidence", 0.0) > best_kept.get("avg_confidence", 0.0):
            retained[best_conflict_idx] = seg

    if multi_overlap_count > 0:
        print(
            f"[transcribe-multi] fusion : {multi_overlap_count} conflits multi-overlap "
            f"résolus (cas atypiques — vérifier la transcription si bizarre).",
            flush=True,
        )

    retained.sort(key=lambda s: s.get("start", 0.0))
    return retained


def transcribe_multilingual_with_word_timestamps(
    audio_path: str | Path,
    languages: list[str],
    model_size: str = "large-v3-turbo",
    enable_diarization: bool = False,
    hf_token: str | None = None,
) -> list[dict[str, Any]]:
    """
    Transcrit un fichier audio multilingue (typiquement bilingue FR↔ZH) en
    lançant N passes Whisper avec une langue FORCÉE différente à chaque passe,
    puis fusionne par segment selon la meilleure avg_confidence WhisperX.

    Principe fondamental : `language=lang_code` est explicitement forcé pour
    chaque passe (jamais `None`). Sans ce forçage, Whisper détecterait la même
    langue dominante à chaque appel et produirait le même résultat dégradé. En
    forçant des langues différentes, on garantit que :
      - sur les segments de la "vraie" langue, la passe correspondante produit
        une transcription propre avec une confiance haute,
      - sur les segments de l'autre langue, cette même passe hallucine en
        phonétique avec une confiance basse — qui perd la fusion face à la
        passe de la "bonne" langue.

    Args:
        audio_path: Chemin vers le fichier audio/vidéo.
        languages: Liste de codes langue ISO à transcrire (ex: ["fr", "zh"]).
                   Au moins 2 entrées, toutes uniques et explicites (jamais "auto").
        model_size: Modèle Whisper (turbo / large-v3 / ...).
        enable_diarization: Appliquée une seule fois sur le résultat fusionné.
        hf_token: Token HuggingFace pour pyannote.

    Returns:
        Liste de dicts { start, end, text, words, avg_confidence, language, speaker? }.
        Chaque segment porte le code langue de la passe gagnante.
    """
    import whisperx

    if not isinstance(languages, list) or len(languages) < 2:
        raise ValueError(
            f"transcribe_multilingual_with_word_timestamps exige au moins 2 langues, reçu : {languages}"
        )

    normalized_languages: list[str] = []
    seen: set[str] = set()
    for raw in languages:
        code = str(raw).strip().lower()
        if not code:
            continue
        if code == "auto":
            raise ValueError("'auto' n'est pas autorisé : chaque passe doit forcer une langue ISO explicite.")
        if code not in seen:
            normalized_languages.append(code)
            seen.add(code)

    if len(normalized_languages) < 2:
        raise ValueError(f"Après normalisation, moins de 2 langues distinctes : {languages}")

    audio_path = str(audio_path)
    device, compute_type = _resolve_device()
    whisper_device = device if device == "cuda" else "cpu"

    if model_size == "turbo":
        model_size = "large-v3-turbo"

    t0 = time.time()
    print(
        f"[transcribe-multi] device={whisper_device} ({compute_type}) "
        f"model={model_size} langues={normalized_languages}",
        flush=True,
    )

    audio = whisperx.load_audio(audio_path)
    total_minutes = len(audio) / 16000 / 60
    print(f"[transcribe-multi] audio chargé — {total_minutes:.1f} min", flush=True)

    model = _get_whisper_model(model_size, whisper_device, compute_type)
    batch_size = _optimal_batch_size(whisper_device)
    print(f"[transcribe-multi] batch_size={batch_size}", flush=True)

    passes_by_language: dict[str, list[dict[str, Any]]] = {}
    failed_languages: list[tuple[str, str]] = []

    for lang in normalized_languages:
        print(f"[transcribe-multi] === Passe langue={lang} (forcée) ===", flush=True)
        t_pass = time.time()

        try:
            result = model.transcribe(audio, batch_size=batch_size, language=lang)
            print(
                f"[transcribe-multi] {lang}: {len(result['segments'])} segments bruts — "
                f"{time.time()-t_pass:.0f}s",
                flush=True,
            )

            # _get_align_model peut échouer si WhisperX ne fournit pas d'aligneur
            # pour cette langue (ar, ko, et autres ISO peu courants peuvent ne
            # pas avoir de modèle d'alignement par défaut côté HuggingFace).
            # On isole l'erreur de cette passe — les autres langues continuent.
            align_model, align_metadata = _get_align_model(lang, whisper_device)
            result = whisperx.align(
                result["segments"], align_model, align_metadata, audio, whisper_device,
                return_char_alignments=False,
            )
            print(f"[transcribe-multi] {lang}: alignement OK — {time.time()-t_pass:.0f}s", flush=True)

            result["segments"] = _apply_vad_trim(audio, result["segments"])

            lang_segments: list[dict[str, Any]] = []
            for seg in result.get("segments", []):
                words = [
                    {
                        "word": str(w["word"]).strip(),
                        "start": float(w["start"]),
                        "end": float(w["end"]),
                        "score": float(w.get("score", 1.0)),
                    }
                    for w in seg.get("words", [])
                    if "word" in w and "start" in w and "end" in w
                ]
                # Fallback 0.0 (et non 1.0) pour ne PAS gagner la fusion : un
                # segment sans words alignés ne porte aucune information utile,
                # il doit s'effacer devant les passes qui en ont produit.
                avg_confidence = (
                    sum(ww["score"] for ww in words) / len(words)
                    if words else 0.0
                )
                lang_segments.append({
                    "start": float(seg.get("start", 0)),
                    "end": float(seg.get("end", 0)),
                    "text": seg.get("text", "").strip(),
                    "words": words,
                    "avg_confidence": round(avg_confidence, 3),
                    "language": lang,
                })

            passes_by_language[lang] = lang_segments
            print(
                f"[transcribe-multi] {lang}: passe terminée — {len(lang_segments)} segments, "
                f"{time.time()-t_pass:.0f}s",
                flush=True,
            )
        except Exception as exc:
            # Cas type : aligneur WhisperX absent pour cette langue, modèle ASR
            # cassé sur cette langue, OOM CUDA sur la passe. On dégrade au lieu
            # de tuer toute la transcription multi (les autres langues peuvent
            # encore produire un résultat utile).
            err_msg = f"{type(exc).__name__}: {exc}"
            failed_languages.append((lang, err_msg))
            print(
                f"[transcribe-multi] {lang}: passe ÉCHOUÉE (non bloquant pour les autres "
                f"langues) — {err_msg}",
                flush=True,
            )

    # Si AUCUNE langue n'a produit de segments, on remonte une erreur globale
    # (sinon le worker uploaderait un JSON vide en R2 et marquerait le job OK).
    if not passes_by_language:
        raise RuntimeError(
            f"Toutes les passes multi-langue ont échoué : "
            + "; ".join(f"{l}={e}" for l, e in failed_languages)
        )

    merged = _merge_multilingual_segments_by_confidence(passes_by_language)
    print(
        f"[transcribe-multi] fusion : {len(merged)} segments retenus sur "
        f"{sum(len(v) for v in passes_by_language.values())} total — {time.time()-t0:.0f}s",
        flush=True,
    )

    has_diarization = False
    if enable_diarization and hf_token:
        try:
            print(f"[transcribe-multi] diarisation...", flush=True)
            from whisperx.diarize import DiarizationPipeline
            diarize_model = DiarizationPipeline(token=hf_token, device=device)
            diarize_segments = diarize_model(audio)
            pseudo_result = {"segments": merged}
            pseudo_result = whisperx.assign_word_speakers(diarize_segments, pseudo_result)
            merged = pseudo_result["segments"]
            has_diarization = True
            print(f"[transcribe-multi] diarisation terminée — {time.time()-t0:.0f}s", flush=True)
        except Exception as exc:
            print(f"[transcribe-multi] diarisation échouée (non bloquant) : {exc}", flush=True)
    elif enable_diarization and not hf_token:
        print("[transcribe-multi] diarisation demandée mais HF_TOKEN absent — ignorée", flush=True)

    print(
        f"[transcribe-multi] terminé — {len(merged)} segments, "
        f"diarisation={has_diarization}, durée_totale={time.time()-t0:.0f}s",
        flush=True,
    )
    return merged


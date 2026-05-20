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
    speech_pad_ms: int = 150,
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

        speech_ts = get_speech_timestamps(
            audio_tensor,
            _VAD_MODEL,
            sampling_rate=sample_rate,
            threshold=0.5,
            min_silence_duration_ms=100,
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

    pad_s = speech_pad_ms / 1000.0
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
        cap = last_speech_end + pad_s

        last_word = words[-1]
        if last_word["end"] > cap + 0.05:  # 50ms de tolérance
            old_end = last_word["end"]
            last_word["end"] = round(cap, 3)
            trimmed_count += 1
            print(
                f"[transcribe] VAD trim : mot «{last_word.get('word', '?')}» "
                f"{old_end:.3f}s → {last_word['end']:.3f}s",
                flush=True,
            )

        if seg_end > cap + 0.05:
            seg["end"] = round(min(cap, last_word["end"]), 3)

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


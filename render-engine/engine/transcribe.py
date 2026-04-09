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


def _get_whisper_model(model_size: str, device: str, compute_type: str) -> Any:
    import whisperx
    key = f"{model_size}|{device}|{compute_type}"
    if key not in _WHISPER_CACHE:
        print(f"[transcribe] chargement modèle {model_size} ({device}/{compute_type})...", flush=True)
        _WHISPER_CACHE[key] = whisperx.load_model(model_size, device, compute_type=compute_type)
    return _WHISPER_CACHE[key]


def _get_align_model(language: str, device: str) -> tuple[Any, Any]:
    import whisperx
    key = f"{language}|{device}"
    if key not in _ALIGN_CACHE:
        print(f"[transcribe] chargement modèle d'alignement ({language})...", flush=True)
        _ALIGN_CACHE[key] = whisperx.load_align_model(language_code=language, device=device)
    return _ALIGN_CACHE[key]


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
    result = model.transcribe(audio, batch_size=16, language=language)
    print(f"[transcribe] {len(result['segments'])} segments bruts — {time.time()-t0:.0f}s", flush=True)

    # 3. Alignement timestamps mot par mot (modèle mis en cache entre les jobs)
    print(f"[transcribe] alignement...", flush=True)
    align_model, align_metadata = _get_align_model(language, whisper_device)
    result = whisperx.align(
        result["segments"], align_model, align_metadata, audio, whisper_device,
        return_char_alignments=False,
    )
    print(f"[transcribe] alignement terminé — {time.time()-t0:.0f}s", flush=True)

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
            {"word": str(w["word"]).strip(), "start": float(w["start"]), "end": float(w["end"])}
            for w in seg.get("words", [])
            if "word" in w and "start" in w and "end" in w
        ]
        entry: dict[str, Any] = {
            "start": float(seg.get("start", 0)),
            "end": float(seg.get("end", 0)),
            "text": seg.get("text", "").strip(),
            "words": words,
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


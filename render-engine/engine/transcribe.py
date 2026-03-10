from __future__ import annotations

from pathlib import Path

from .models import WordTimestamp


def transcribe_with_word_timestamps(video_path: str | Path) -> list[WordTimestamp]:
    raise NotImplementedError("Auto-transcription is planned for phase 2 (Whisper/WhisperX).")

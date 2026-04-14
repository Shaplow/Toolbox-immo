from __future__ import annotations

import json
import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any

import httpx

from engine.derush.models import (
    AnalysisMode,
    DerushJobInput,
    DerushSegment,
    SourceFileInfo,
)
from engine.derush.pipeline_base import BasePipeline

logger = logging.getLogger(__name__)

# ─── Tag patterns (mirror of web/src/lib/transcriptionProcess.ts) ─────────────

_BACKSTAGE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r'\bon (la |les |)refait\b', re.I),
    re.compile(r'\bon recoupe\b', re.I),
    re.compile(r'\bon coupe\b', re.I),
    re.compile(r'\bon tourne\b', re.I),
    re.compile(r'\bon (re)?démarre\b', re.I),
    re.compile(r'\bclap\b', re.I),
    re.compile(r'\btop départ\b', re.I),
    re.compile(r'\baction\s*[!.]*\s*$', re.I),
    re.compile(r'\bje recommence\b', re.I),
    re.compile(r'\bje reprends\b', re.I),
    re.compile(r'\bon reprend depuis\b', re.I),
    re.compile(r'\btest (micro|son|audio|caméra|cam)\b', re.I),
    re.compile(r'\bcadrage\b', re.I),
    re.compile(r'\blarsen\b', re.I),
    re.compile(r'\bfeedback\b', re.I),
    re.compile(r'\bon entend (rien|pas|pas bien)\b', re.I),
    re.compile(r'\b(micro|son|audio|cam) (est |qui )?(mort|coupé|pas bon|galère|décale)\b', re.I),
    re.compile(r'\brapproche[- ]?(toi|vous)\b', re.I),
    re.compile(r'\brecule[- ]?(toi|vous)?\b', re.I),
    re.compile(r'\btourne[- ]?(toi|vous)? (un peu|vers|face)\b', re.I),
    re.compile(r'\bregarde (la caméra|l\'objectif|ici|là)\b', re.I),
    re.compile(r'\bparle (plus fort|moins fort|dans le micro|dans l\'axe)\b', re.I),
    re.compile(r'^(ok|okay|ouais|oui|non)[.\s!]*$', re.I),
    re.compile(r'^(euh+|hmm+|mh+|hm+|pfff+)[.\s!]*$', re.I),
]

_BACKSTAGE_KEYWORDS = {
    "on la refait", "on recoupe", "on coupe", "test micro", "test son",
    "test audio", "cadrage", "on tourne", "on redémarre", "on déroule",
    "clap", "top départ", "je recommence", "je reprends depuis",
    "parle plus fort", "parle moins fort", "dans le micro",
    "regarde la caméra", "regarde l'objectif",
    "rapproche-toi", "rapprochez-vous",
    "feedback", "larsen", "on entend rien",
}

_RETAKE_KEYWORDS = {
    "on la refait", "on recoupe", "on coupe", "on redémarre",
    "je recommence", "je reprends", "on reprend depuis",
}


def _is_backstage(text: str, duration: float) -> bool:
    # Very short segments with no real content are backstage noise
    if duration < 0.5:
        return True
    lower = text.strip().lower()
    clean = re.sub(r'[.,!?;:«»"\']', '', lower).strip()
    for kw in _BACKSTAGE_KEYWORDS:
        if kw in lower:
            return True
    for pattern in _BACKSTAGE_PATTERNS:
        if pattern.search(clean):
            return True
    return False


def _tag_segment(text: str, duration: float) -> str:
    if _is_backstage(text, duration):
        lower = text.strip().lower()
        for kw in _RETAKE_KEYWORDS:
            if kw in lower:
                return "RETAKE"
        return "BACKSTAGE"
    return "CONTENT"


# ─── Hesitation analysis ────────────────────────────────────────────────────────

_HESITATION_WORDS: frozenset[str] = frozenset({
    "euh", "eh", "hm", "hmm", "hein", "bah", "ben", "bon",
    "voilà", "enfin", "quoi", "genre",
})
_HESITATION_PATTERN = re.compile(r'\b(euh+|eh+|hmm*|mh+)\b', re.I)
_CONFIDENCE_THRESHOLD = 0.60   # below this → low_confidence reject
_HESITATION_RATIO_THRESHOLD = 0.25  # >25% words are filler → hesitant reject


def _hesitation_ratio(text: str) -> float:
    """Returns the fraction of words that are hesitation markers (0.0–1.0)."""
    words = re.sub(r'[^\w\s]', '', text.lower()).split()
    if not words:
        return 0.0
    # Count dictionary hesitations
    dict_count = sum(1 for w in words if w in _HESITATION_WORDS)
    # Count phonetic patterns (may overlap, use max to avoid double-counting)
    phonetic_count = len(_HESITATION_PATTERN.findall(text))
    total = max(dict_count, phonetic_count)
    return min(1.0, total / len(words))


# ─── Score from tag ────────────────────────────────────────────────────────────

_TAG_BASE_SCORE: dict[str, float] = {
    "CONTENT": 80.0,
    "BACKSTAGE": 15.0,
    "RETAKE": 5.0,
}

_TAG_TO_DERUSH_TAG: dict[str, str] = {
    "CONTENT": "speech_content",
    "BACKSTAGE": "speech_backstage",
    "RETAKE": "speech_retake",
}


def _score_for_tag(tag: str) -> float:
    """Base score from tag. All CONTENT segments start equal — ranking is for the future montage module."""
    return _TAG_BASE_SCORE.get(tag, 30.0)


# ─── Semantic deduplication ─────────────────────────────────────────────────────


def _deduplicate_speech(segments: list[DerushSegment]) -> None:
    """
    Mark semantically duplicate segments as rejected (same content re-recorded).
    When two segments have similarity ≥ 0.80, keep the one with higher avg_confidence
    and reject the other with reason="duplicate_speech".
    O(n²) but n is small (typically < 300 segments per job).
    """
    active = [s for s in segments if not s.is_rejected and s.text]
    for i, seg_a in enumerate(active):
        if seg_a.is_rejected:
            continue
        for seg_b in active[i + 1:]:
            if seg_b.is_rejected:
                continue
            ratio = SequenceMatcher(None, seg_a.text or "", seg_b.text or "").ratio()
            if ratio >= 0.80:
                conf_a = seg_a.avg_confidence or 0.8
                conf_b = seg_b.avg_confidence or 0.8
                loser = seg_b if conf_a >= conf_b else seg_a
                loser.is_rejected = True
                loser.reject_reason = "duplicate_speech"  # type: ignore[assignment]


# ─── Pipeline ─────────────────────────────────────────────────────────────────

class TranscriptionPipeline(BasePipeline):
    """
    Maps transcription segments to DerushSegment.

    Filtering stages (in order):
      1. Backstage/Retake keyword detection (fast, no cost)
      2. Confidence filter: avg_confidence < 0.60 → low_confidence reject
      3. Hesitation filter: >25% filler words → hesitant reject
      4. Gemini Flash batch: format_hints + usability gate (optional, requires api_key)
      5. Semantic deduplication: same content re-recorded → keep best take

    Input priority (highest to lowest):
      1. job_input.transcription_output_url  → existing segments JSON from R2
      2. video files  → run transcription inline
    """

    def analyze(
        self,
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[DerushSegment]:
        raw_segments = self._load_segments(source_files, job_input)
        return self._map_segments(raw_segments, source_files, job_input)

    # ── Loading ──────────────────────────────────────────────────────────────

    def _load_segments(
        self,
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[dict[str, Any]]:
        if job_input.transcription_output_url:
            logger.info("[transcription] reusing existing segments from %s",
                        job_input.transcription_output_url)
            raw = self._fetch_json(job_input.transcription_output_url)
        elif source_files:
            logger.info("[transcription] transcribing %s", source_files[0].local_path)
            raw = self._transcribe(source_files[0].local_path, job_input)
        else:
            raise ValueError("No source files provided for transcription pipeline")

        # Format-aware regrouping (merge segments separated by short silences)
        silence_threshold = float(job_input.format_config.get("silence_threshold", 0))
        max_merge_duration = float(job_input.format_config.get("max_merge_duration", 20.0))
        if silence_threshold > 0:
            raw = self._regroup_segments(raw, silence_threshold, max_merge_duration)

        return raw

    def _fetch_json(self, url: str) -> list[dict[str, Any]]:
        resp = httpx.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("segments", data)

    def _transcribe(
        self,
        audio_path: str,
        job_input: DerushJobInput,
    ) -> list[dict[str, Any]]:
        from engine.transcribe import transcribe_with_word_timestamps
        model_size = job_input.transcription_model or "turbo"
        language = job_input.transcription_language or "fr"
        hf_token = os.environ.get("HF_TOKEN") if job_input.enable_diarization else None
        return transcribe_with_word_timestamps(
            audio_path,
            model_size=model_size,
            language=language,
            enable_diarization=job_input.enable_diarization,
            hf_token=hf_token,
        )

    # ── Mapping ───────────────────────────────────────────────────────────────

    def _map_segments(
        self,
        raw: list[dict[str, Any]],
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[DerushSegment]:
        source_id = source_files[0].id if source_files else "src_00_0"
        segments: list[DerushSegment] = []

        # Pre/post-roll in seconds — adds breathing room around word boundaries.
        # Configurable per format; defaults: 80ms before first word, 120ms after last.
        pre_roll  = float(job_input.format_config.get("pre_roll",  0.08))
        post_roll = float(job_input.format_config.get("post_roll", 0.12))

        for idx, raw_seg in enumerate(raw):
            words = raw_seg.get("words") or []
            if words:
                # Word-boundary snapping: tighter than VAD segment timestamps
                source_in  = max(0.0, float(words[0]["start"]) - pre_roll)
                source_out = float(words[-1]["end"]) + post_roll
            else:
                # Fallback: SRT/JSON imported without word timestamps
                source_in  = float(raw_seg.get("start", 0))
                source_out = float(raw_seg.get("end", 0))

            start = source_in
            end   = source_out
            duration = end - start
            text = (raw_seg.get("text") or "").strip()
            speaker = raw_seg.get("speaker")
            avg_confidence: float | None = raw_seg.get("avg_confidence")  # absent in pre-existing JSONs

            speech_tag = _tag_segment(text, duration)
            score = _score_for_tag(speech_tag)

            # ── Rule-based rejection (fast, no API cost) ──────────────────────
            is_rejected = False
            reject_reason = None
            if speech_tag in ("RETAKE", "BACKSTAGE"):
                is_rejected = True
                reject_reason = "backstage"  # type: ignore[assignment]
            elif avg_confidence is not None and avg_confidence < _CONFIDENCE_THRESHOLD:
                is_rejected = True
                reject_reason = "low_confidence"  # type: ignore[assignment]
            elif _hesitation_ratio(text) >= _HESITATION_RATIO_THRESHOLD:
                is_rejected = True
                reject_reason = "hesitant"  # type: ignore[assignment]

            seg = DerushSegment(
                id=self._make_segment_id(0, idx),
                source_file_id=source_id,
                source_in=source_in,
                source_out=source_out,
                duration=duration,
                analysis_mode="transcription",
                score=score,
                text=text,
                speaker=speaker,
                speech_tag=speech_tag,
                avg_confidence=avg_confidence,
                tags=[_TAG_TO_DERUSH_TAG.get(speech_tag, "speech_content")],
                is_rejected=is_rejected,
                reject_reason=reject_reason,
            )
            segments.append(seg)

        # Semantic dedup (same content re-recorded → keep best take)
        _deduplicate_speech(segments)

        # Transcription correction via Gemini (before format enrichment)
        self._correct_transcription(segments, job_input)

        # Gemini enrichment: format_hints + usability gate (optional)
        self._enrich_with_gemini(segments, job_input)

        rejected = sum(1 for s in segments if s.is_rejected)
        logger.info("[transcription] %d usable, %d rejected from %d total",
                    len(segments) - rejected, rejected, len(segments))
        return segments

    # ── Segment regrouping ────────────────────────────────────────────────────

    def _regroup_segments(
        self,
        raw: list[dict[str, Any]],
        silence_threshold: float,
        max_merge_duration: float = 20.0,
    ) -> list[dict[str, Any]]:
        """
        Merge consecutive segments separated by a gap smaller than *silence_threshold*,
        but only if the resulting merged segment would not exceed *max_merge_duration*.

        For formats like RQR (3.0s threshold), the Q+A pair naturally stays together
        because the typical Q→A pause is ~1-2s, well below 3.0s.

        avg_confidence of the merged segment is the word-count-weighted average of its parts.
        """
        if not raw or silence_threshold <= 0:
            return raw

        merged: list[dict[str, Any]] = []
        current = dict(raw[0])

        for next_seg in raw[1:]:
            gap = float(next_seg.get("start", 0)) - float(current.get("end", 0))
            merged_duration = float(next_seg.get("end", 0)) - float(current.get("start", 0))
            if gap < silence_threshold and merged_duration <= max_merge_duration:
                # Merge: extend current segment
                current_text = (current.get("text") or "").strip()
                next_text = (next_seg.get("text") or "").strip()
                current["text"] = f"{current_text} {next_text}".strip()
                current["end"] = next_seg.get("end", current["end"])

                # Weighted avg_confidence
                conf_a = current.get("avg_confidence")
                conf_b = next_seg.get("avg_confidence")
                if conf_a is not None and conf_b is not None:
                    words_a = len(current.get("words", [])) or 1
                    words_b = len(next_seg.get("words", [])) or 1
                    total = words_a + words_b
                    current["avg_confidence"] = round(
                        (conf_a * words_a + conf_b * words_b) / total, 3
                    )

                # Merge word lists if present
                if "words" in current and "words" in next_seg:
                    current["words"] = current["words"] + next_seg["words"]
            else:
                merged.append(current)
                current = dict(next_seg)

        merged.append(current)

        logger.info(
            "[transcription] regrouped %d → %d segments (threshold=%.1fs, max_duration=%.1fs)",
            len(raw), len(merged), silence_threshold, max_merge_duration,
        )
        return merged

    # ── Transcription correction ──────────────────────────────────────────────

    def _correct_transcription(
        self,
        segments: list[DerushSegment],
        job_input: DerushJobInput,
    ) -> None:
        """
        Use Gemini to correct transcription errors (proper nouns, technical terms).
        Stores original text in text_raw, corrected text in text.
        Tags corrected segments with "text_corrected".
        No-op if no api_key.
        """
        if not job_input.gemini_api_key:
            return

        # Only correct non-rejected segments with text
        candidates = [s for s in segments if s.text and not s.is_rejected]
        if not candidates:
            return

        from engine.derush.providers.gemini import GeminiProvider
        provider = GeminiProvider(job_input.gemini_api_key)

        segments_data = [{"id": s.id, "text": s.text} for s in candidates]
        context_prompt = job_input.format_hint or ""

        try:
            corrections = provider.correct_transcription(segments_data, context_prompt)
        except Exception as exc:
            logger.warning("[transcription] correction failed: %s", exc)
            return

        if not corrections:
            return

        seg_map = {s.id: s for s in candidates}
        for seg_id, corrected_text in corrections.items():
            seg = seg_map.get(seg_id)
            if seg and corrected_text and corrected_text != seg.text:
                seg.text_raw = seg.text
                seg.text = corrected_text
                if "text_corrected" not in seg.tags:
                    seg.tags.append("text_corrected")

        logger.info("[transcription] corrected %d/%d segments via Gemini",
                    len(corrections), len(candidates))

    # ── Gemini enrichment ─────────────────────────────────────────────────────

    def _enrich_with_gemini(
        self,
        segments: list[DerushSegment],
        job_input: DerushJobInput,
    ) -> None:
        """Enrich usable segments with format_hints via Gemini Flash (no-op if no api_key)."""
        if not job_input.gemini_api_key:
            return

        from engine.derush.providers.gemini import GeminiProvider
        provider = GeminiProvider(job_input.gemini_api_key)

        usable = [s for s in segments if not s.is_rejected and s.text]
        if not usable:
            return

        batch_data = [
            {"id": s.id, "text": s.text, "duration": round(s.duration, 1)}
            for s in usable
        ]
        try:
            results = provider.analyze_speech_batch(batch_data, job_input.format_hint)
        except Exception as exc:
            logger.warning("[transcription] Gemini analysis failed: %s", exc)
            return

        for seg in usable:
            result = results.get(seg.id, {})
            if not result.get("usable", True):
                seg.is_rejected = True
                seg.reject_reason = result.get("reject_reason") or "truncated"  # type: ignore[assignment]
            else:
                seg.format_hints = result.get("format_hints", [])

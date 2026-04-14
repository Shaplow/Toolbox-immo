from __future__ import annotations

import logging
from typing import Any

from engine.derush.models import (
    DerushPresetConfig,
    DerushSegment,
    LocalMetrics,
    ScoreBreakdown,
)

logger = logging.getLogger(__name__)

# ─── Visual interest heuristic ────────────────────────────────────────────────

def _visual_interest(metrics: LocalMetrics) -> float:
    """
    Heuristic visual interest score.
    A good shot has: decent sharpness + some motion (not shake) + good composition.
    """
    base = (metrics.sharpness_score * 0.5 + metrics.composition_score * 0.5)
    # Motion adds interest (pan/tilt) but shake subtracts
    if metrics.motion_type in ("pan", "tilt"):
        base += 10.0
    elif metrics.motion_type == "shake":
        base -= 20.0
    return max(0.0, min(100.0, base))


def _diversity_score(segment: DerushSegment, all_segments: list[DerushSegment]) -> float:
    """
    Rough diversity: how different is this shot compared to the ones before it
    in the ranked list. Based on shot_type diversity and temporal spacing.
    """
    if not all_segments:
        return 100.0
    prev_types = {s.shot_type for s in all_segments[-5:]}  # last 5 accepted shots
    if segment.shot_type not in prev_types:
        return 100.0
    return max(20.0, 100.0 - len(prev_types) * 15.0)


# ─── Main scoring function ─────────────────────────────────────────────────────

def score_and_rank(
    segments: list[DerushSegment],
    preset: DerushPresetConfig | None = None,
) -> list[DerushSegment]:
    """
    Apply scoring + rejection logic + ranking.
    Returns the same list sorted by score desc (order field set).
    """
    config = preset or DerushPresetConfig()
    weights = config.scoring_weights
    thresholds = config.reject_thresholds

    accepted: list[DerushSegment] = []

    for seg in segments:
        # ── Reject already-marked (duplicate, etc.) ───────────────────────
        if seg.is_rejected:
            continue

        metrics: LocalMetrics | None = seg._local_metrics

        # ── Hard rejection (vision pipeline only) ────────────────────────
        if seg.analysis_mode == "vision" and metrics is not None:
            if seg.duration < thresholds.min_duration:
                _reject(seg, "too_short")
                continue
            if metrics.sharpness_score < thresholds.min_sharpness:
                _reject(seg, "blurry")
                seg.tags.append("blur_detected")
                continue
            if metrics.stability_score < (100.0 - thresholds.max_shake * 8.0):
                _reject(seg, "shake")
                seg.tags.append("shake_detected")
                continue
            if metrics.exposure_score < 10.0:
                _reject(seg, "underexposed")
                seg.tags.append("underexposed")
                continue
            if metrics.exposure_score > 98.0 and metrics.sharpness_score < 20.0:
                _reject(seg, "overexposed")
                seg.tags.append("overexposed")
                continue

        # ── Build score breakdown ─────────────────────────────────────────
        breakdown = ScoreBreakdown()

        if seg.analysis_mode == "vision" and metrics is not None:
            breakdown.sharpness = metrics.sharpness_score
            breakdown.stability = metrics.stability_score
            breakdown.exposure = metrics.exposure_score
            breakdown.composition = metrics.composition_score
            breakdown.duration_score = metrics.duration_score
            breakdown.visual_interest = _visual_interest(metrics)
            breakdown.diversity = _diversity_score(seg, accepted)
        elif seg.analysis_mode == "transcription":
            # For transcription, score already set by pipeline from tag+duration
            # Fill breakdown fields for UI display
            breakdown.speech_relevance = seg.score
            breakdown.duration_score = _duration_score_speech(seg.duration)

        # ── Weighted final score ──────────────────────────────────────────
        if seg.analysis_mode == "vision":
            final_score = (
                breakdown.sharpness       * weights.sharpness +
                breakdown.stability       * weights.stability +
                breakdown.exposure        * weights.exposure +
                breakdown.composition     * weights.composition +
                breakdown.duration_score  * weights.duration_score +
                breakdown.visual_interest * weights.visual_interest +
                breakdown.diversity       * weights.diversity
            )
        else:
            # Transcription: score already set, just preserve it
            final_score = seg.score

        seg.score = round(min(100.0, max(0.0, final_score)), 1)
        seg.score_breakdown = breakdown

        # ── Tags from breakdown ───────────────────────────────────────────
        _apply_quality_tags(seg, metrics)

        accepted.append(seg)

    # ── Sort by score and assign order ────────────────────────────────────
    accepted.sort(key=lambda s: s.score, reverse=True)
    for rank, seg in enumerate(accepted, start=1):
        seg.order = rank

    logger.info("[scoring] %d accepted, %d rejected from %d total",
                len(accepted), len(segments) - len(accepted), len(segments))
    return segments  # return full list (rejected included) for manifest


def _reject(seg: DerushSegment, reason: str) -> None:
    seg.is_rejected = True
    seg.reject_reason = reason  # type: ignore[assignment]


def _duration_score_speech(duration: float) -> float:
    """Speech duration: 5-60s optimal."""
    if 5.0 <= duration <= 60.0:
        return 100.0
    if duration < 5.0:
        return (duration / 5.0) * 80.0
    return max(40.0, 100.0 - (duration - 60.0))


def _apply_quality_tags(seg: DerushSegment, metrics: LocalMetrics | None) -> None:
    if metrics is None:
        return
    if metrics.sharpness_score >= 70.0 and "sharp" not in seg.tags:
        seg.tags.append("sharp")
    if metrics.stability_score >= 80.0 and "stable" not in seg.tags:
        seg.tags.append("stable")
    if 30.0 <= metrics.exposure_score <= 90.0 and "good_exposure" not in seg.tags:
        seg.tags.append("good_exposure")
    if metrics.composition_score >= 60.0 and "good_composition" not in seg.tags:
        seg.tags.append("good_composition")
    if metrics.motion_type == "static" and "static_shot" not in seg.tags:
        seg.tags.append("static_shot")
    elif metrics.motion_type in ("pan", "tilt") and "camera_move" not in seg.tags:
        seg.tags.append("camera_move")

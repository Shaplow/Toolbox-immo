from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Literal, Optional


# ─── Analysis pipeline ────────────────────────────────────────────────────────

AnalysisMode = Literal["transcription", "vision"]
DerushStatus = Literal["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]
ShotType = Literal["wide", "medium", "close", "insert", "unknown"]

RejectReason = Literal[
    "too_short",
    "blurry",
    "shake",
    "duplicate",
    "occlusion",
    "start_stop",
    "overexposed",
    "underexposed",
    "black_frame",
    # Transcription pipeline
    "backstage",
    "hesitant",
    "low_confidence",
    "duplicate_speech",
]


# ─── Preset config ─────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ScoringWeights:
    sharpness: float = 0.25
    stability: float = 0.20
    exposure: float = 0.15
    composition: float = 0.15
    duration_score: float = 0.10
    visual_interest: float = 0.10
    diversity: float = 0.05

    def validate(self) -> None:
        total = (
            self.sharpness + self.stability + self.exposure +
            self.composition + self.duration_score +
            self.visual_interest + self.diversity
        )
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"ScoringWeights must sum to 1.0, got {total:.3f}")

    @classmethod
    def from_dict(cls, d: dict[str, float]) -> "ScoringWeights":
        return cls(**{k: v for k, v in d.items() if hasattr(cls, k)})


@dataclass(slots=True)
class RejectThresholds:
    min_duration: float = 0.5   # seconds
    min_sharpness: float = 15.0 # 0-100
    max_shake: float = 10.0     # 0-100 (lower = stricter)

    @classmethod
    def from_dict(cls, d: dict[str, float]) -> "RejectThresholds":
        return cls(**{k: v for k, v in d.items() if hasattr(cls, k)})


@dataclass(slots=True)
class SubSegmentConfig:
    """Parameters for windowed re-analysis of rejected shots."""
    enabled: bool = True
    min_window: float = 1.5    # minimum fragment length (s)
    max_window: float = 3.0    # maximum window size tried (s)
    stride: float = 0.75       # sliding step (s) — larger = fewer windows = faster
    min_parent_duration: float = 2.0  # reject shots shorter than this are not fragmented

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SubSegmentConfig":
        return cls(**{k: v for k, v in d.items() if hasattr(cls, k)})


@dataclass(slots=True)
class DerushPresetConfig:
    scoring_weights: ScoringWeights = field(default_factory=ScoringWeights)
    reject_thresholds: RejectThresholds = field(default_factory=RejectThresholds)
    sub_segment: SubSegmentConfig = field(default_factory=SubSegmentConfig)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DerushPresetConfig":
        weights = ScoringWeights.from_dict(d.get("scoring_weights", {}))
        thresholds = RejectThresholds.from_dict(d.get("reject_thresholds", {}))
        sub_segment = SubSegmentConfig.from_dict(d.get("sub_segment", {}))
        return cls(scoring_weights=weights, reject_thresholds=thresholds, sub_segment=sub_segment)

    @classmethod
    def beauty(cls) -> "DerushPresetConfig":
        """Visual beauty: immobilier, lookbook, visuels soignés."""
        return cls(
            scoring_weights=ScoringWeights(
                sharpness=0.35,
                stability=0.20,
                exposure=0.20,
                composition=0.15,
                duration_score=0.05,
                visual_interest=0.05,
                diversity=0.00,
            )
        )

    @classmethod
    def content_relevance(cls) -> "DerushPresetConfig":
        """Contenu éducatif / podcast : parole pertinente, durée longue."""
        return cls(
            scoring_weights=ScoringWeights(
                sharpness=0.10,
                stability=0.10,
                exposure=0.05,
                composition=0.05,
                duration_score=0.25,
                visual_interest=0.20,
                diversity=0.25,
            )
        )

    @classmethod
    def action(cls) -> "DerushPresetConfig":
        """Événementiel / sport : diversité et movement."""
        return cls(
            scoring_weights=ScoringWeights(
                sharpness=0.20,
                stability=0.15,
                exposure=0.10,
                composition=0.10,
                duration_score=0.10,
                visual_interest=0.15,
                diversity=0.20,
            )
        )

    @classmethod
    def balanced(cls) -> "DerushPresetConfig":
        """Défaut générique."""
        return cls()


# ─── Source file ───────────────────────────────────────────────────────────────

@dataclass(slots=True)
class SourceFileInfo:
    id: str           # "src_001"
    filename: str
    local_path: str   # downloaded temp path on worker
    r2_key: str
    r2_public_url: str
    duration: float
    width: int
    height: int
    fps: float
    video_bitrate: Optional[int] = None


# ─── Score breakdown ───────────────────────────────────────────────────────────

@dataclass(slots=True)
class ScoreBreakdown:
    sharpness: float = 0.0
    stability: float = 0.0
    exposure: float = 0.0
    composition: float = 0.0
    duration_score: float = 0.0
    visual_interest: float = 0.0
    diversity: float = 0.0
    # Transcription-specific
    speech_relevance: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "sharpness": round(self.sharpness, 1),
            "stability": round(self.stability, 1),
            "exposure": round(self.exposure, 1),
            "composition": round(self.composition, 1),
            "duration_score": round(self.duration_score, 1),
            "visual_interest": round(self.visual_interest, 1),
            "diversity": round(self.diversity, 1),
            "speech_relevance": round(self.speech_relevance, 1),
        }


# ─── Segment ───────────────────────────────────────────────────────────────────

@dataclass
class DerushSegment:
    id: str
    source_file_id: str
    source_in: float
    source_out: float
    duration: float
    analysis_mode: AnalysisMode
    # Set after scoring
    order: int = 0
    score: float = 0.0
    shot_type: ShotType = "unknown"
    # Transcription
    text: Optional[str] = None
    speaker: Optional[str] = None
    speech_tag: Optional[str] = None  # CONTENT | BANTER | BACKSTAGE | RETAKE
    # Vision
    keyframe_r2_keys: list[str] = field(default_factory=list)
    keyframe_urls: list[str] = field(default_factory=list)
    score_breakdown: Optional[ScoreBreakdown] = None
    # Local metrics (used during scoring, not serialized to output)
    _local_metrics: Optional["LocalMetrics"] = field(default=None, repr=False)
    # Common
    tags: list[str] = field(default_factory=list)
    is_rejected: bool = False
    reject_reason: Optional[RejectReason] = None
    exported_filename: Optional[str] = None
    # Sub-segment fields (set when this segment is a fragment of a rejected shot)
    parent_id: Optional[str] = None
    is_sub_segment: bool = False
    # Enrichment
    format_hints: list[str] = field(default_factory=list)  # detected/suggested formats
    visual_tags: Optional[dict[str, Any]] = None           # Gemini visual analysis output
    avg_confidence: Optional[float] = None                 # mean WhisperX word confidence
    text_raw: Optional[str] = None                         # original text before Gemini correction

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source_file_id": self.source_file_id,
            "source_in": round(self.source_in, 3),
            "source_out": round(self.source_out, 3),
            "duration": round(self.duration, 3),
            "order": self.order,
            "score": round(self.score, 1),
            "shot_type": self.shot_type,
            "analysis_mode": self.analysis_mode,
            "text": self.text,
            "speaker": self.speaker,
            "speech_tag": self.speech_tag,
            "keyframe_r2_keys": self.keyframe_r2_keys,
            "keyframe_urls": self.keyframe_urls,
            "score_breakdown": self.score_breakdown.to_dict() if self.score_breakdown else None,
            "tags": self.tags,
            "is_rejected": self.is_rejected,
            "reject_reason": self.reject_reason,
            "exported_filename": self.exported_filename,
            "parent_id": self.parent_id,
            "is_sub_segment": self.is_sub_segment,
            "format_hints": self.format_hints,
            "visual_tags": self.visual_tags,
            "avg_confidence": round(self.avg_confidence, 3) if self.avg_confidence is not None else None,
            "text_raw": self.text_raw,
        }


# ─── Local metrics (internal, vision pipeline) ────────────────────────────────

@dataclass(slots=True)
class LocalMetrics:
    """Raw metrics computed by OpenCV. Scores are 0-100."""
    sharpness_raw: float = 0.0     # Laplacian variance
    sharpness_score: float = 0.0
    stability_score: float = 0.0   # 100 - shake_intensity
    exposure_score: float = 0.0    # histogramme luminance
    composition_score: float = 0.0 # edge density + rule-of-thirds
    motion_type: str = "unknown"   # static | pan | tilt | shake | complex
    dhash: Optional[str] = None    # perceptual hash for dedup
    duration_score: float = 0.0


# ─── Vision provider result ────────────────────────────────────────────────────

@dataclass(slots=True)
class VisionProviderResult:
    provider: str
    score_override: Optional[float] = None   # 0-100, overrides heuristic if set
    shot_type_override: Optional[ShotType] = None
    description: Optional[str] = None
    extra_tags: list[str] = field(default_factory=list)
    raw_response: Optional[dict[str, Any]] = None
    visual_tags: Optional[dict[str, Any]] = None  # structured Gemini output

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "score_override": self.score_override,
            "shot_type_override": self.shot_type_override,
            "description": self.description,
            "extra_tags": self.extra_tags,
            "visual_tags": self.visual_tags,
        }


# ─── Job input (from RunPod payload) ──────────────────────────────────────────

@dataclass(slots=True)
class DerushJobInput:
    job_id: str
    analysis_mode: AnalysisMode
    output_prefix: str            # R2 prefix for all outputs
    # Vision
    video_urls: list[str] = field(default_factory=list)   # presigned or public R2 URLs
    video_r2_keys: list[str] = field(default_factory=list)
    video_filenames: list[str] = field(default_factory=list)
    vision_provider: str = "heuristic"
    vision_provider_config: dict[str, Any] = field(default_factory=dict)
    preset_config: Optional[DerushPresetConfig] = None
    # Transcription
    transcription_output_url: Optional[str] = None  # URL to existing segments.json
    transcription_language: str = "fr"
    transcription_model: str = "turbo"
    enable_diarization: bool = False
    # Enrichment / AI providers
    format_hint: Optional[str] = None    # caller hint: "podcast", "qa", "immobilier"…
    format_config: dict[str, Any] = field(default_factory=dict)  # {silence_threshold, export_mode}
    gemini_api_key: Optional[str] = None # enables Gemini speech + vision analysis

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DerushJobInput":
        preset_data = d.get("preset_config")
        preset = DerushPresetConfig.from_dict(preset_data) if preset_data else None
        # Gemini API key: payload takes precedence, fallback to env var
        gemini_api_key = d.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY") or None
        return cls(
            job_id=d["job_id"],
            analysis_mode=d.get("analysis_mode", "vision"),
            output_prefix=d.get("output_prefix", f"derush/{d['job_id']}"),
            video_urls=d.get("video_urls", []),
            video_r2_keys=d.get("video_r2_keys", []),
            video_filenames=d.get("video_filenames", []),
            vision_provider=d.get("vision_provider", "heuristic"),
            vision_provider_config=d.get("vision_provider_config", {}),
            preset_config=preset,
            transcription_output_url=d.get("transcription_output_url"),
            transcription_language=d.get("transcription_language", "fr"),
            transcription_model=d.get("transcription_model", "turbo"),
            enable_diarization=d.get("enable_diarization", False),
            format_hint=d.get("format_hint"),
            format_config=d.get("format_config") or {},
            gemini_api_key=gemini_api_key,
        )


# ─── Export input (from RunPod payload) ───────────────────────────────────────

@dataclass(slots=True)
class DerushExportInput:
    job_id: str
    export_id: str
    video_urls: list[str]         # source video URLs (same order as source_files in manifest)
    segments_url: str             # URL to analysed segments.json
    source_files_meta: list[dict[str, Any]]  # [{id, filename, r2_key, ...}]
    export_format: str
    output_prefix: str
    workflow: str = "capcut"
    accurate_trim: bool = False
    combo_formats: list[str] = field(default_factory=list)
    xml_format: str = "fcpxml"     # "fcpxml" | "premiere_xml"
    segment_ids: Optional[list[str]] = None  # None = all selected

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DerushExportInput":
        return cls(
            job_id=d["job_id"],
            export_id=d["export_id"],
            video_urls=d["video_urls"],
            segments_url=d["segments_url"],
            source_files_meta=d["source_files_meta"],
            export_format=d["export_format"],
            output_prefix=d.get("output_prefix", f"derush/{d['job_id']}/export/{d['export_id']}"),
            workflow=d.get("workflow", "capcut"),
            accurate_trim=d.get("accurate_trim", False),
            combo_formats=d.get("combo_formats", []),
            xml_format=d.get("xml_format", "fcpxml"),
            segment_ids=d.get("segment_ids"),
        )


# ─── Export result ─────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ExportResult:
    export_format: str
    output_key: str       # R2 key for the exported ZIP / manifest / XML
    exported_count: int
    encoding_mode: str    # "stream_copy" | "re_encode"
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "export_format": self.export_format,
            "output_key": self.output_key,
            "exported_count": self.exported_count,
            "encoding_mode": self.encoding_mode,
            "error": self.error,
        }

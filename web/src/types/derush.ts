// ─── Analysis pipeline ────────────────────────────────────────────────────────

export type DerushAnalysisMode = "transcription" | "vision";

export type DerushStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type DerushShotType = "wide" | "medium" | "close" | "insert" | "unknown";

export type DerushRejectReason =
  | "too_short"
  | "blurry"
  | "shake"
  | "duplicate"
  | "occlusion"
  | "start_stop"
  | "overexposed"
  | "underexposed"
  | "black_frame"
  // Transcription-specific
  | "backstage"
  | "hesitant"
  | "low_confidence"
  | "duplicate_speech"
  // Manual override
  | "manual_override";

export type DerushTag =
  | "sharp"
  | "stable"
  | "good_exposure"
  | "good_composition"
  | "static_shot"
  | "camera_move"
  | "shake_detected"
  | "blur_detected"
  | "overexposed"
  | "underexposed"
  | "duplicate"
  | "start_stop"
  | "speech_content"
  | "speech_retake"
  | "speech_backstage"
  | "manual_override"
  | "text_corrected";

// ─── Unified segment result ────────────────────────────────────────────────────

export interface DerushScoreBreakdown {
  sharpness?: number;     // 0-100
  stability?: number;     // 0-100
  exposure?: number;      // 0-100
  composition?: number;   // 0-100
  duration_score?: number; // 0-100
  visual_interest?: number; // 0-100
  diversity?: number;     // 0-100
  // Transcription-specific
  speech_relevance?: number; // 0-100
}

export interface DerushSourceFileRef {
  id: string;        // "src_001"
  filename: string;
  r2_key: string;
  r2_public_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface DerushSegment {
  id: string;              // "seg_001"
  source_file_id: string;  // ref DerushSourceFileRef.id
  source_in: number;       // seconds
  source_out: number;      // seconds
  duration: number;        // source_out - source_in
  order: number;           // ranking (1 = best)
  score: number;           // 0-100
  shot_type?: DerushShotType;
  analysis_mode: DerushAnalysisMode;
  // Transcription fields
  text?: string;
  text_raw?: string;
  speaker?: string;
  speech_tag?: "CONTENT" | "BACKSTAGE" | "RETAKE";
  format_hints?: string[];
  avg_confidence?: number;
  // Vision fields
  visual_tags?: Record<string, unknown>;
  keyframe_r2_keys?: string[];
  keyframe_urls?: string[];
  score_breakdown?: DerushScoreBreakdown;
  // Common
  tags: DerushTag[];
  is_rejected: boolean;
  reject_reason?: DerushRejectReason;
  // Export state (set after export)
  exported_filename?: string;
  // Sub-segment fields
  parent_id?: string;
  is_sub_segment?: boolean;
}

// ─── Preset config ─────────────────────────────────────────────────────────────

export interface DerushScoringWeights {
  sharpness: number;
  stability: number;
  exposure: number;
  composition: number;
  duration_score: number;
  visual_interest: number;
  diversity: number;
}

export interface DerushRejectThresholds {
  min_duration: number;   // seconds, default 0.8
  min_sharpness: number;  // 0-100, default 15
  max_shake: number;      // 0-100, default 10 (lower = more rejected)
}

export interface DerushExportDefaults {
  format: DerushExportFormat;
  workflow: DerushWorkflow;
  accurate_trim: boolean;
}

export interface DerushPresetConfig {
  scoring_weights: DerushScoringWeights;
  reject_thresholds: DerushRejectThresholds;
  export_defaults: DerushExportDefaults;
  description?: string;
}

// Builtin preset names
export type DerushBuiltinPreset = "beauty" | "content_relevance" | "action" | "balanced";

// ─── Export ────────────────────────────────────────────────────────────────────

export type DerushExportFormat =
  | "clips_trimmed"
  | "xml_timeline"
  | "stringout_video"
  | "structured_folder"
  | "manifest_only"
  | "combo_export";

export type DerushWorkflow = "capcut" | "premiere" | "resolve" | "generic";

export interface DerushExportOptions {
  format: DerushExportFormat;
  workflow?: DerushWorkflow;
  accurate_trim?: boolean;        // default false (stream copy)
  combo_formats?: DerushExportFormat[];
  xml_format?: "fcpxml" | "premiere_xml"; // default "fcpxml"
  include_rejected?: boolean;     // include rejected shots in structured_folder
}

// ─── Manifest JSON ─────────────────────────────────────────────────────────────

export interface DerushManifestStats {
  total_segments: number;
  selected_segments: number;
  rejected_segments: number;
  total_selected_duration: number; // seconds
}

export interface DerushManifest {
  version: "1.0";
  project_id: string;
  exported_at: string;             // ISO8601
  source_files: DerushSourceFileRef[];
  analysis_mode: DerushAnalysisMode;
  export_format: DerushExportFormat;
  workflow?: DerushWorkflow;
  encoding_mode: "stream_copy" | "re_encode";
  stats: DerushManifestStats;
  segments: DerushSegment[];
}

// ─── API payloads ──────────────────────────────────────────────────────────────

export interface DerushJobCreatePayload {
  /** Filenames to upload — one presigned URL returned per file */
  files: { filename: string; ext: string; contentType: string }[];
  analysisMode: DerushAnalysisMode;
  presetId?: string;
  formatId?: string;
  enableDiarization?: boolean;
  visionProvider?: string;
  /** Reuse an existing TranscriptionJob (mode transcription only) */
  transcriptionJobId?: string;
  /** Upload a SRT/JSON file as transcription input */
  transcriptionInputFilename?: string;
  transcriptionInputExt?: string;
}

export interface DerushJobCreateResponse {
  jobId: string;
  /** Presigned URLs for each video file (index matches request.files) */
  uploadUrls: string[];
  /** Presigned URL for transcription SRT/JSON if requested */
  transcriptionUploadUrl?: string;
}

// ─── Format ────────────────────────────────────────────────────────────────────

export interface DerushFormat {
  id: string;
  name: string;
  slug: string;
  description: string;
  contextPrompt: string;
  silenceThreshold: number;
  exportMode: "individual" | "qa_pair";
  isBuiltin: boolean;
  userId: string | null;
  createdAt: string;
}

export interface DerushExportCreatePayload {
  exportFormat: DerushExportFormat;
  workflow?: DerushWorkflow;
  accurateTrim?: boolean;
  comboFormats?: DerushExportFormat[];
  xmlFormat?: "fcpxml" | "premiere_xml";
  /** Segment IDs to export (all selected if omitted) */
  segmentIds?: string[];
}

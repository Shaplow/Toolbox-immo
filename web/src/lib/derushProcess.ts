/**
 * Helpers client/serveur pour le module de dérush.
 *
 * Ces fonctions tournent dans Next.js (pas dans RunPod) :
 *   - buildManifest()          : construit un DerushManifest à partir d'un tableau de segments
 *   - generateXmlTimeline()    : génère FCPXML 1.9 ou Premiere xmeml côté serveur (sans FFmpeg)
 *   - scoreSummary()           : statistiques de score agrégées
 *   - applyPresetDefaults()    : fusionne un preset partiel avec les valeurs par défaut
 *   - formatTimecode()         : secondes → HH:MM:SS:FF (pour l'affichage UI)
 */

import type {
  DerushSegment,
  DerushManifest,
  DerushManifestStats,
  DerushSourceFileRef,
  DerushAnalysisMode,
  DerushExportFormat,
  DerushWorkflow,
  DerushPresetConfig,
  DerushScoringWeights,
  DerushRejectThresholds,
  DerushExportDefaults,
} from "@/types/derush";

// ─── Manifest ─────────────────────────────────────────────────────────────────

export function buildManifest(
  projectId: string,
  sourceFiles: DerushSourceFileRef[],
  segments: DerushSegment[],
  analysisMode: DerushAnalysisMode,
  exportFormat: DerushExportFormat,
  workflow: DerushWorkflow = "generic",
  encodingMode: "stream_copy" | "re_encode" = "stream_copy"
): DerushManifest {
  const selected = segments.filter((s) => !s.is_rejected);
  const stats: DerushManifestStats = {
    total_segments: segments.length,
    selected_segments: selected.length,
    rejected_segments: segments.length - selected.length,
    total_selected_duration: selected.reduce((acc, s) => acc + s.duration, 0),
  };
  return {
    version: "1.0",
    project_id: projectId,
    exported_at: new Date().toISOString(),
    source_files: sourceFiles,
    analysis_mode: analysisMode,
    export_format: exportFormat,
    workflow,
    encoding_mode: encodingMode,
    stats,
    segments,
  };
}

// ─── Score summary ─────────────────────────────────────────────────────────────

export interface DerushScoreSummary {
  avgScore: number;
  minScore: number;
  maxScore: number;
  selectedCount: number;
  rejectedCount: number;
  totalDuration: number;
  selectedDuration: number;
  rejectionReasons: Record<string, number>;
}

export function scoreSummary(segments: DerushSegment[]): DerushScoreSummary {
  const selected = segments.filter((s) => !s.is_rejected);
  const rejected = segments.filter((s) => s.is_rejected);

  const scores = selected.map((s) => s.score);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;
  const maxScore = scores.length ? Math.max(...scores) : 0;

  const rejectionReasons: Record<string, number> = {};
  for (const seg of rejected) {
    if (seg.reject_reason) {
      rejectionReasons[seg.reject_reason] = (rejectionReasons[seg.reject_reason] ?? 0) + 1;
    }
  }

  return {
    avgScore: Math.round(avgScore * 10) / 10,
    minScore: Math.round(minScore * 10) / 10,
    maxScore: Math.round(maxScore * 10) / 10,
    selectedCount: selected.length,
    rejectedCount: rejected.length,
    totalDuration: segments.reduce((a, s) => a + s.duration, 0),
    selectedDuration: selected.reduce((a, s) => a + s.duration, 0),
    rejectionReasons,
  };
}

// ─── Preset defaults ──────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: DerushScoringWeights = {
  sharpness: 0.25,
  stability: 0.20,
  exposure: 0.15,
  composition: 0.15,
  duration_score: 0.10,
  visual_interest: 0.10,
  diversity: 0.05,
};

const DEFAULT_THRESHOLDS: DerushRejectThresholds = {
  min_duration: 0.8,
  min_sharpness: 15,
  max_shake: 10,
};

const DEFAULT_EXPORT_DEFAULTS: DerushExportDefaults = {
  format: "clips_trimmed",
  workflow: "capcut",
  accurate_trim: false,
};

export function applyPresetDefaults(partial?: Partial<DerushPresetConfig>): DerushPresetConfig {
  return {
    scoring_weights: { ...DEFAULT_WEIGHTS, ...(partial?.scoring_weights ?? {}) },
    reject_thresholds: { ...DEFAULT_THRESHOLDS, ...(partial?.reject_thresholds ?? {}) },
    export_defaults: { ...DEFAULT_EXPORT_DEFAULTS, ...(partial?.export_defaults ?? {}) },
    description: partial?.description,
  };
}

// ─── Timecode format ──────────────────────────────────────────────────────────

/**
 * secondes (float) → "HH:MM:SS:FF" (affichage UI, non-drop frame)
 */
export function formatTimecode(seconds: number, fps = 25): string {
  const totalFrames = Math.round(seconds * fps);
  const frames = totalFrames % fps;
  const totalSecs = Math.floor(totalFrames / fps);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60) % 60;
  const hrs = Math.floor(totalSecs / 3600);
  return [
    String(hrs).padStart(2, "0"),
    String(mins).padStart(2, "0"),
    String(secs).padStart(2, "0"),
    String(frames).padStart(2, "0"),
  ].join(":");
}

/**
 * secondes → "HH:MM:SS.mmm" (pour l'affichage dans les timelines)
 */
export function formatTime(seconds: number): string {
  const ms = Math.round((seconds % 1) * 1000);
  const totalSecs = Math.floor(seconds);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60) % 60;
  const hrs = Math.floor(totalSecs / 3600);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ─── FCPXML 1.9 (server-side, no FFmpeg) ──────────────────────────────────────

/**
 * Génère un FCPXML 1.9 (ou Premiere xmeml selon `format`)
 * entièrement côté Next.js — aucun FFmpeg nécessaire.
 *
 * Source files doivent avoir `r2_public_url` renseigné.
 */
export function generateXmlTimeline(
  manifest: DerushManifest,
  format: "fcpxml" | "premiere_xml" = "fcpxml"
): string {
  if (format === "premiere_xml") {
    return _generatePremiereXml(manifest);
  }
  return _generateFcpxml(manifest);
}

// ── FCPXML 1.9 ────────────────────────────────────────────────────────────────

function rationalTime(seconds: number, fps: number): string {
  const num = Math.round(seconds * fps);
  return `${num}/${fps}s`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function reducedFraction(numerator: number, denominator: number): [number, number] {
  const g = gcd(Math.abs(numerator), Math.abs(denominator));
  return [numerator / g, denominator / g];
}

function _generateFcpxml(manifest: DerushManifest): string {
  const selected = manifest.segments
    .filter((s) => !s.is_rejected)
    .sort((a, b) => a.order - b.order);

  const sourceMap = new Map(manifest.source_files.map((f) => [f.id, f]));

  // Use the fps of the first source file or fall back to 25
  const fps = manifest.source_files[0]?.fps ?? 25;
  const [fpNum, fpDen] = reducedFraction(Math.round(fps * 1000), 1000);

  // Build assets XML
  const assetsXml = manifest.source_files
    .map((f, idx) => {
      const url = f.r2_public_url ?? "";
      const dur = f.duration ?? 0;
      return `    <asset id="r${idx + 1}" name="${_escapeXml(f.filename)}" uid="${f.id}" start="0s" duration="${rationalTime(dur, fpNum)}" hasVideo="1" hasAudio="1">
      <media-rep kind="original-media" src="${_escapeXml(url)}" />
    </asset>`;
    })
    .join("\n");

  // Build clip sequence
  let offset = 0;
  const clipsXml = selected
    .map((seg) => {
      const src = sourceMap.get(seg.source_file_id);
      const srcIdx = manifest.source_files.findIndex((f) => f.id === seg.source_file_id);
      const assetRef = `r${srcIdx + 1}`;
      const clipName = _segmentName(seg, src?.filename ?? "clip");
      const dur = seg.duration;
      const clipXml = `        <clip name="${_escapeXml(clipName)}" ref="${assetRef}" offset="${rationalTime(offset, fpNum)}" start="${rationalTime(seg.source_in, fpNum)}" duration="${rationalTime(dur, fpNum)}" />`;
      offset += dur;
      return clipXml;
    })
    .join("\n");

  const totalDuration = rationalTime(offset, fpNum);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r0" name="FFVideoFormat${Math.round(fps)}p" frameDuration="${fpDen}/${fpNum}s" />
${assetsXml}
  </resources>
  <library>
    <event name="Derush Export">
      <project name="Derush_${manifest.project_id}">
        <sequence format="r0" duration="${totalDuration}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${clipsXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

// ── Premiere xmeml ────────────────────────────────────────────────────────────

function _generatePremiereXml(manifest: DerushManifest): string {
  const selected = manifest.segments
    .filter((s) => !s.is_rejected)
    .sort((a, b) => a.order - b.order);

  const sourceMap = new Map(manifest.source_files.map((f) => [f.id, f]));
  const fps = manifest.source_files[0]?.fps ?? 25;

  const toFrames = (secs: number) => Math.round(secs * fps);

  const clipsXml = selected
    .map((seg) => {
      const src = sourceMap.get(seg.source_file_id);
      const clipName = _segmentName(seg, src?.filename ?? "clip");
      const url = src?.r2_public_url ?? "";
      return `    <clipitem>
      <name>${_escapeXml(clipName)}</name>
      <masterclipid>${seg.source_file_id}</masterclipid>
      <in>${toFrames(seg.source_in)}</in>
      <out>${toFrames(seg.source_out)}</out>
      <start>auto</start>
      <end>auto</end>
      <file id="${seg.source_file_id}">
        <name>${_escapeXml(src?.filename ?? "")}</name>
        <pathurl>${_escapeXml(url)}</pathurl>
        <rate><timebase>${Math.round(fps)}</timebase><ntsc>FALSE</ntsc></rate>
      </file>
    </clipitem>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>Derush_${manifest.project_id}</name>
    <rate><timebase>${Math.round(fps)}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <track>
${clipsXml}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;
}

// ─── Utils ─────────────────────────────────────────────────────────────────────

function _escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function _segmentName(seg: DerushSegment, sourceFilename: string): string {
  const base = sourceFilename.replace(/\.[^.]+$/, "");
  const inStr = formatTime(seg.source_in).replace(/[:.]/g, "-");
  const outStr = formatTime(seg.source_out).replace(/[:.]/g, "-");
  const score = Math.round(seg.score);
  return `${String(seg.order).padStart(3, "0")}_${base}_${inStr}_${outStr}_${score}pts`;
}

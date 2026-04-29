"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle, XCircle, Loader2, Clock,
  Download, Film, RefreshCw, Scissors, Star, ChevronDown,
  ThumbsUp, ThumbsDown, Pencil,
} from "lucide-react";
import type { DerushSegment, DerushExportFormat, DerushWorkflow, DerushScoreBreakdown } from "@/types/derush";
import { useJobPolling } from "@/lib/hooks/useJobPolling";
import { useJobEvent } from "@/lib/hooks/jobEventBus";

type JobDetail = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  analysisMode: "vision" | "transcription";
  visionProvider: string;
  presetId: string | null;
  presetName: string | null;
  fileCount: number;
  segmentCount: number | null;
  selectedCount?: number | null;
  totalDuration: number | null;
  hasOutput: boolean;
  errorMsg: string | null;
  createdAt: string;
};

type ExportRecord = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  exportFormat: DerushExportFormat;
  workflow: string | null;
  accurateTrim: boolean;
  outputKey: string | null;
  outputFilename: string | null;
  runpodJobId: string | null;
  errorMsg: string | null;
  createdAt: string;
};

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    return `${h}h ${String(m % 60).padStart(2, "0")}min`;
  }
  return `${m}min ${String(s).padStart(2, "0")}s`;
}

const EXPORT_LABELS: Record<DerushExportFormat, string> = {
  clips_trimmed: "Clips découpés (ZIP)",
  xml_timeline: "Timeline XML (FCPXML / Premiere)",
  stringout_video: "Stringout vidéo",
  structured_folder: "Dossier structuré (ZIP)",
  manifest_only: "Manifest JSON",
  combo_export: "Export combiné",
};

const WORKFLOW_LABELS: Record<string, string> = {
  capcut: "CapCut",
  premiere: "Premiere Pro",
  resolve: "DaVinci Resolve",
  generic: "Générique",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  QUEUED:     <Clock className="w-4 h-4 text-gray-400" />,
  PROCESSING: <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />,
  COMPLETED:  <CheckCircle className="w-4 h-4 text-green-500" />,
  FAILED:     <XCircle className="w-4 h-4 text-red-500" />,
};

export function DerushDetail({ job: initialJob }: { job: JobDetail }) {
  const [job, setJob] = useState(initialJob);
  const [segments, setSegments] = useState<DerushSegment[] | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);

  // Export form state
  const [exportFormat, setExportFormat]   = useState<DerushExportFormat>("clips_trimmed");
  const [workflow, setWorkflow]           = useState<DerushWorkflow>("capcut");
  const [accurateTrim, setAccurateTrim]   = useState(false);
  const [xmlFormat, setXmlFormat]         = useState<"fcpxml" | "premiere_xml">("fcpxml");
  const [comboFormats, setComboFormats]   = useState<DerushExportFormat[]>(["clips_trimmed", "xml_timeline"]);
  const [creatingExport, setCreatingExport] = useState(false);
  const [exportError, setExportError]     = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/derush/${job.id}`);
      if (!res.ok) return;
      const data = await res.json() as JobDetail;
      setJob(data);
    } catch { /* ignore */ }
  }, [job.id]);

  // Polling fallback (5 s interval, stops automatically on terminal state)
  const { data: pollData } = useJobPolling<JobDetail>({
    fetchFn: () => fetch(`/api/derush/${job.id}`).then((r) => r.json()),
    isTerminal: (d) => d.status === "COMPLETED" || d.status === "FAILED",
    intervalMs: 5000,
    enabled: job.status !== "COMPLETED" && job.status !== "FAILED",
  });
  useEffect(() => {
    if (pollData) setJob(pollData);
  }, [pollData]);

  // SSE fast path — immediate update when webhook fires
  const jobEvent = useJobEvent(job.id);
  useEffect(() => {
    if (!jobEvent || jobEvent.jobType !== "derush") return;
    setJob((prev) => ({
      ...prev,
      status: jobEvent.status as JobDetail["status"],
      ...(typeof jobEvent.segmentCount === "number" ? { segmentCount: jobEvent.segmentCount } : {}),
      ...(typeof jobEvent.totalDuration === "number" ? { totalDuration: jobEvent.totalDuration } : {}),
    }));
  }, [jobEvent]);

  // Load segments once COMPLETED
  useEffect(() => {
    if (job.status !== "COMPLETED" || !job.hasOutput || segments !== null) return;
    setLoadingSegments(true);
    fetch(`/api/derush/${job.id}/result`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { segments?: DerushSegment[] } | DerushSegment[]) => {
        const segs = Array.isArray(data) ? data : (data.segments ?? []);
        setSegments(segs);
      })
      .catch((err: unknown) => setSegmentsError(String(err instanceof Error ? err.message : err)))
      .finally(() => setLoadingSegments(false));
  }, [job.status, job.hasOutput, job.id, segments]);

  // Load exports list
  const loadExports = useCallback(async () => {
    try {
      const res = await fetch(`/api/derush/${job.id}/export`);
      if (res.ok) setExports(await res.json() as ExportRecord[]);
    } catch { /* ignore */ }
  }, [job.id]);

  useEffect(() => {
    if (job.status === "COMPLETED") void loadExports();
  }, [job.status, loadExports]);

  const createExport = useCallback(async () => {
    setExportError(null);
    setCreatingExport(true);
    try {
      const body = {
        exportFormat,
        workflow,
        accurateTrim,
        ...(exportFormat === "xml_timeline" || exportFormat === "combo_export" ? { xmlFormat } : {}),
        ...(exportFormat === "combo_export" ? { comboFormats } : {}),
      };
      const res = await fetch(`/api/derush/${job.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as ExportRecord & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);

      const newExport = data;

      // If not yet completed (RunPod needed), submit immediately
      if (newExport.status === "QUEUED") {
        const submitRes = await fetch(`/api/derush/${job.id}/export/${newExport.id}/submit`, { method: "POST" });
        if (!submitRes.ok) {
          const err = await submitRes.json() as { error?: string };
          throw new Error(err.error ?? `Erreur submit ${submitRes.status}`);
        }
      }

      await loadExports();
    } catch (err) {
      setExportError(String(err instanceof Error ? err.message : err));
    } finally {
      setCreatingExport(false);
    }
  }, [exportFormat, workflow, accurateTrim, job.id, loadExports]);

  const pollExport = useCallback(async (eid: string) => {
    const res = await fetch(`/api/derush/${job.id}/export/${eid}`);
    if (!res.ok) return;
    const data = await res.json() as ExportRecord;
    setExports((prev) => prev.map((e) => (e.id === eid ? data : e)));
  }, [job.id]);

  const editText = useCallback(async (segmentId: string, text: string) => {
    // Optimistic update
    setSegments((prev) =>
      prev?.map((s) => s.id === segmentId ? { ...s, text } : s) ?? null
    );
    await fetch(`/api/derush/${job.id}/segments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId, action: "edit_text", text }),
    });
  }, [job.id]);

  const toggleSegment = useCallback(async (segmentId: string, action: "accept" | "reject") => {
    // Optimistic update
    setSegments((prev) =>
      prev?.map((s) =>
        s.id === segmentId
          ? {
              ...s,
              is_rejected: action === "reject",
              reject_reason: action === "reject" ? ("manual_override" as DerushSegment["reject_reason"]) : undefined,
              tags: action === "accept"
                ? [...s.tags.filter((t) => t !== "manual_override"), "manual_override" as typeof s.tags[0]]
                : s.tags,
            }
          : s
      ) ?? null
    );
    try {
      await fetch(`/api/derush/${job.id}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentId, action }),
      });
    } catch {
      // Revert on error by reloading
      setSegments(null);
    }
  }, [job.id]);

  const selectedSegments = segments?.filter((s) => !s.is_rejected && !s.is_sub_segment) ?? [];
  const rejectedSegments = segments?.filter((s) => s.is_rejected) ?? [];
  // Fragments recovered from rejected shots (grouped by parent_id)
  const fragmentsByParent = (segments ?? []).reduce<Record<string, DerushSegment[]>>((acc, s) => {
    if (!s.is_rejected && s.is_sub_segment && s.parent_id) {
      if (!acc[s.parent_id]) acc[s.parent_id] = [];
      acc[s.parent_id].push(s);
    }
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/tools/derush"
          className="mt-0.5 p-2 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">
              Dérush ·{" "}
              <span className="text-gray-500">
                {job.fileCount} fichier{job.fileCount > 1 ? "s" : ""}
              </span>
            </h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              job.status === "COMPLETED" ? "bg-green-100 text-green-700"
              : job.status === "FAILED"   ? "bg-red-100 text-red-700"
              : job.status === "PROCESSING" ? "bg-indigo-100 text-indigo-700"
              : "bg-gray-100 text-gray-600"
            }`}>
              {job.status === "PROCESSING" ? "En cours" : job.status === "QUEUED" ? "En attente" : job.status === "COMPLETED" ? "Terminé" : "Échec"}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">
            {job.analysisMode === "vision" ? "Vision IA" : "Transcription"}
            {job.presetName && ` · Preset: ${job.presetName}`}
            {" · "} {new Date(job.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        {(job.status === "QUEUED" || job.status === "PROCESSING") && (
          <button
            type="button"
            onClick={() => void poll()}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
            title="Actualiser"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status card */}
      {job.status !== "COMPLETED" && (
        <div className={`rounded-2xl border p-6 flex items-center gap-4 ${
          job.status === "FAILED" ? "border-red-200 bg-red-50"
          : job.status === "PROCESSING" ? "border-indigo-100 bg-indigo-50"
          : "border-gray-100 bg-gray-50"
        }`}>
          {STATUS_ICON[job.status]}
          <div>
            {job.status === "PROCESSING" && (
              <>
                <p className="font-medium text-indigo-700 text-sm">Analyse en cours…</p>
                <p className="text-xs text-indigo-500 mt-0.5">Le résultat sera disponible dans quelques minutes.</p>
              </>
            )}
            {job.status === "QUEUED" && (
              <>
                <p className="font-medium text-gray-700 text-sm">En attente de traitement</p>
                <p className="text-xs text-gray-500 mt-0.5">Le job démarrera sous peu.</p>
              </>
            )}
            {job.status === "FAILED" && (
              <>
                <p className="font-medium text-red-700 text-sm">Analyse échouée</p>
                {job.errorMsg && <p className="text-xs text-red-500 mt-0.5">{job.errorMsg}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Results summary */}
      {job.status === "COMPLETED" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{job.segmentCount ?? "—"}</p>
            <p className="text-xs text-gray-400 mt-0.5">Segments analysés</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-center">
            <p className="text-2xl font-bold text-green-700">
              {selectedSegments.length
                ? <>
                    {selectedSegments.length}
                    {Object.values(fragmentsByParent).flat().length > 0 && (
                      <span className="text-sm font-normal text-orange-500 ml-1">
                        +{Object.values(fragmentsByParent).flat().length}
                      </span>
                    )}
                  </>
                : "—"}
            </p>
            <p className="text-xs text-green-600 mt-0.5">Sélectionnés</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{fmtDuration(job.totalDuration)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Durée totale</p>
          </div>
        </div>
      )}

      {/* Segments list */}
      {job.status === "COMPLETED" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Segments sélectionnés</p>
            {loadingSegments && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>

          {segmentsError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {segmentsError}
            </div>
          )}

          {segments === null && !loadingSegments && !segmentsError && (
            <p className="text-sm text-gray-400">Chargement…</p>
          )}

          {selectedSegments.length > 0 && (
            <ul className="space-y-1.5">
              {selectedSegments.map((seg) => (
                <SegmentRow key={seg.id} seg={seg} onToggle={toggleSegment} onEditText={editText} />
              ))}
              {/* Fragments from rejected shots — sorted by score */}
              {Object.values(fragmentsByParent).flat().sort((a, b) => b.score - a.score).map((frag) => (
                <li key={frag.id} className="pl-4 border-l-2 border-orange-200">
                  <SegmentRow seg={frag} onToggle={toggleSegment} onEditText={editText} />
                </li>
              ))}
            </ul>
          )}

          {rejectedSegments.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 select-none">
                ▾ {rejectedSegments.length} segment{rejectedSegments.length > 1 ? "s" : ""} rejeté{rejectedSegments.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-1.5 space-y-2">
                {rejectedSegments.map((seg) => {
                  const frags = fragmentsByParent[seg.id] ?? [];
                  return (
                    <li key={seg.id}>
                      <div className="opacity-60">
                        <SegmentRow seg={seg} onToggle={toggleSegment} onEditText={editText} />
                      </div>
                      {frags.length > 0 && (
                        <div className="ml-6 mt-1.5 space-y-1.5">
                          <p className="text-[10px] text-orange-500 font-medium flex items-center gap-1">
                            <Scissors className="w-3 h-3" />
                            {frags.length} fragment{frags.length > 1 ? "s" : ""} récupéré{frags.length > 1 ? "s" : ""}
                          </p>
                          {frags.map((frag) => (
                            <SegmentRow key={frag.id} seg={frag} onToggle={toggleSegment} onEditText={editText} />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Export section */}
      {job.status === "COMPLETED" && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-gray-700">Exporter</p>

          <div className="bg-gray-50 rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Format</label>
                <div className="relative">
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as DerushExportFormat)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {Object.entries(EXPORT_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Workflow cible</label>
                <div className="relative">
                  <select
                    value={workflow}
                    onChange={(e) => setWorkflow(e.target.value as DerushWorkflow)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {Object.entries(WORKFLOW_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* xmlFormat — visible pour xml_timeline et combo_export */}
            {(exportFormat === "xml_timeline" || exportFormat === "combo_export") && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Format XML</label>
                <div className="flex gap-2">
                  {(["fcpxml", "premiere_xml"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setXmlFormat(fmt)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        xmlFormat === fmt
                          ? "border-violet-500 bg-violet-50 text-violet-700"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {fmt === "fcpxml" ? "FCPXML (Final Cut)" : "XML Premiere Pro"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* comboFormats — visible pour combo_export */}
            {exportFormat === "combo_export" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Formats inclus dans le combo</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(EXPORT_LABELS) as DerushExportFormat[])
                    .filter((f) => f !== "combo_export")
                    .map((f) => (
                      <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={comboFormats.includes(f)}
                          onChange={(e) => setComboFormats((prev) =>
                            e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)
                          )}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-xs text-gray-700">{EXPORT_LABELS[f]}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={accurateTrim}
                onChange={(e) => setAccurateTrim(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm text-gray-700">
                Découpe précise
                <span className="ml-1.5 text-gray-400 text-xs">(re-encode — plus lent, meilleur pour timeline pro)</span>
              </span>
            </label>

            {exportError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {exportError}
              </div>
            )}

            {(() => {
              const totalSelected = selectedSegments.length + Object.values(fragmentsByParent).flat().length;
              const noSegments = segments !== null && totalSelected === 0;
              return (
                <>
                  {noSegments && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Aucun segment sélectionné — l&apos;export n&apos;est pas possible.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void createExport()}
                    disabled={creatingExport || noSegments || (exportFormat === "combo_export" && comboFormats.length === 0)}
                    className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {creatingExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                    Générer l&apos;export
                  </button>
                </>
              );
            })()}
          </div>

          {/* Existing exports */}
          {exports.length > 0 && (
            <ul className="space-y-2">
              {exports.map((exp) => (
                <ExportRow
                  key={exp.id}
                  exp={exp}
                  jobId={job.id}
                  onPoll={() => void pollExport(exp.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Segment row ───────────────────────────────────────────────────────────────

const SHOT_TYPE_LABEL: Record<string, string> = {
  wide: "Plan large", medium: "Plan moyen", close: "Gros plan", insert: "Insert", unknown: "",
};

const SPEECH_TAG_LABEL: Record<string, string> = {
  CONTENT: "Contenu", BANTER: "Banter", BACKSTAGE: "Backstage", RETAKE: "Retake",
};

const SPEECH_TAG_COLOR: Record<string, string> = {
  CONTENT: "bg-green-100 text-green-700",
  BANTER: "bg-yellow-100 text-yellow-700",
  BACKSTAGE: "bg-gray-100 text-gray-600",
  RETAKE: "bg-red-100 text-red-600",
};

function ScoreBar({ label, value }: { label: string; value?: number }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value);
  const color = pct >= 70 ? "bg-green-400" : pct >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right">{pct}</span>
    </div>
  );
}

function SegmentRow({
  seg,
  onToggle,
  onEditText,
}: {
  seg: DerushSegment;
  onToggle: (id: string, action: "accept" | "reject") => void;
  onEditText: (id: string, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draftText, setDraftText] = useState(seg.text ?? "");
  const inStr  = fmtSec(seg.source_in);
  const outStr = fmtSec(seg.source_out);
  const score  = Math.round(seg.score);
  const scoreColor = score >= 70 ? "text-green-600" : score >= 40 ? "text-yellow-600" : "text-red-500";
  const bd: DerushScoreBreakdown | undefined = seg.score_breakdown;
  const isManual = seg.tags.includes("manual_override" as typeof seg.tags[0]);

  const handleToggle = (e: React.MouseEvent, action: "accept" | "reject") => {
    e.stopPropagation();
    setToggling(true);
    onToggle(seg.id, action);
    // Brief visual feedback
    setTimeout(() => setToggling(false), 600);
  };

  return (
    <li className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-stretch">
        <button
          type="button"
          className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50/50 transition-colors min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          <Film className="w-4 h-4 text-gray-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800 truncate">
              {seg.text
                ? <span className="text-gray-700">&ldquo;{seg.text.slice(0, 90)}{seg.text.length > 90 ? "…" : ""}&rdquo;</span>
                : <span className="text-gray-500">{SHOT_TYPE_LABEL[seg.shot_type ?? ""] || seg.shot_type || "plan"}</span>
              }
            </p>
            <p className="text-xs text-gray-400">
              {seg.source_file_id && <span className="mr-1.5 text-gray-300">{seg.source_file_id}</span>}
              {inStr} → {outStr} · {fmtDuration(seg.duration)}
              {seg.speaker && <span className="ml-1.5 text-indigo-500">👤 {seg.speaker}</span>}
              {seg.reject_reason && seg.reject_reason !== "manual_override" && (
                <span className="ml-1.5 text-red-400">· {seg.reject_reason}</span>
              )}
              {isManual && <span className="ml-1.5 text-violet-400">· modifié manuellement</span>}
            </p>
          </div>

          {/* Speech tag badge */}
          {seg.speech_tag && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${SPEECH_TAG_COLOR[seg.speech_tag] ?? "bg-gray-100 text-gray-600"}`}>
              {SPEECH_TAG_LABEL[seg.speech_tag] ?? seg.speech_tag}
            </span>
          )}

          {/* Score */}
          <div className={`flex items-center gap-1 shrink-0 ${scoreColor}`}>
            <Star className="w-3 h-3" />
            <span className="text-xs font-medium">{score}</span>
          </div>
          <span className="text-xs text-gray-300">#{seg.order}</span>
        </button>

        {/* Toggle button */}
        {toggling ? (
          <div className="flex items-center px-3 border-l border-gray-100">
            <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
          </div>
        ) : seg.is_rejected ? (
          <button
            type="button"
            title="Remettre dans la sélection"
            onClick={(e) => handleToggle(e, "accept")}
            className="flex items-center px-3 border-l border-gray-100 text-gray-300 hover:text-green-500 hover:bg-green-50 transition-colors"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            title="Exclure ce segment"
            onClick={(e) => handleToggle(e, "reject")}
            className="flex items-center px-3 border-l border-gray-100 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Expanded: text editor (for transcription segments) + score breakdown */}
      {expanded && seg.text !== undefined && (
        <div className="px-4 pt-2 pb-1 border-t border-gray-50">
          {editMode ? (
            <div className="space-y-1.5">
              <textarea
                className="w-full text-sm text-gray-700 border border-indigo-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                rows={Math.max(2, Math.ceil((draftText.length) / 80))}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onEditText(seg.id, draftText);
                    setEditMode(false);
                  }}
                  className="text-xs px-3 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => { setDraftText(seg.text ?? ""); setEditMode(false); }}
                  className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                {draftText !== (seg.text ?? "") && (
                  <button
                    type="button"
                    onClick={() => { setDraftText(seg.text ?? ""); onEditText(seg.id, ""); setEditMode(false); }}
                    className="text-xs px-3 py-1 rounded-lg text-red-400 hover:bg-red-50 transition-colors ml-auto"
                  >
                    Restaurer original
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="group flex items-start gap-2">
              <div className="flex-1 space-y-0.5">
                <p className="text-sm text-gray-600 leading-relaxed">{seg.text}</p>
                {seg.text_raw && seg.text_raw !== seg.text && (
                  <p className="text-xs text-gray-400 italic">
                    Original : &laquo;&nbsp;{seg.text_raw}&nbsp;&raquo;
                  </p>
                )}
              </div>
              <button
                type="button"
                title="Modifier le texte"
                onClick={() => { setDraftText(seg.text ?? ""); setEditMode(true); }}
                className="shrink-0 mt-0.5 text-gray-300 hover:text-indigo-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
      {expanded && bd && (
        <div className="px-4 pb-3 space-y-1 border-t border-gray-50">
          <ScoreBar label="Netteté"     value={bd.sharpness} />
          <ScoreBar label="Stabilité"   value={bd.stability} />
          <ScoreBar label="Exposition"  value={bd.exposure} />
          <ScoreBar label="Composition" value={bd.composition} />
          <ScoreBar label="Durée"       value={bd.duration_score} />
          <ScoreBar label="Intérêt"     value={bd.visual_interest} />
          <ScoreBar label="Diversité"   value={bd.diversity} />
          <ScoreBar label="Discours"    value={bd.speech_relevance} />
          {seg.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {seg.tags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ─── Export row ───────────────────────────────────────────────────────────────

function ExportRow({
  exp, jobId, onPoll,
}: {
  exp: ExportRecord;
  jobId: string;
  onPoll: () => void;
}) {
  // Poll if processing
  useEffect(() => {
    if (exp.status !== "PROCESSING" && exp.status !== "QUEUED") return;
    const interval = setInterval(onPoll, 4000);
    return () => clearInterval(interval);
  }, [exp.status, onPoll]);

  const label = EXPORT_LABELS[exp.exportFormat] ?? exp.exportFormat;
  const wfLabel = exp.workflow ? (WORKFLOW_LABELS[exp.workflow] ?? exp.workflow) : null;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3">
      <div className="shrink-0">{STATUS_ICON[exp.status]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {label}
          {wfLabel && <span className="text-gray-400 font-normal"> · {wfLabel}</span>}
          {exp.accurateTrim && <span className="text-gray-400 font-normal"> · précis</span>}
        </p>
        <p className="text-xs text-gray-400">
          {new Date(exp.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          {exp.status === "FAILED" && exp.errorMsg && <span className="text-red-500"> · {exp.errorMsg}</span>}
        </p>
      </div>
      {exp.status === "COMPLETED" && exp.outputKey && (
        <a
          href={`/api/derush/${jobId}/export/${exp.id}/download`}
          className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-medium transition-colors"
          download={exp.outputFilename ?? undefined}
        >
          <Download className="w-3.5 h-3.5" />
          Télécharger
        </a>
      )}
    </li>
  );
}

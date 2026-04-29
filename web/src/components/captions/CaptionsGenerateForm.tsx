"use client";

import { useState, useEffect } from "react";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import {
  Film, FileText, Upload, X, ChevronLeft, Download,
  Wand2, ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import {
  Caption,
  applyHighlightMarkersToCaptions,
  parseSRT,
  parseHighlightedSRT,
  serializeSRT,
} from "@/lib/srt";
import {
  buildTimingStatuses,
  buildTimedSegmentsFromCaptions,
  buildTimedSegmentsFromSegments,
  buildWordTimestampsForSubmission,
  type CaptionTimingStatus,
  realignTimedCaptions,
  timedSegmentsToCaptions,
} from "@/lib/captionWordTiming";
import {
  DEFAULT_CAPTION_AUTO_HIGHLIGHT,
  type AutoHighlightMode,
  type AutoHighlightPlacement,
  type CaptionPromptRow,
} from "@/lib/captionPrompt";
import { getNextHighlightGroup } from "@/lib/captionHighlightCycle";
import CaptionEditor from "@/components/captions/CaptionEditor";
import { SegmentTrimEditor } from "@/components/captions/SegmentTrimEditor";
import { buildSubtitlesFromWords, type Segment } from "@/lib/transcriptionProcess";

type TextTransform = "none" | "upper" | "lower" | "title";
type ExportProfile = "draft" | "balanced" | "final";
type AIModel = "claude" | "gpt";

type PresetData = {
  id: string;
  name: string;
  isBuiltin: boolean;
  config: Record<string, unknown>;
};

type QueuedJob = {
  id: string;
  status: string;
  videoUrl?: string;
  quality: string;
  videoName: string;
  createdAt: Date;
};

function srtTimeToSeconds(t: string): number {
  // Handles "HH:MM:SS,mmm" and "HH:MM:SS.mmm"
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function formatAutoHighlightModeLabel(mode: AutoHighlightMode): string {
  if (mode === "highlight1") return "HL1";
  if (mode === "highlight2") return "HL2";
  return "HL1 + HL2";
}

function formatAutoHighlightPlacementLabel(placement: AutoHighlightPlacement): string {
  return placement === "before" ? "avant le prompt" : "après le prompt";
}

function nested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

export default function CaptionsGenerateForm({
  preset,
  initialSrt,
  initialSubsJson,
  initialSegments,
  initialPrompts,
  promptStorageAvailable = true,
  promptStorageMessage = null,
  aiConfig = { hasClaude: true, hasGpt: true },
}: {
  preset: PresetData;
  initialSrt?: string | null;
  /** Word-level JSON produced by buildWordTimestampsForSubmission — used for regen when the job used the JSON path. */
  initialSubsJson?: string | null;
  initialSegments?: Segment[] | null;
  initialPrompts: CaptionPromptRow[];
  promptStorageAvailable?: boolean;
  promptStorageMessage?: string | null;
  aiConfig?: { hasClaude: boolean; hasGpt: boolean };
}) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [pendingSegments, setPendingSegments] = useState<Segment[] | null>(
    initialSegments && initialSegments.length > 0
      ? buildSubtitlesFromWords(initialSegments)
      : null
  );
  const [showTrimEditor, setShowTrimEditor] = useState<boolean>(
    !!(initialSegments && initialSegments.length > 0)
  );
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [highlighted, setHighlighted] = useState<Map<string, number>>(new Map());
  const [exportProfile, setExportProfile] = useState<ExportProfile>(
    (nested(preset.config, "export_profile") as ExportProfile | undefined) ?? "balanced"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [renderProgress, setRenderProgress] = useState(-1);

  // Queue of submitted jobs
  const [jobs, setJobs] = useState<QueuedJob[]>([]);

  // Source of truth for per-word timing. Real timings are kept when available,
  // and synthetic timings are generated for plain SRT imports so the editor can
  // stay on the JSON path after manual or AI edits.
  const [timedSegments, setTimedSegments] = useState<Segment[] | null>(null);
  const [timingStatuses, setTimingStatuses] = useState<CaptionTimingStatus[] | null>(null);

  // AI corrector state
  const [showAI, setShowAI] = useState(false);
  const [aiModel, setAiModel] = useState<AIModel>(
    aiConfig.hasClaude ? "claude" : "gpt"
  );
  const [customPrompts] = useState<CaptionPromptRow[]>(initialPrompts);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const baseTransform =
    (nested(preset.config, "base", "text_transform") as TextTransform | undefined) ?? "none";
  const highlightTransform =
    (nested(preset.config, "highlight", "text_transform") as TextTransform | undefined) ?? baseTransform;
  const highlight2Enabled =
    (nested(preset.config, "highlight2", "enabled") as boolean | undefined) ?? false;
  const highlight2Transform =
    (nested(preset.config, "highlight2", "text_transform") as TextTransform | undefined) ?? highlightTransform;
  const selectedPrompt = customPrompts.find((p) => p.id === selectedPromptId) ?? null;
  const selectedPromptAutoHighlight = selectedPrompt?.autoHighlight ?? DEFAULT_CAPTION_AUTO_HIGHLIGHT;
  const selectedPromptNeedsHighlight2 =
    selectedPromptAutoHighlight.enabled &&
    (selectedPromptAutoHighlight.mode === "highlight2" || selectedPromptAutoHighlight.mode === "both");

  // Pre-load SRT from a previous job (bypasses TrimEditor — regen flow)
  useEffect(() => {
    if (initialSrt) {
      const { captions: parsed, highlighted: hl } = parseHighlightedSRT(initialSrt);
      setCaptions(parsed);
      setHighlighted(hl);
      setTimedSegments(buildTimedSegmentsFromCaptions(parsed));
      setTimingStatuses(buildTimingStatuses(parsed.length, "estimated"));
    }
  }, [initialSrt]);

  // Pre-load from word-level JSON (regen from a job that used the JSON path)
  useEffect(() => {
    if (!initialSubsJson) return;
    try {
      type SubsWord = {
        word: string; start: number; end: number;
        highlight: boolean; highlight_group: number; caption_index: number;
      };
      const items = JSON.parse(initialSubsJson) as SubsWord[];
      if (!Array.isArray(items) || items.length === 0) return;

      // Group words by caption_index (1-based)
      const groups = new Map<number, SubsWord[]>();
      for (const item of items) {
        const g = groups.get(item.caption_index) ?? [];
        g.push(item);
        groups.set(item.caption_index, g);
      }

      const sortedIndices = [...groups.keys()].sort((a, b) => a - b);
      const restoredSegments: Segment[] = [];
      const restoredHighlighted = new Map<string, number>();

      for (const captionIndex of sortedIndices) {
        const words = groups.get(captionIndex)!;
        words.forEach((item, wordIndex) => {
          if (item.highlight) {
            restoredHighlighted.set(`${captionIndex}-${wordIndex}`, item.highlight_group);
          }
        });
        restoredSegments.push({
          start: words[0].start,
          end: words[words.length - 1].end,
          text: words.map((w) => w.word).join(" "),
          words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
        });
      }

      const restoredCaptions = timedSegmentsToCaptions(restoredSegments);
      setCaptions(restoredCaptions);
      setHighlighted(restoredHighlighted);
      setTimedSegments(restoredSegments);
      setTimingStatuses(buildTimingStatuses(restoredSegments.length, "original"));
    } catch {
      // Malformed JSON — silently skip
    }
  }, [initialSubsJson]);

  // SSE fast path — caption jobs updated immediately when webhook fires
  useAllJobEvents((event) => {
    if (event.jobType !== "captions") return;
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== event.jobId) return j;
        const mapped = event.status === "COMPLETED" || event.status === "DONE" ? "DONE" : event.status;
        return { ...j, status: mapped, videoUrl: typeof event.videoUrl === "string" ? event.videoUrl : j.videoUrl };
      })
    );
  });

  // Polling fallback — 10 s, only active when SSE is unavailable (dev, no tunnel)
  useEffect(() => {
    const pending = jobs.filter((j) => j.status === "QUEUED" || j.status === "PROCESSING");
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      await Promise.all(
        pending.map(async (job) => {
          try {
            const res = await fetch(`/api/render/captions/${job.id}`);
            if (!res.ok) return;
            const data = await res.json() as { status: string; videoUrl?: string };
            const mapped =
              data.status === "COMPLETED" || data.status === "DONE" ? "DONE" : data.status;
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? { ...j, status: mapped, videoUrl: data.videoUrl ?? j.videoUrl }
                  : j
              )
            );
          } catch { /* ignore */ }
        })
      );
    }, 10000);
    return () => clearInterval(timer);
  }, [jobs]);

  const toggleWord = (key: string) => {
    setHighlighted((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      const nextGroup = getNextHighlightGroup(current, highlight2Enabled);
      if (nextGroup === undefined) next.delete(key);
      else next.set(key, nextGroup);
      return next;
    });
  };

  const handleCaptionEditorChange = (updated: Caption[]) => {
    const realigned = realignTimedCaptions(timedSegments, updated, highlighted, timingStatuses);
    setTimedSegments(realigned.segments);
    setCaptions(timedSegmentsToCaptions(realigned.segments));
    setHighlighted(realigned.highlighted);
    setTimingStatuses(realigned.timingStatuses);
  };

  const canGenerate = !!videoFile && (!!subsFile || captions.length > 0) && !showTrimEditor;

  const handleGenerate = async () => {
    if (!videoFile) { setMessage("Ajoutez une vidéo"); return; }
    if (!subsFile && captions.length === 0) { setMessage("Ajoutez les sous-titres"); return; }

    setBusy(true);
    setMessage("Rendu en cours…");
    setRenderProgress(0.05);

    // Prefer JSON word timestamps whenever we have a timed word model.
    // Real WhisperX timings are preserved when available; plain SRT imports get
    // synthetic timings so edits and AI corrections can stay on the word path.
    const hasWordData =
      timedSegments !== null &&
      captions.length === timedSegments.length &&
      timedSegments.some((s) => Array.isArray(s.words) && s.words.length > 0);

    const subsContent = hasWordData
      ? buildWordTimestampsForSubmission(timedSegments!, highlighted)
      : captions.length > 0
      ? serializeSRT(captions, highlighted)
      : await subsFile!.text();
    const srtBlob = new Blob([subsContent], { type: "text/plain" });
    const srtFileName = hasWordData ? "captions.json" : (subsFile?.name ?? "captions.srt");
    const configWithProfile = { ...preset.config, export_profile: exportProfile };

    let fakeVal = 0.05;
    const fakeTimer = setInterval(() => {
      fakeVal = Math.min(fakeVal + 0.008, 0.88);
      setRenderProgress(fakeVal);
    }, 800);

    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("subtitles", srtBlob, srtFileName);
      form.append("config", JSON.stringify(configWithProfile));
      form.append("preview_mode", "false");
      form.append("preset_id", preset.id);

      const submitRes = await fetch("/api/render/captions", { method: "POST", body: form });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string };
        throw new Error(err.error ?? submitRes.statusText);
      }

      const submitData = await submitRes.json() as { captionJobId?: string; videoUrl?: string };

      if (submitData.videoUrl && submitData.captionJobId) {
        setJobs((prev) => [
          {
            id: submitData.captionJobId!,
            status: "DONE",
            videoUrl: submitData.videoUrl,
            quality: exportProfile,
            videoName: videoFile?.name ?? "vidéo",
            createdAt: new Date(),
          },
          ...prev,
        ]);
        setRenderProgress(1);
        setMessage("Rendu terminé !");
        return;
      }

      if (submitData.captionJobId) {
        setJobs((prev) => [
          { id: submitData.captionJobId!, status: "QUEUED", quality: exportProfile, videoName: videoFile?.name ?? "vidéo", createdAt: new Date() },
          ...prev,
        ]);
      }

      setMessage("Job soumis — en attente…");
      setRenderProgress(0.15);
    } catch (error) {
      setMessage(`Erreur : ${String(error)}`);
    } finally {
      clearInterval(fakeTimer);
      setBusy(false);
      if (renderProgress < 1) setTimeout(() => setRenderProgress(-1), 2000);
    }
  };

  const handleAICorrect = async () => {
    if (captions.length === 0) { setAiError("Importez d'abord un fichier .srt"); return; }
    if (!promptStorageAvailable) {
      setAiError(promptStorageMessage ?? "Les prompts ne sont pas disponibles sur cette instance.");
      return;
    }
    if (!selectedPromptId || !selectedPrompt) { setAiError("Sélectionnez un prompt disponible"); return; }
    if (selectedPromptNeedsHighlight2 && !highlight2Enabled) {
      setAiError("Le preset actuel n'active pas Highlight 2. Choisissez HL1 ou activez Highlight 2 dans le preset.");
      return;
    }

    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/captions/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captions: applyHighlightMarkersToCaptions(captions, highlighted),
          promptId: selectedPromptId,
          model: aiModel,
        }),
      });
      const data = await res.json() as {
        captions?: Caption[];
        highlighted?: Array<[string, number]>;
        error?: string;
      };
      if (!res.ok || !data.captions) throw new Error(data.error ?? "Erreur inconnue");
      const realigned = realignTimedCaptions(timedSegments, data.captions, undefined, timingStatuses);
      setTimedSegments(realigned.segments);
      setCaptions(timedSegmentsToCaptions(realigned.segments));
      setHighlighted(new Map(data.highlighted ?? []));
      setTimingStatuses(realigned.timingStatuses);
    } catch (err) {
      setAiError(String(err instanceof Error ? err.message : err));
    } finally {
      setAiLoading(false);
    }
  };

  const qualities: { value: ExportProfile; label: string; desc: string }[] = [
    { value: "draft", label: "Rapide", desc: "8 Mb/s" },
    { value: "balanced", label: "Équilibré", desc: "15 Mb/s" },
    { value: "final", label: "Max", desc: "20 Mb/s" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Back + Header */}
        <div className="mb-8">
          <Link
            href="/tools/captions"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-5"
          >
            <ChevronLeft size={14} />
            Captions
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center shrink-0">
              <Film size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{preset.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {initialSrt ? "Sous-titres pré-chargés depuis la génération précédente" : "Générez une vidéo avec des sous-titres brûlés"}
              </p>
            </div>
          </div>
        </div>

        {/* Upload row */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* Video */}
          <label
            className={`flex flex-col items-center gap-2.5 p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
              videoFile
                ? "border-violet-300 bg-violet-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                videoFile ? "bg-violet-100" : "bg-gray-100"
              }`}
            >
              <Upload size={15} className={videoFile ? "text-violet-500" : "text-gray-400"} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-800">Vidéo</p>
              {videoFile ? (
                <p className="text-xs text-violet-600 mt-0.5 max-w-[130px] truncate">
                  {videoFile.name}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">MP4 · MOV · WEBM</p>
              )}
            </div>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {/* SRT / JSON */}
          <label
            className={`flex flex-col items-center gap-2.5 p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
              subsFile || captions.length > 0 || showTrimEditor
                ? "border-violet-300 bg-violet-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                subsFile || captions.length > 0 || showTrimEditor ? "bg-violet-100" : "bg-gray-100"
              }`}
            >
              <FileText
                size={15}
                className={subsFile || captions.length > 0 || showTrimEditor ? "text-violet-500" : "text-gray-400"}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-800">Sous-titres</p>
              {subsFile || captions.length > 0 || showTrimEditor ? (
                <p className="text-xs text-violet-600 mt-0.5 max-w-[130px] truncate">
                  {subsFile?.name ?? (showTrimEditor ? `${pendingSegments?.length ?? 0} segments` : `${captions.length} lignes`)}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">.srt ou .json</p>
              )}
            </div>
            <input
              type="file"
              accept=".srt,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setSubsFile(f);
                if (f.name.endsWith(".json")) {
                  void f.text().then((txt) => {
                    try {
                      const segs = JSON.parse(txt) as Segment[];
                      setPendingSegments(segs);
                      setShowTrimEditor(true);
                      setCaptions([]);
                      setHighlighted(new Map());
                      setTimedSegments(null);
                      setTimingStatuses(null);
                    } catch {
                      // Silently ignore malformed JSON
                    }
                  });
                } else {
                  void f.text().then((txt) => {
                    const parsed = parseSRT(txt);
                    const segs: Segment[] = parsed.map((c) => ({
                      start: srtTimeToSeconds(c.start),
                      end: srtTimeToSeconds(c.end),
                      text: c.text,
                    }));
                    setPendingSegments(segs);
                    setShowTrimEditor(true);
                    setCaptions([]);
                    setHighlighted(new Map());
                    setTimedSegments(null);
                    setTimingStatuses(null);
                  });
                }
              }}
            />
          </label>
        </div>

        {/* Segment trim editor — shown after SRT or JSON import */}
        {showTrimEditor && pendingSegments && pendingSegments.length > 0 && (
          <SegmentTrimEditor
            segments={pendingSegments}
            videoFile={videoFile}
            onConfirm={(_srt, segs) => {
              const nextTimedSegments = buildTimedSegmentsFromSegments(segs);
              const hasOriginalWordData = segs.some((segment) => Array.isArray(segment.words) && segment.words.length > 0);
              setTimedSegments(nextTimedSegments);
              setTimingStatuses(buildTimingStatuses(nextTimedSegments.length, hasOriginalWordData ? "original" : "estimated"));
              setCaptions(timedSegmentsToCaptions(nextTimedSegments));
              setHighlighted(new Map());
              setShowTrimEditor(false);
            }}
            onCancel={() => {
              setShowTrimEditor(false);
              setPendingSegments(null);
              setSubsFile(null);
              setTimedSegments(null);
              setTimingStatuses(null);
            }}
          />
        )}

        {/* Highlight editor + AI corrector — shown after SRT parsed */}
        {!showTrimEditor && captions.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-3">
            {/* Editor header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Mots à surligner</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cliquez sur les mots pour les mettre en valeur
                </p>
              </div>
              <div className="flex items-center gap-2">
                {highlighted.size > 0 && (
                  <button
                    onClick={() => setHighlighted(new Map())}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={10} />
                    Effacer tout
                  </button>
                )}
                {/* AI corrector toggle */}
                <button
                  onClick={() => setShowAI((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    showAI
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600"
                  }`}
                >
                  <Wand2 size={11} />
                  Auto-corriger
                  {showAI ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              </div>
            </div>

            {/* AI corrector panel */}
            {showAI && (
              <div className="mb-4 bg-violet-50 border border-violet-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-violet-800 mb-3">Correction IA</p>

                {/* Model selector */}
                <div className="flex gap-2 mb-4">
                  {([
                    { id: "claude" as AIModel, label: "Claude Sonnet 4.6", enabled: aiConfig.hasClaude },
                    { id: "gpt" as AIModel, label: "ChatGPT 5.4", enabled: aiConfig.hasGpt },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setAiModel(m.id)}
                      disabled={!m.enabled}
                      title={!m.enabled ? "Clé API non configurée" : undefined}
                      className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
                        !m.enabled
                          ? "border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed"
                          : aiModel === m.id
                          ? "border-violet-400 bg-violet-600 text-white"
                          : "border-violet-200 text-violet-700 hover:bg-violet-100"
                      }`}
                    >
                      {m.label}
                      {!m.enabled && <span className="ml-1 text-[9px] opacity-60">non configuré</span>}
                    </button>
                  ))}
                </div>

                {/* Custom prompts list */}
                {customPrompts.length > 0 ? (
                  <div className="flex flex-col gap-1.5 mb-3">
                    {customPrompts.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center gap-1 rounded-lg border transition-colors ${
                          selectedPromptId === p.id
                            ? "border-violet-400 bg-white"
                            : "border-transparent hover:bg-violet-100"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedPromptId(p.id)}
                          className="flex-1 text-left text-xs px-3 py-2 text-violet-700"
                        >
                          <div className="flex items-center gap-2">
                            {selectedPromptId === p.id
                              ? <span className="font-semibold">{p.name}</span>
                              : <span>{p.name}</span>
                            }
                            {p.autoHighlight.enabled && (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                {formatAutoHighlightModeLabel(p.autoHighlight.mode)}
                              </span>
                            )}
                          </div>
                          {p.autoHighlight.enabled && (
                            <p className="mt-1 text-[10px] text-violet-400">
                              Auto-highlight {formatAutoHighlightPlacementLabel(p.autoHighlight.placement)}
                            </p>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mb-3 rounded-xl border border-violet-100 bg-white px-3 py-2.5">
                    <p className="text-[11px] text-violet-500">
                      Aucun prompt disponible pour le moment. Contactez votre administrateur.
                    </p>
                  </div>
                )}

                {selectedPrompt?.autoHighlight.enabled && (
                  <div className="mb-3 rounded-xl border border-violet-200 bg-white px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-violet-700">Auto-highlight actif</p>
                    <p className="mt-0.5 text-[11px] text-violet-600">
                      {formatAutoHighlightModeLabel(selectedPrompt.autoHighlight.mode)} · consigne insérée {formatAutoHighlightPlacementLabel(selectedPrompt.autoHighlight.placement)}
                    </p>
                    {selectedPrompt.autoHighlight.prompt && (
                      <p className="mt-1 text-[11px] text-violet-500">
                        {selectedPrompt.autoHighlight.prompt}
                      </p>
                    )}
                  </div>
                )}

                {selectedPromptNeedsHighlight2 && !highlight2Enabled && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-5">
                      Le prompt sélectionné demande Highlight 2, mais ce preset ne l&apos;active pas.
                    </p>
                  </div>
                )}

                {!promptStorageAvailable && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <p className="text-[11px] leading-5">
                      {promptStorageMessage ?? "Les prompts captions ne sont pas disponibles sur cette instance."}
                    </p>
                  </div>
                )}

                {aiError && (
                  <p className="text-xs text-red-500 mb-2">{aiError}</p>
                )}

                <button
                  onClick={handleAICorrect}
                  disabled={
                    !promptStorageAvailable ||
                    aiLoading ||
                    !selectedPromptId ||
                    (selectedPromptNeedsHighlight2 && !highlight2Enabled)
                  }
                  className="w-full flex items-center justify-center gap-2 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  {aiLoading ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Correction en cours…
                    </>
                  ) : (
                    <>
                      <Wand2 size={12} />
                      Corriger avec {aiModel === "claude" ? "Claude Sonnet 4.6" : "ChatGPT 5.4"}
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="cx" style={{ background: "transparent", minHeight: 0 }}>
              <CaptionEditor
                captions={captions}
                onChange={handleCaptionEditorChange}
                highlighted={highlighted}
                onToggleWord={toggleWord}
                timingStatuses={timingStatuses ?? undefined}
                baseTransform={baseTransform}
                highlightTransform={highlightTransform}
                highlight2Transform={highlight2Transform}
                highlight2Enabled={highlight2Enabled}
              />
            </div>
          </div>
        )}

        {/* Quality selector — only visible when not in trim editor */}
        {!showTrimEditor && <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <p className="text-sm font-medium text-gray-900 mb-3">Qualité d&apos;export</p>
          <div className="grid grid-cols-3 gap-2">
            {qualities.map((q) => (
              <button
                key={q.value}
                onClick={() => setExportProfile(q.value)}
                className={`flex flex-col items-center gap-0.5 py-3 rounded-xl border transition-all text-sm ${
                  exportProfile === q.value
                    ? "border-violet-300 bg-violet-50 text-violet-700"
                    : "border-gray-100 bg-white text-gray-600 hover:border-gray-200"
                }`}
              >
                <span className="font-medium">{q.label}</span>
                <span className="text-[10px] opacity-60">{q.desc}</span>
              </button>
            ))}
          </div>
        </div>}

        {/* Generate button — only visible when not in trim editor */}
        {!showTrimEditor && <>
        <button
          disabled={!canGenerate || busy}
          onClick={handleGenerate}
          className="w-full flex items-center justify-center gap-2 py-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-colors"
        >
          {busy ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {message}
            </>
          ) : (
            <>
              <Film size={16} />
              Générer
            </>
          )}
        </button>

        {!canGenerate && !busy && (
          <p className="text-xs text-center text-gray-400 mt-2">
            {!videoFile ? "Ajoutez une vidéo" : "Ajoutez un fichier .srt ou .json"}
          </p>
        )}

        {/* Progress bar */}
        {renderProgress >= 0 && (
          <div className="mt-4 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
            <div
              className="bg-violet-500 h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(renderProgress * 100)}%` }}
            />
          </div>
        )}

        {/* Status (non-busy) */}
        {message && !busy && (
          <p
            className={`text-sm text-center mt-3 ${
              message.startsWith("Erreur") ? "text-red-500" : "text-gray-500"
            }`}
          >
            {message}
          </p>
        )}

        {/* Generation queue */}
        {jobs.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-gray-400" />
              <p className="text-sm font-medium text-gray-700">File de génération</p>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {jobs.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {jobs.map((job) => {
                const isDone = job.status === "DONE" || job.status === "COMPLETED";
                const isFailed = job.status === "FAILED";
                return (
                  <div
                    key={job.id}
                    className="bg-white border border-gray-100 rounded-xl overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Status icon */}
                      <div className="shrink-0">
                        {isDone ? (
                          <CheckCircle2 size={16} className="text-green-500" />
                        ) : isFailed ? (
                          <AlertCircle size={16} className="text-red-400" />
                        ) : (
                          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {job.videoName} · {job.quality} · {job.createdAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <p className={`text-[10px] mt-0.5 ${
                          isDone ? "text-green-600" : isFailed ? "text-red-400" : "text-violet-500"
                        }`}>
                          {isDone ? "Terminé" : isFailed ? "Échec" : "En cours…"}
                        </p>
                      </div>

                      {/* Download action */}
                      {isDone && job.videoUrl && (
                        <a
                          href={job.videoUrl}
                          download
                          className="shrink-0 inline-flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          <Download size={12} />
                          MP4
                        </a>
                      )}
                    </div>

                    {/* Video preview (compact) */}
                    {isDone && job.videoUrl && (
                      <div className="border-t border-gray-50 p-3">
                        <div className="max-w-[280px]">
                          <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100">
                            <video
                              src={job.videoUrl}
                              controls
                              className="absolute inset-0 w-full h-full object-contain"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>}
      </div>
    </div>
  );
}

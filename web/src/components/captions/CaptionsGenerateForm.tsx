"use client";

import { useState, useEffect } from "react";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import {
  Film, FileText, Upload, X, ChevronLeft,
  Mic, Check,
} from "lucide-react";
import Link from "next/link";
import {
  Caption,
  applyHighlightMarkersToCaptions,
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
  type CaptionPromptRow,
} from "@/lib/captionPrompt";
import { getNextHighlightGroup } from "@/lib/captionHighlightCycle";
import CaptionEditor from "@/components/captions/CaptionEditor";
import { SegmentTrimEditor } from "@/components/captions/SegmentTrimEditor";
import { buildSubtitlesFromWords, type Segment } from "@/lib/transcriptionProcess";
import { nested } from "@/components/captions/utils";
import { CaptionsAIPanel } from "@/components/captions/CaptionsAIPanel";
import { CaptionsSourcePicker } from "@/components/captions/CaptionsSourcePicker";
import { CaptionsJobQueue } from "@/components/captions/CaptionsJobQueue";

type TextTransform = "none" | "upper" | "lower" | "title";
type AIModel = "claude" | "gpt";

type TranscriptionItem = {
  id: string;
  inputFilename: string | null;
  createdAt: string;
  status: string;
};

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
  videoName: string;
  createdAt: Date;
};

// F3-step1 : formatDate, srtTimeToSeconds, formatAutoHighlightModeLabel,
// formatAutoHighlightPlacementLabel, nested extraits dans ./utils.ts.

export default function CaptionsGenerateForm({
  preset,
  initialSrt,
  initialSubsJson,
  initialSegments,
  initialPrompts,
  promptStorageAvailable = true,
  promptStorageMessage = null,
  aiConfig = { hasClaude: true, hasGpt: true },
  slotId = null,
  returnTo = null,
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
  /** Slot de publication lié (Phase 1.9 A2) — passé au POST pour câbler la FK */
  slotId?: string | null;
  /** URL de retour anti-open-redirect (Phase 1.9 A2) */
  returnTo?: string | null;
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

  // Source card state
  const [sourceTab, setSourceTab] = useState<"transcription" | "upload">("transcription");
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<string | null>(null);
  const [loadingTranscriptions, setLoadingTranscriptions] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [transcriptionLoadError, setTranscriptionLoadError] = useState<string | null>(null);

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

  // F3-step4 — beforeunload guard anti-perte. Affiche un prompt natif
  // "voulez-vous quitter ?" si l'user a chargé/édité des sous-titres ou
  // uploadé une vidéo et n'a pas encore lancé la génération. On ignore :
  // - busy=true : génération en cours, l'user peut vouloir consulter
  //   l'historique en navigant ailleurs (le job continue côté serveur).
  // - initialSrt présent : regen flow, les captions viennent du serveur
  //   et ne sont pas une "saisie utilisateur" à protéger spécifiquement.
  useEffect(() => {
    const hasUnsavedWork = (captions.length > 0 && !initialSrt) || videoFile !== null;
    if (!hasUnsavedWork || busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [captions.length, videoFile, busy, initialSrt]);

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

  // Load transcription list when source tab = "transcription" and list not yet loaded
  useEffect(() => {
    if (sourceTab !== "transcription") return;
    if (transcriptions.length > 0) return;
    setLoadingTranscriptions(true);
    fetch("/api/transcription")
      .then((r) => r.json())
      .then((data: unknown) => {
        const raw = (
          Array.isArray(data)
            ? (data as TranscriptionItem[])
            : ((data as { jobs?: TranscriptionItem[] }).jobs ?? [])
        );
        setTranscriptions(raw.filter((j) => j.status === "COMPLETED"));
      })
      .catch(() => {})
      .finally(() => setLoadingTranscriptions(false));
  }, [sourceTab, transcriptions.length]);

  // Fetch word-level JSON when a transcription is selected
  useEffect(() => {
    if (!selectedTranscriptionId) return;
    setLoadingSource(true);
    setTranscriptionLoadError(null);
    fetch(`/api/transcription/${selectedTranscriptionId}/download?format=json`)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP error");
        return r.json() as Promise<Segment[]>;
      })
      .then((segs) => {
        if (!Array.isArray(segs) || segs.length === 0) throw new Error("Données invalides");
        setPendingSegments(segs);
        setShowTrimEditor(true);
        setCaptions([]);
        setHighlighted(new Map());
        setTimedSegments(null);
        setTimingStatuses(null);
        setSubsFile(null);
      })
      .catch(() => {
        setTranscriptionLoadError("Impossible de charger la transcription");
        setSelectedTranscriptionId(null);
      })
      .finally(() => setLoadingSource(false));
  }, [selectedTranscriptionId]);

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

  const handleSplitCaption = (captionIndex: number, wordIndex: number) => {
    if (!timedSegments) return;
    const segIdx = captionIndex - 1;
    if (segIdx < 0 || segIdx >= timedSegments.length) return;
    const segment = timedSegments[segIdx];
    const words = Array.isArray(segment.words) ? segment.words : [];
    if (wordIndex <= 0 || wordIndex >= words.length) return;

    const part1 = words.slice(0, wordIndex);
    const part2 = words.slice(wordIndex);
    const seg1: Segment = {
      start: part1[0].start,
      end: part1[part1.length - 1].end,
      text: part1.map((w) => w.word).join(" "),
      words: part1,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
    };
    const seg2: Segment = {
      start: part2[0].start,
      end: part2[part2.length - 1].end,
      text: part2.map((w) => w.word).join(" "),
      words: part2,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
    };

    const newSegments = [
      ...timedSegments.slice(0, segIdx),
      seg1,
      seg2,
      ...timedSegments.slice(segIdx + 1),
    ];
    const originalStatus = timingStatuses?.[segIdx] ?? "original";
    const newStatuses: CaptionTimingStatus[] = [
      ...(timingStatuses?.slice(0, segIdx) ?? []),
      originalStatus,
      originalStatus,
      ...(timingStatuses?.slice(segIdx + 1) ?? []),
    ];

    setTimedSegments(newSegments);
    setTimingStatuses(newStatuses);
    setCaptions(timedSegmentsToCaptions(newSegments));
    setHighlighted((prev) => {
      const next = new Map<string, number>();
      for (const [key, value] of prev.entries()) {
        const dashIdx = key.indexOf("-");
        if (dashIdx < 0) continue;
        const ci = parseInt(key.slice(0, dashIdx), 10);
        const wi = parseInt(key.slice(dashIdx + 1), 10);
        if (isNaN(ci) || isNaN(wi)) continue;
        if (ci < captionIndex) {
          next.set(key, value);
        } else if (ci === captionIndex) {
          if (wi < wordIndex) {
            next.set(`${ci}-${wi}`, value);
          } else {
            next.set(`${captionIndex + 1}-${wi - wordIndex}`, value);
          }
        } else {
          next.set(`${ci + 1}-${wi}`, value);
        }
      }
      return next;
    });
  };

  const handleMergeCaption = (captionIndex: number) => {
    if (!timedSegments) return;
    const segIdx = captionIndex - 1;
    if (segIdx < 0 || segIdx >= timedSegments.length - 1) return;

    const seg1 = timedSegments[segIdx];
    const seg2 = timedSegments[segIdx + 1];
    const words1 = Array.isArray(seg1.words) ? seg1.words : [];
    const words2 = Array.isArray(seg2.words) ? seg2.words : [];
    const wordCount1 = words1.length;

    const merged: Segment = {
      start: seg1.start,
      end: seg2.end,
      text: [seg1.text, seg2.text].filter(Boolean).join(" "),
      words: [...words1, ...words2],
      ...(seg1.speaker ? { speaker: seg1.speaker } : {}),
    };

    const newSegments = [
      ...timedSegments.slice(0, segIdx),
      merged,
      ...timedSegments.slice(segIdx + 2),
    ];

    const statusOrder = { original: 0, realigned: 1, estimated: 2 } as const;
    const s1 = timingStatuses?.[segIdx] ?? "original";
    const s2 = timingStatuses?.[segIdx + 1] ?? "original";
    const mergedStatus = statusOrder[s1] >= statusOrder[s2] ? s1 : s2;
    const newStatuses: CaptionTimingStatus[] = [
      ...(timingStatuses?.slice(0, segIdx) ?? []),
      mergedStatus,
      ...(timingStatuses?.slice(segIdx + 2) ?? []),
    ];

    setTimedSegments(newSegments);
    setTimingStatuses(newStatuses);
    setCaptions(timedSegmentsToCaptions(newSegments));
    setHighlighted((prev) => {
      const next = new Map<string, number>();
      for (const [key, value] of prev.entries()) {
        const dashIdx = key.indexOf("-");
        if (dashIdx < 0) continue;
        const ci = parseInt(key.slice(0, dashIdx), 10);
        const wi = parseInt(key.slice(dashIdx + 1), 10);
        if (isNaN(ci) || isNaN(wi)) continue;
        if (ci < captionIndex) {
          next.set(key, value);
        } else if (ci === captionIndex) {
          next.set(key, value);
        } else if (ci === captionIndex + 1) {
          next.set(`${captionIndex}-${wi + wordCount1}`, value);
        } else {
          next.set(`${ci - 1}-${wi}`, value);
        }
      }
      return next;
    });
  };

  const handleDeleteCaption = (captionIndex: number) => {
    if (!timedSegments) return;
    const segIdx = captionIndex - 1;
    if (segIdx < 0 || segIdx >= timedSegments.length) return;

    const newSegments = [
      ...timedSegments.slice(0, segIdx),
      ...timedSegments.slice(segIdx + 1),
    ];
    const newStatuses: CaptionTimingStatus[] = [
      ...(timingStatuses?.slice(0, segIdx) ?? []),
      ...(timingStatuses?.slice(segIdx + 1) ?? []),
    ];

    setTimedSegments(newSegments);
    setTimingStatuses(newStatuses);
    setCaptions(timedSegmentsToCaptions(newSegments));
    setHighlighted((prev) => {
      const next = new Map<string, number>();
      for (const [key, value] of prev.entries()) {
        const dashIdx = key.indexOf("-");
        if (dashIdx < 0) continue;
        const ci = parseInt(key.slice(0, dashIdx), 10);
        const wi = parseInt(key.slice(dashIdx + 1), 10);
        if (isNaN(ci) || isNaN(wi)) continue;
        if (ci < captionIndex) {
          next.set(key, value);
        } else if (ci === captionIndex) {
          // deleted — drop
        } else {
          next.set(`${ci - 1}-${wi}`, value);
        }
      }
      return next;
    });
  };

  const clearSubsSource = () => {
    setSubsFile(null);
    setSelectedTranscriptionId(null);
    setCaptions([]);
    setHighlighted(new Map());
    setPendingSegments(null);
    setShowTrimEditor(false);
    setTimedSegments(null);
    setTimingStatuses(null);
    setTranscriptionLoadError(null);
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
    const configWithProfile = { ...preset.config, export_profile: "final" };

    let fakeVal = 0.05;
    const fakeTimer = setInterval(() => {
      fakeVal = Math.min(fakeVal + 0.008, 0.88);
      setRenderProgress(fakeVal);
    }, 800);

    try {
      // ── Mode RunPod : URL présignée (upload direct browser → R2) ──────────
      // Essayer le mode presigned d'abord ; 503 = fallback multipart (local)
      const prepRes = await fetch("/api/render/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename:    videoFile.name,
          ext:         videoFile.name.split(".").pop()?.toLowerCase() ?? "mp4",
          srtContent:  subsContent,
          srtFilename: srtFileName,
          config:      configWithProfile,
          previewMode: false,
          presetId:    preset.id,
          ...(slotId ? { slotId } : {}),
        }),
      });

      let captionJobId: string | undefined;
      let immediateVideoUrl: string | undefined;

      if (prepRes.ok) {
        const { captionJobId: jobId, uploadUrl } = await prepRes.json() as { captionJobId: string; uploadUrl: string };
        captionJobId = jobId;

        // Upload direct vers R2 — contourne le serveur Next.js
        setMessage("Upload vidéo…");
        setRenderProgress(0.25);
        const r2Res = await fetch(uploadUrl, {
          method: "PUT",
          body: videoFile,
          headers: { "Content-Type": videoFile.type || "video/mp4" },
        });
        if (!r2Res.ok) throw new Error(`Upload R2 échoué : ${r2Res.status}`);

        // Soumettre à RunPod
        setMessage("Envoi en cours…");
        setRenderProgress(0.45);
        const submitRes = await fetch(`/api/render/captions/${captionJobId}/submit`, { method: "POST" });
        if (!submitRes.ok) {
          const err = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string };
          throw new Error(err.error ?? submitRes.statusText);
        }
      } else if (prepRes.status === 503) {
        // ── Mode local (USE_RUNPOD=false) : fallback multipart ──────────────
        const form = new FormData();
        form.append("video", videoFile);
        form.append("subtitles", srtBlob, srtFileName);
        form.append("config", JSON.stringify(configWithProfile));
        form.append("preview_mode", "false");
        form.append("preset_id", preset.id);
        if (slotId) form.append("slot_id", slotId);
        const fallbackRes = await fetch("/api/render/captions", { method: "POST", body: form });
        if (!fallbackRes.ok) {
          const err = await fallbackRes.json().catch(() => ({ error: fallbackRes.statusText })) as { error?: string };
          throw new Error(err.error ?? fallbackRes.statusText);
        }
        const fallbackData = await fallbackRes.json() as { captionJobId?: string; videoUrl?: string };
        captionJobId = fallbackData.captionJobId;
        immediateVideoUrl = fallbackData.videoUrl;
      } else {
        const err = await prepRes.json().catch(() => ({ error: prepRes.statusText })) as { error?: string };
        throw new Error(err.error ?? prepRes.statusText);
      }

      if (immediateVideoUrl && captionJobId) {
        setJobs((prev) => [
          {
            id: captionJobId!,
            status: "DONE",
            videoUrl: immediateVideoUrl,
            videoName: videoFile?.name ?? "vidéo",
            createdAt: new Date(),
          },
          ...prev,
        ]);
        setRenderProgress(1);
        setMessage("Rendu terminé !");
        return;
      }

      if (captionJobId) {
        setJobs((prev) => [
          { id: captionJobId!, status: "QUEUED", videoName: videoFile?.name ?? "vidéo", createdAt: new Date() },
          ...prev,
        ]);
      }

      setMessage("Job soumis — en attente…");
      setRenderProgress(0.5);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Back + Header */}
        <div className="mb-8">
          <Link
            href="/captions"
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

        {/* Video upload — compact horizontal bar */}
        <label
          className={`flex items-center gap-3 p-4 border rounded-2xl cursor-pointer transition-all mb-3 ${
            videoFile
              ? "border-violet-200 bg-violet-50"
              : "border-gray-100 bg-white hover:border-gray-200"
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex shrink-0 items-center justify-center ${videoFile ? "bg-violet-100" : "bg-gray-100"}`}>
            <Upload size={15} className={videoFile ? "text-violet-500" : "text-gray-400"} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">Vidéo</p>
            {videoFile ? (
              <p className="text-xs text-violet-600 mt-0.5 truncate">{videoFile.name}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">MP4 · MOV · WEBM</p>
            )}
          </div>
          {videoFile && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setVideoFile(null); }}
              className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {/* Source card — Sous-titres */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Sous-titres</h2>
            {(captions.length > 0 || showTrimEditor || subsFile) && (
              <button
                type="button"
                onClick={clearSubsSource}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={12} /> Effacer
              </button>
            )}
          </div>

          {/* Source picker — F3-step3 extrait dans CaptionsSourcePicker */}
          {!showTrimEditor && captions.length === 0 && !subsFile && (
            <CaptionsSourcePicker
              sourceTab={sourceTab}
              setSourceTab={setSourceTab}
              transcriptions={transcriptions}
              loadingTranscriptions={loadingTranscriptions}
              transcriptionLoadError={transcriptionLoadError}
              loadingSource={loadingSource}
              selectedTranscriptionId={selectedTranscriptionId}
              setSelectedTranscriptionId={setSelectedTranscriptionId}
              setSubsFile={setSubsFile}
              setPendingSegments={setPendingSegments}
              setShowTrimEditor={setShowTrimEditor}
              setCaptions={setCaptions}
              setHighlighted={setHighlighted}
              setTimedSegments={setTimedSegments}
              setTimingStatuses={setTimingStatuses}
            />
          )}

          {/* Trim editor open — show source name as status */}
          {showTrimEditor && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-violet-100 rounded-lg flex shrink-0 items-center justify-center">
                {selectedTranscriptionId ? <Mic size={14} className="text-violet-600" /> : <FileText size={14} className="text-violet-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {selectedTranscriptionId
                    ? (transcriptions.find((t) => t.id === selectedTranscriptionId)?.inputFilename ?? "Transcription")
                    : (subsFile?.name ?? "Segments pré-chargés")}
                </p>
                <p className="text-xs text-gray-400">{pendingSegments?.length ?? 0} segments · édition en cours</p>
              </div>
            </div>
          )}

          {/* Captions ready — show summary */}
          {!showTrimEditor && captions.length > 0 && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-violet-100 rounded-lg flex shrink-0 items-center justify-center">
                <Check size={14} className="text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{captions.length} lignes</p>
                <p className="text-xs text-gray-400">
                  {selectedTranscriptionId
                    ? (transcriptions.find((t) => t.id === selectedTranscriptionId)?.inputFilename ?? "Transcription")
                    : (subsFile?.name ?? "Sous-titres chargés")}
                </p>
              </div>
            </div>
          )}

          {/* subsFile loaded but not yet in trim editor (edge case: plain SRT without trim) */}
          {!showTrimEditor && captions.length === 0 && subsFile && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-violet-100 rounded-lg flex shrink-0 items-center justify-center">
                <FileText size={14} className="text-violet-600" />
              </div>
              <p className="text-sm font-medium text-gray-800 truncate">{subsFile.name}</p>
            </div>
          )}
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
              clearSubsSource();
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
                {/* AI corrector — F3-step2 extrait dans CaptionsAIPanel */}
                <CaptionsAIPanel
                  showAI={showAI}
                  onToggleShowAI={() => setShowAI((v) => !v)}
                  aiModel={aiModel}
                  setAiModel={setAiModel}
                  aiConfig={aiConfig}
                  customPrompts={customPrompts}
                  selectedPromptId={selectedPromptId}
                  setSelectedPromptId={setSelectedPromptId}
                  selectedPrompt={selectedPrompt}
                  selectedPromptNeedsHighlight2={selectedPromptNeedsHighlight2}
                  highlight2Enabled={highlight2Enabled}
                  promptStorageAvailable={promptStorageAvailable}
                  promptStorageMessage={promptStorageMessage}
                  aiError={aiError}
                  aiLoading={aiLoading}
                  onCorrect={() => void handleAICorrect()}
                />
              </div>
            </div>

            <div className="cx" style={{ background: "transparent", minHeight: 0 }}>
              <CaptionEditor
                captions={captions}
                onChange={handleCaptionEditorChange}
                onSplitAtWord={handleSplitCaption}
                onMergeWithNext={handleMergeCaption}
                onDeleteCaption={handleDeleteCaption}
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
            {!videoFile ? "Ajoutez une vidéo" : "Sélectionnez une source de sous-titres"}
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

        {/* F3-step5 — queue + lien retour extraits dans CaptionsJobQueue */}
        <CaptionsJobQueue jobs={jobs} returnTo={returnTo} busy={busy} />
        </>}
      </div>
    </div>
  );
}

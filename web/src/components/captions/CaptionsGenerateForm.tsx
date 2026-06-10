"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { toast } from "@/components/ui/Toast";
import { X, Languages, Loader2 } from "lucide-react";
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
import { CaptionsVideoUploadBar } from "@/components/captions/CaptionsVideoUploadBar";
import { CaptionsHeader } from "@/components/captions/CaptionsHeader";
import { CaptionsGenerateButton } from "@/components/captions/CaptionsGenerateButton";
import { CaptionsSourceStatus } from "@/components/captions/CaptionsSourceStatus";

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

// ── Mode bilingue (chemin séparé du mono) ────────────────────────────────────
// Quand les segments source contiennent un `translation` non vide, on bypass
// le découpage word-level `buildSubtitlesFromWords` (calibré pour le français)
// et on produit directement un sub-caption par segment en remplaçant `text`
// par la traduction. Les words[] sont reconstruits soit en découpant la
// traduction par espaces (langues latines), soit en gardant un seul "mot" =
// la traduction complète (chinois, japonais — pas d'espaces). Le word-pop est
// neutralisé dans le second cas par construction (un seul mot).

function isBilingualSegments(segments: Segment[]): boolean {
  return segments.some((s) => typeof s.translation === "string" && s.translation.trim().length > 0);
}

function applyBilingualTranslation(segment: Segment): Segment {
  // Fallback gracieux : si Claude n'a pas pu produire de traduction (segment
  // halluciné, charabia phonétique, ou batch partiellement répondu), on garde
  // le texte original. L'utilisateur peut corriger dans CaptionEditor avant le
  // rendu — c'est préféré à supprimer le segment (perte de timeline) ou à
  // injecter un placeholder visible (pollution du rendu vidéo).
  const translation = segment.translation?.trim();
  if (!translation) return segment;
  const start = segment.start;
  const end = segment.end;
  const duration = Math.max(0.1, end - start);
  const hasSpaces = /\s/.test(translation);
  const words = hasSpaces
    ? translation
        .split(/\s+/)
        .filter(Boolean)
        .map((token, i, arr) => {
          const tokenDuration = duration / arr.length;
          return {
            word: token,
            start: start + i * tokenDuration,
            end: start + (i + 1) * tokenDuration,
          };
        })
    : [{ word: translation, start, end }];
  return {
    ...segment,
    text: translation,
    words,
  };
}

function prepareSegmentsForEditor(segments: Segment[]): Segment[] {
  if (!isBilingualSegments(segments)) {
    return buildSubtitlesFromWords(segments);
  }
  return segments.map(applyBilingualTranslation);
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
  slotId = null,
  returnTo = null,
  pendingTranscription = null,
  transcriptionBlocker = null,
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
  /** V8.3 — Job transcription auto-lancé/déjà en cours pour le slot. Le form
   *  affiche un banner d'attente + SSE listener qui refresh la page quand
   *  le job passe COMPLETED (segments arrivent côté server). */
  pendingTranscription?: { jobId: string; status: string } | null;
  /** V8.3 — Raison pour laquelle l'auto-launch a échoué (pas de version
   *  source, RunPod off, etc.) — affiché en banner danger. */
  transcriptionBlocker?: string | null;
}) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [pendingSegments, setPendingSegments] = useState<Segment[] | null>(
    initialSegments && initialSegments.length > 0
      ? prepareSegmentsForEditor(initialSegments)
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
  // Mode bilingue : indique si on est en train d'appeler /translate.
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // Ref synchrone pour bloquer le double-click — un setState n'est pas commit
  // assez vite si l'utilisateur clique deux fois en quelques ms.
  const translatingRef = useRef(false);

  // Queue of submitted jobs
  const [jobs, setJobs] = useState<QueuedJob[]>([]);

  // Source of truth for per-word timing. Real timings are kept when available,
  // and synthetic timings are generated for plain SRT imports so the editor can
  // stay on the JSON path after manual or AI edits.
  const [timedSegments, setTimedSegments] = useState<Segment[] | null>(null);
  const [timingStatuses, setTimingStatuses] = useState<CaptionTimingStatus[] | null>(null);

  // AI corrector state — GPT préféré par défaut quand les deux sont dispos.
  const [showAI, setShowAI] = useState(false);
  const [aiModel, setAiModel] = useState<AIModel>(
    aiConfig.hasGpt ? "gpt" : "claude"
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

  // Baseline du preset pour le slider override "Décalage vertical". Range
  // [-0.4, 0.4] côté UX, [-0.5, 0.5] côté Pydantic engine. null = on garde
  // la valeur du preset ; sinon on écrase configData.layout.vertical_offset
  // au moment de POST /api/render/captions (sémantique REMPLACE).
  const presetVerticalOffset = useMemo(() => {
    const raw = nested(preset.config, "layout", "vertical_offset");
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }, [preset.config]);
  const [verticalOffsetOverride, setVerticalOffsetOverride] = useState<number | null>(null);
  const effectiveVerticalOffset = verticalOffsetOverride ?? presetVerticalOffset;

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

  const router = useRouter();

  // V8.3 — SSE listener pour la transcription en cours (auto-lancée depuis
  // la page server). Quand le job termine, on refresh pour récupérer le JSON
  // des segments côté server et re-render le form pre-rempli.
  useAllJobEvents((event) => {
    if (event.jobType !== "transcription") return;
    if (!pendingTranscription || event.jobId !== pendingTranscription.jobId) return;
    if (event.status === "COMPLETED" || event.status === "DONE") {
      toast.success("Transcription prête — chargement des sous-titres.");
      router.refresh();
    } else if (event.status === "FAILED") {
      toast.error("La transcription a échoué. Réessaie depuis /transcriptions.");
    }
  });

  // SSE fast path — caption jobs updated immediately when webhook fires
  useAllJobEvents((event) => {
    if (event.jobType !== "captions") return;
    setJobs((prev) => {
      const existing = prev.find((j) => j.id === event.jobId);
      // V5.A.3 — Si un job soumis pendant cette session termine et qu'on
      // a un slotId + returnTo (= vient d'une fiche), rebond auto fiche.
      // Pattern cohérent avec TranscriptionList V5.A.2, CoverGenerator V2.1,
      // DescriptionTool V2.2.
      if (
        existing &&
        (event.status === "COMPLETED" || event.status === "DONE") &&
        slotId &&
        returnTo
      ) {
        toast.success("Sous-titres générés — retour à la publication.");
        setTimeout(() => router.push(returnTo), 1500);
      }
      return prev.map((j) => {
        if (j.id !== event.jobId) return j;
        const mapped = event.status === "COMPLETED" || event.status === "DONE" ? "DONE" : event.status;
        return { ...j, status: mapped, videoUrl: typeof event.videoUrl === "string" ? event.videoUrl : j.videoUrl };
      });
    });
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
    setTranslateError(null);
    // Reset des états dérivés AVANT le fetch — sinon bilingualStatus
    // continuerait à dériver de l'ancienne transcription pendant la fenêtre
    // de chargement (UX confuse : le bouton "Traduire" peut s'afficher pour
    // une mauvaise transcription, et un clic dans cette fenêtre POSTerait
    // sur un job non pertinent).
    setPendingSegments(null);
    setTimedSegments(null);
    setTimingStatuses(null);
    setCaptions([]);
    setHighlighted(new Map());
    fetch(`/api/transcription/${selectedTranscriptionId}/download?format=json`)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP error");
        return r.json() as Promise<Segment[]>;
      })
      .then((segs) => {
        if (!Array.isArray(segs) || segs.length === 0) throw new Error("Données invalides");
        if (isBilingualSegments(segs)) {
          // Mode bilingue : on bypass le TrimEditor (le texte affiché c'est
          // la traduction, pas l'original — pas de découpage word-level FR).
          const prepared = segs.map(applyBilingualTranslation);
          const timed = buildTimedSegmentsFromSegments(prepared);
          setPendingSegments(prepared);
          setShowTrimEditor(false);
          setTimedSegments(timed);
          setTimingStatuses(buildTimingStatuses(timed.length, "estimated"));
          setCaptions(timedSegmentsToCaptions(timed));
          setHighlighted(new Map());
        } else {
          setPendingSegments(segs);
          setShowTrimEditor(true);
          setCaptions([]);
          setHighlighted(new Map());
          setTimedSegments(null);
          setTimingStatuses(null);
        }
        setSubsFile(null);
      })
      .catch(() => {
        setTranscriptionLoadError("Impossible de charger la transcription");
        setSelectedTranscriptionId(null);
      })
      .finally(() => setLoadingSource(false));
  }, [selectedTranscriptionId]);

  // Mode bilingue : statut détecté à partir des segments en cours.
  // Une transcription multilingue est éligible à la traduction si elle a au
  // moins un segment avec `language` détecté mais pas encore de `translation`.
  const bilingualStatus = useMemo((): "none" | "translatable" | "translated" => {
    const source = pendingSegments ?? timedSegments;
    if (!source || source.length === 0) return "none";
    const hasLanguage = source.some((s) => typeof s.language === "string" && s.language.length > 0);
    if (!hasLanguage) return "none";
    const hasTranslation = source.some((s) => typeof s.translation === "string" && s.translation.trim().length > 0);
    return hasTranslation ? "translated" : "translatable";
  }, [pendingSegments, timedSegments]);

  const triggerBilingualTranslation = async () => {
    if (!selectedTranscriptionId) return;
    // Guard synchrone : empêche un double-click pendant que setTranslating(true)
    // est encore en attente de commit. Sans cette ref, deux clicks rapides
    // peuvent enclencher deux requêtes Claude concurrentes (cf. bug-hunter).
    if (translatingRef.current) return;
    translatingRef.current = true;
    setTranslating(true);
    setTranslateError(null);
    // Si on est en mode "translated", c'est un retradaction explicite — bypass
    // le guard idempotent du serveur via ?force=1.
    const forceQuery = bilingualStatus === "translated" ? "?force=1" : "";
    try {
      const res = await fetch(`/api/transcription/${selectedTranscriptionId}/translate${forceQuery}`, {
        method: "POST",
      });
      if (!res.ok) {
        const errPayload = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(errPayload?.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { segments?: Segment[]; translated?: number; alreadyTranslated?: boolean };
      const fresh = payload.segments ?? [];
      if (!Array.isArray(fresh) || fresh.length === 0) {
        throw new Error("Réponse invalide du serveur");
      }
      const prepared = fresh.map(applyBilingualTranslation);
      const timed = buildTimedSegmentsFromSegments(prepared);
      setPendingSegments(prepared);
      setShowTrimEditor(false);
      setTimedSegments(timed);
      setTimingStatuses(buildTimingStatuses(timed.length, "estimated"));
      setCaptions(timedSegmentsToCaptions(timed));
      setHighlighted(new Map());
      if (payload.alreadyTranslated) {
        toast.success("Traductions déjà disponibles — rechargées.");
      } else {
        toast.success(`${payload.translated ?? prepared.length} segments traduits.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTranslateError(msg);
      toast.error(`Traduction impossible : ${msg}`);
    } finally {
      translatingRef.current = false;
      setTranslating(false);
    }
  };

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
    const presetLayout = (typeof preset.config.layout === "object" && preset.config.layout !== null)
      ? (preset.config.layout as Record<string, unknown>)
      : {};
    const configWithProfile = {
      ...preset.config,
      export_profile: "final",
      layout: { ...presetLayout, vertical_offset: effectiveVerticalOffset },
    };

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
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-2xl mx-auto">

        {/* F3-step7 — header extrait dans CaptionsHeader */}
        <CaptionsHeader presetName={preset.name} isRegen={Boolean(initialSrt)} />

        {/* V8.3 — Banner transcription auto-lancée / en cours pour le slot.
            La page server a déclenché triggerAutoTranscriptionForVersion ;
            le SSE listener ci-dessus refresh quand le job termine et les
            segments arrivent automatiquement (initialSegments pré-rempli). */}
        {pendingTranscription && (
          <div className="mb-3 rounded-xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[12px] backdrop-saturate-150 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(96,165,250,0.30)]">
            <p className="text-[13px] font-semibold text-sky-900 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              Transcription en cours…
            </p>
            <p className="text-[11px] text-sky-700/80 mt-0.5">
              Le sous-titrage démarre dès que la transcription est prête. La
              page se rafraîchira automatiquement.
            </p>
          </div>
        )}
        {transcriptionBlocker && (
          <div className="mb-3 rounded-xl bg-gradient-to-b from-rose-50/85 to-rose-50/55 backdrop-blur-[12px] backdrop-saturate-150 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(244,114,182,0.30)]">
            <p className="text-[13px] font-semibold text-rose-900">
              Impossible de pré-charger une transcription
            </p>
            <p className="text-[11px] text-rose-700/80 mt-0.5">{transcriptionBlocker}</p>
          </div>
        )}

        {/* F3-step6 — video upload extrait dans CaptionsVideoUploadBar */}
        <CaptionsVideoUploadBar videoFile={videoFile} setVideoFile={setVideoFile} />

        {/* Source card — Sous-titres */}
        <div className="bg-white/60 backdrop-blur-[6px] border border-white/50 rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] overflow-hidden mb-3">
          <div className="px-4 py-3 border-b border-white/40 flex items-center justify-between">
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

          {/* F3-step9 — 3 status blocks (trim / captions ready / subsFile)
              regroupés dans CaptionsSourceStatus */}
          <CaptionsSourceStatus
            showTrimEditor={showTrimEditor}
            captionsCount={captions.length}
            subsFile={subsFile}
            selectedTranscriptionId={selectedTranscriptionId}
            transcriptions={transcriptions}
            pendingSegmentsCount={pendingSegments?.length ?? 0}
          />
        </div>

        {/* Mode bilingue — banner après chargement d'une transcription traduite/à traduire.
            La chaîne auto post-transcription (cf. /transcriptions) traduit normalement
            sans intervention. Le bouton ici reste un fallback manuel si l'auto-config
            n'était pas activée à l'upload, ou pour retraduire après édition manuelle. */}
        {bilingualStatus !== "none" && selectedTranscriptionId && (
          <div className={`mb-3 rounded-2xl backdrop-blur-[10px] backdrop-saturate-150 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1)] ${
            bilingualStatus === "translated"
              ? "bg-gradient-to-b from-emerald-50/85 to-emerald-50/55 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.40)]"
              : "bg-gradient-to-b from-sky-50/85 to-sky-50/55 shadow-[inset_0_0_0_1px_rgba(125,180,210,0.32)]"
          }`}>
            <div className="flex items-start gap-3">
              <Languages className={`h-5 w-5 mt-0.5 shrink-0 ${
                bilingualStatus === "translated" ? "text-emerald-700" : "text-sky-700"
              }`} />
              <div className="flex-1 min-w-0">
                {bilingualStatus === "translated" ? (
                  <>
                    <p className="text-[13px] font-semibold text-emerald-900">
                      Traductions chargées
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-700/80">
                      Les segments traduits sont prêts. Vous pouvez les éditer ci-dessous,
                      ou relancer la traduction si nécessaire.
                    </p>
                    {translateError && (
                      <p className="mt-1 text-[11px] text-rose-700">{translateError}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold text-sky-900">
                      Traductions absentes
                    </p>
                    <p className="mt-0.5 text-[11px] text-sky-700/80">
                      Cette transcription n&apos;a pas été traduite automatiquement
                      (vous pouvez activer la chaîne auto depuis /transcriptions).
                      Lancez-la manuellement ci-contre.
                    </p>
                    {translateError && (
                      <p className="mt-1 text-[11px] text-rose-700">{translateError}</p>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => void triggerBilingualTranslation()}
                disabled={translating}
                className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  bilingualStatus === "translated"
                    ? "border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"
                    : "bg-sky-900 text-white hover:bg-sky-800"
                }`}
              >
                {translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                {translating
                  ? "Traduction…"
                  : bilingualStatus === "translated"
                    ? "Retraduire"
                    : "Lancer la traduction"}
              </button>
            </div>
          </div>
        )}

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
          <div className="bg-white/60 backdrop-blur-[6px] border border-white/50 rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] p-5 mb-3">
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

        {/* Décalage vertical — override per-génération du preset (sans modifier
            le preset partagé). Visible dès qu'un SRT est chargé. */}
        {!showTrimEditor && captions.length > 0 && (
          <div className="bg-white/60 backdrop-blur-[6px] border border-white/50 rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] p-4 mb-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="text-sm font-medium text-gray-900">
                Décalage vertical
                <span className="ml-2 text-[11px] font-mono text-gray-500 tabular-nums">
                  {effectiveVerticalOffset === 0
                    ? "Centre"
                    : `${effectiveVerticalOffset > 0 ? "+" : ""}${Math.round(effectiveVerticalOffset * 100)}%`}
                </span>
              </label>
              {verticalOffsetOverride !== null && (
                <button
                  type="button"
                  onClick={() => setVerticalOffsetOverride(null)}
                  className="text-[11px] text-gray-500 hover:text-gray-800"
                >
                  Réinitialiser (preset : {presetVerticalOffset === 0 ? "centre" : `${presetVerticalOffset > 0 ? "+" : ""}${Math.round(presetVerticalOffset * 100)}%`})
                </button>
              )}
            </div>
            <input
              type="range"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={effectiveVerticalOffset}
              onChange={(e) => setVerticalOffsetOverride(Number(e.target.value))}
              className="w-full accent-sage-600"
              aria-label="Décalage vertical des sous-titres"
            />
            <p className="text-[11px] text-gray-500 leading-snug mt-1">
              Négatif = remonte, positif = descend. Override appliqué uniquement
              à cette génération (le preset reste inchangé).
            </p>
          </div>
        )}

        {/* F3-step8 — generate button + hint + progress + status extraits */}
        {!showTrimEditor && <>
          <CaptionsGenerateButton
            canGenerate={canGenerate}
            busy={busy}
            message={message}
            renderProgress={renderProgress}
            hasVideoFile={Boolean(videoFile)}
            onGenerate={() => void handleGenerate()}
          />

          {/* F3-step5 — queue + lien retour extraits dans CaptionsJobQueue */}
          <CaptionsJobQueue jobs={jobs} returnTo={returnTo} busy={busy} />
        </>}
          </div>
        </div>
      </div>
    </div>
  );
}

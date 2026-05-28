"use client";

/**
 * ListingsClient — "Mon historique" en lecture seule.
 *
 * Refonte B6-v2 (2026-05-27) : timeline uniforme par onglet, retrait des
 * contrôles row-level (delete, regenerate, revert, cover gen, copy/expand
 * description) qui doublonnaient les pages détail (/renders/[id],
 * /captions/[id]/generate, /transcriptions/[id], /descriptions/[id]).
 *
 * Live updates conservés :
 *  - SSE jobBus pour captions/transcription (statuts en temps réel).
 *  - Polling toutes les 5s pour les renders PENDING/PROCESSING.
 *
 * Le filtre Admin par utilisateur reste, et chaque onglet expose un
 * compteur d'éléments filtrés.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Film,
  LayoutTemplate,
  Mic,
  AlignLeft,
  Image as ImageIcon,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderRow = {
  id: string;
  status: string;
  pngUrl: string | null;
  videoUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
  coverPack: { id: string; status: string } | null;
  /** Cover auto activée si le slot lié a un pattern avec coverMode=auto (Phase 1.8). */
  coverAutoEnabled: boolean;
};

export type ListingRow = {
  id: string;
  templateId: string | null;
  jsonData: string;
  createdAt: string;
  ownerName: string | null;
  template: { id: string; name: string; client: string | null; formats: string } | null;
  renders: RenderRow[];
};

export type GridItem = {
  id: string;
  createdAt: string;
  listing: ListingRow;
  render: RenderRow | null;
};

export type CaptionJobRow = {
  id: string;
  status: string;
  outputUrl: string | null;
  inputName: string | null;
  createdAt: string;
  ownerName: string | null;
  presetId: string | null;
  errorMsg: string | null;
};

export type TranscriptionJobRow = {
  id: string;
  status: string;
  inputFilename: string | null;
  model: string;
  language: string | null;
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  errorMsg: string | null;
  createdAt: string;
  ownerName: string | null;
};

export type DescriptionJobRow = {
  id: string;
  status: string;
  inputFilename: string | null;
  inputType: string;
  promptId: string | null;
  model: string;
  result: string | null;
  errorMsg: string | null;
  createdAt: string;
  ownerName: string | null;
  prompt: { name: string } | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDateGroup(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - itemDay.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays <= 7) return "Cette semaine";
  return "Plus tôt";
}

function groupByDate<T extends { createdAt: string }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const g = getDateGroup(item.createdAt);
    if (!groups[g]) groups[g] = [];
    groups[g].push(item);
  }
  return groups;
}

const GROUP_ORDER = ["Aujourd'hui", "Cette semaine", "Plus tôt"];

// ── Timeline entry shape ──────────────────────────────────────────────────────

type Tone = "indigo" | "violet" | "teal" | "sky";

interface TimelineEntry {
  id: string;
  icon: typeof Film;
  iconTone: Tone;
  title: string;
  sublabel: string | null;
  status: string;
  createdAt: string;
  href: string;
  ownerName?: string | null;
  /** Message d'erreur affiché sous la row quand status FAILED/ERROR. */
  errorMsg?: string | null;
}

const TONE_BG: Record<Tone, string> = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  teal: "bg-teal-50 text-teal-600",
  sky: "bg-sky-50 text-sky-600",
};

// Tab badge styles — classes statiques explicites (Tailwind purge ne supporte
// pas les interpolations dynamiques bg-${tone}-100).
const TAB_BADGE_ACTIVE: Record<Tone, string> = {
  indigo: "bg-indigo-100 text-indigo-600",
  violet: "bg-violet-100 text-violet-600",
  teal: "bg-teal-100 text-teal-600",
  sky: "bg-sky-100 text-sky-600",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente",
  QUEUED: "En file",
  PROCESSING: "En cours",
  RUNNING: "En cours",
  COMPLETED: "Terminé",
  DONE: "Terminé",
  FAILED: "Échec",
  ERROR: "Échec",
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const isInProgress = ["PENDING", "QUEUED", "PROCESSING", "RUNNING"].includes(status);
  const isDone = ["COMPLETED", "DONE"].includes(status);
  const isError = ["FAILED", "ERROR"].includes(status);

  const Icon = isInProgress ? Loader2 : isDone ? CheckCircle2 : isError ? AlertCircle : Clock;
  const cls = isInProgress
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : isDone
    ? "bg-green-50 text-green-700 border-green-200"
    : isError
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-gray-50 text-gray-600 border-gray-200";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon size={10} className={isInProgress ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const Icon = entry.icon;
  const isError = ["FAILED", "ERROR"].includes(entry.status);
  const showError = isError && entry.errorMsg;
  return (
    <Link
      href={entry.href}
      className={`group block rounded-xl border bg-white px-4 py-3 hover:shadow-sm transition-all ${
        isError ? "border-red-100 hover:border-red-300" : "border-gray-100 hover:border-indigo-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${TONE_BG[entry.iconTone]}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">{entry.title}</p>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {entry.sublabel ?? "—"}
            {entry.ownerName && <span className="ml-1.5">· {entry.ownerName}</span>}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-xs text-gray-400">
          <span className="hidden sm:inline">{formatDate(entry.createdAt)}</span>
          <ChevronRight size={14} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
        </div>
      </div>
      {showError && (
        <p className="mt-2 pl-12 text-xs text-red-600 line-clamp-2" title={entry.errorMsg ?? undefined}>
          {entry.errorMsg}
        </p>
      )}
    </Link>
  );
}

// ── Mapping data → timeline entries ───────────────────────────────────────────

function listingToEntry(item: GridItem): TimelineEntry {
  const template = item.listing.template;
  const titleBase = template?.name ?? "Template supprimé";
  const sublabelParts: string[] = [];
  if (template?.client) sublabelParts.push(template.client);
  if (item.render && template) {
    try {
      const formats = JSON.parse(template.formats) as string[];
      if (formats.length > 0) sublabelParts.push(formats.join(" · "));
    } catch {
      // Silent : formats parsing optionnel.
    }
  }
  return {
    id: item.id,
    icon: LayoutTemplate,
    iconTone: "indigo",
    title: titleBase,
    sublabel: sublabelParts.join(" · ") || null,
    status: item.render?.status ?? "PENDING",
    createdAt: item.createdAt,
    href: item.render ? `/renders/${item.render.id}` : `/templates`,
    ownerName: item.listing.ownerName,
  };
}

function captionToEntry(job: CaptionJobRow): TimelineEntry {
  return {
    id: job.id,
    icon: Film,
    iconTone: "violet",
    title: job.inputName ?? "Caption sans nom",
    sublabel: job.presetId ? `Preset ${job.presetId.slice(0, 8)}…` : null,
    status: job.status,
    createdAt: job.createdAt,
    href: job.presetId ? `/captions/${job.presetId}/generate?captionJobId=${job.id}` : "/captions",
    ownerName: job.ownerName,
    errorMsg: job.errorMsg,
  };
}

function transcriptionToEntry(job: TranscriptionJobRow): TimelineEntry {
  const parts: string[] = [job.model];
  if (job.language) parts.push(job.language);
  if (job.duration != null) parts.push(`${Math.round(job.duration)}s`);
  if (job.hasDiarization) parts.push("diarisation");
  return {
    id: job.id,
    icon: Mic,
    iconTone: "teal",
    title: job.inputFilename ?? "Transcription sans nom",
    sublabel: parts.join(" · ") || null,
    status: job.status,
    createdAt: job.createdAt,
    href: `/transcriptions/${job.id}`,
    ownerName: job.ownerName,
    errorMsg: job.errorMsg,
  };
}

function descriptionToEntry(job: DescriptionJobRow): TimelineEntry {
  const parts: string[] = [job.model];
  if (job.inputType) parts.push(job.inputType);
  if (job.prompt?.name) parts.push(job.prompt.name);
  return {
    id: job.id,
    icon: AlignLeft,
    iconTone: "sky",
    title: job.inputFilename ?? job.prompt?.name ?? "Description sans titre",
    sublabel: parts.join(" · ") || null,
    status: job.status,
    createdAt: job.createdAt,
    href: "/descriptions",
    ownerName: job.ownerName,
    errorMsg: job.errorMsg,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

type TabKey = "templates" | "captions" | "transcription" | "description";

export function ListingsClient({
  initialListings,
  initialCaptionJobs,
  initialTranscriptionJobs,
  initialDescriptionJobs,
  isAdmin,
  hasCaptions = false,
  hasTranscription = false,
  hasDescription = false,
}: {
  initialListings: ListingRow[];
  initialCaptionJobs: CaptionJobRow[];
  initialTranscriptionJobs: TranscriptionJobRow[];
  initialDescriptionJobs: DescriptionJobRow[];
  isAdmin: boolean;
  hasCaptions?: boolean;
  hasTranscription?: boolean;
  hasDescription?: boolean;
  /** Conservé pour compat de prop (B6 partiel) — non utilisé en v2 (cover gen retiré). */
  hasCovers?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("templates");
  const [userFilter, setUserFilter] = useState<string | null>(null);

  // ── Render states (live polling) ─────────────────────────────────────────
  const [renderStates, setRenderStates] = useState<Record<string, RenderRow>>(() => {
    const m: Record<string, RenderRow> = {};
    for (const l of initialListings) for (const r of l.renders) m[r.id] = r;
    return m;
  });
  const renderStatesRef = useRef(renderStates);
  useEffect(() => {
    renderStatesRef.current = renderStates;
  }, [renderStates]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const pendingRenders = Object.values(renderStatesRef.current).filter(
        (r) => r.status === "PROCESSING" || r.status === "PENDING",
      );
      await Promise.all(
        pendingRenders.map(async (r) => {
          try {
            const res = await fetch(`/api/renders/${r.id}`);
            if (!res.ok) return;
            const data = (await res.json()) as Partial<RenderRow> & { status: string };
            if (data.status !== renderStatesRef.current[r.id]?.status) {
              setRenderStates((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...data } }));
            }
          } catch {
            // Silent : polling tolérant
          }
        }),
      );
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // ── Caption / Transcription states (SSE live) ────────────────────────────
  const [captionStates, setCaptionStates] = useState<Record<string, CaptionJobRow>>(() => {
    const m: Record<string, CaptionJobRow> = {};
    for (const j of initialCaptionJobs) m[j.id] = j;
    return m;
  });

  const [transcriptionStates, setTranscriptionStates] = useState<Record<string, TranscriptionJobRow>>(() => {
    const m: Record<string, TranscriptionJobRow> = {};
    for (const j of initialTranscriptionJobs) m[j.id] = j;
    return m;
  });

  useAllJobEvents((event) => {
    if (event.jobType === "captions") {
      setCaptionStates((prev) => {
        if (!prev[event.jobId]) return prev;
        return {
          ...prev,
          [event.jobId]: {
            ...prev[event.jobId],
            status: event.status === "COMPLETED" ? "DONE" : event.status,
            outputUrl: typeof event.videoUrl === "string" ? event.videoUrl : prev[event.jobId].outputUrl,
          },
        };
      });
    } else if (event.jobType === "transcription") {
      setTranscriptionStates((prev) => {
        if (!prev[event.jobId]) return prev;
        return { ...prev, [event.jobId]: { ...prev[event.jobId], status: event.status } };
      });
    }
  });

  // ── Filtres ──────────────────────────────────────────────────────────────
  const allUsers = useMemo(() => {
    const names = new Set<string>();
    for (const l of initialListings) if (l.ownerName) names.add(l.ownerName);
    for (const j of initialCaptionJobs) if (j.ownerName) names.add(j.ownerName);
    for (const j of initialTranscriptionJobs) if (j.ownerName) names.add(j.ownerName);
    for (const j of initialDescriptionJobs) if (j.ownerName) names.add(j.ownerName);
    return Array.from(names).sort();
  }, [initialListings, initialCaptionJobs, initialTranscriptionJobs, initialDescriptionJobs]);

  const filteredListings = useMemo(
    () => (userFilter ? initialListings.filter((l) => l.ownerName === userFilter) : initialListings),
    [initialListings, userFilter],
  );
  const filteredCaptions = useMemo(
    () => (userFilter ? initialCaptionJobs.filter((j) => j.ownerName === userFilter) : initialCaptionJobs),
    [initialCaptionJobs, userFilter],
  );
  const filteredTranscriptions = useMemo(
    () => (userFilter ? initialTranscriptionJobs.filter((j) => j.ownerName === userFilter) : initialTranscriptionJobs),
    [initialTranscriptionJobs, userFilter],
  );
  const filteredDescriptions = useMemo(
    () => (userFilter ? initialDescriptionJobs.filter((j) => j.ownerName === userFilter) : initialDescriptionJobs),
    [initialDescriptionJobs, userFilter],
  );

  // ── Build flat lists of entries (one timeline entry per item) ────────────
  const listingEntries = useMemo<TimelineEntry[]>(() => {
    const items: GridItem[] = [];
    for (const listing of filteredListings) {
      const renders = listing.renders.map((r) => renderStates[r.id] ?? r);
      if (renders.length === 0) {
        items.push({ id: `listing-${listing.id}`, createdAt: listing.createdAt, listing, render: null });
      } else {
        for (const render of renders) {
          items.push({ id: render.id, createdAt: render.createdAt, listing, render });
        }
      }
    }
    return items
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(listingToEntry);
  }, [filteredListings, renderStates]);

  const captionEntries = useMemo<TimelineEntry[]>(
    () =>
      filteredCaptions
        .map((j) => captionStates[j.id] ?? j)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(captionToEntry),
    [filteredCaptions, captionStates],
  );

  const transcriptionEntries = useMemo<TimelineEntry[]>(
    () =>
      filteredTranscriptions
        .map((j) => transcriptionStates[j.id] ?? j)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(transcriptionToEntry),
    [filteredTranscriptions, transcriptionStates],
  );

  const descriptionEntries = useMemo<TimelineEntry[]>(
    () =>
      filteredDescriptions
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(descriptionToEntry),
    [filteredDescriptions],
  );

  const activeEntries: TimelineEntry[] =
    tab === "templates"
      ? listingEntries
      : tab === "captions"
      ? captionEntries
      : tab === "transcription"
      ? transcriptionEntries
      : descriptionEntries;

  const activeGroups = useMemo(() => groupByDate(activeEntries), [activeEntries]);
  const isEmpty = GROUP_ORDER.every((g) => !activeGroups[g]?.length);

  // ── Tab definitions ──────────────────────────────────────────────────────
  const tabs: { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[] = [
    { id: "templates", label: "Générations", count: filteredListings.length, tone: "indigo", show: true },
    { id: "captions", label: "Captions", count: filteredCaptions.length, tone: "violet", show: hasCaptions },
    { id: "transcription", label: "Transcriptions", count: filteredTranscriptions.length, tone: "teal", show: hasTranscription },
    { id: "description", label: "Descriptions", count: filteredDescriptions.length, tone: "sky", show: hasDescription },
  ].filter((t) => t.show) as { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[];

  const emptyConfig = {
    templates: { icon: LayoutTemplate, label: "Aucune génération pour l'instant", linkHref: "/templates", linkLabel: "Templates" },
    captions: { icon: Film, label: "Aucun caption généré", linkHref: "/captions", linkLabel: "Captions" },
    transcription: { icon: Mic, label: "Aucune transcription", linkHref: "/transcriptions", linkLabel: "Transcriptions" },
    description: { icon: AlignLeft, label: "Aucune description générée", linkHref: "/descriptions", linkLabel: "Descriptions" },
  } as const;
  const empty = emptyConfig[tab];
  const EmptyIcon = empty.icon;

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map((t) => {
          const active = tab === t.id;
          const badgeBg = active ? TAB_BADGE_ACTIVE[t.tone] : "bg-gray-200 text-gray-500";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badgeBg}`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Admin user filter pills */}
      {isAdmin && allUsers.length > 1 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            type="button"
            onClick={() => setUserFilter(null)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              userFilter === null
                ? "bg-gray-900 text-white border-gray-900"
                : "border-gray-200 text-gray-600 hover:border-gray-400"
            }`}
          >
            Tous
          </button>
          {allUsers.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setUserFilter(userFilter === name ? null : name)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                userFilter === name
                  ? "bg-gray-900 text-white border-gray-900"
                  : "border-gray-200 text-gray-600 hover:border-gray-400"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-24 text-gray-400">
          <EmptyIcon size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">{empty.label}</p>
          <p className="text-sm mt-1">
            Rendez-vous dans{" "}
            <Link href={empty.linkHref} className="text-indigo-600 hover:underline">
              {empty.linkLabel}
            </Link>
          </p>
        </div>
      )}

      {/* Date groups — uniform timeline */}
      <div className="space-y-10">
        {GROUP_ORDER.filter((g) => activeGroups[g]?.length).map((group) => (
          <section key={group}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide shrink-0">{group}</h2>
              <div className="flex-1 border-t border-gray-100" />
            </div>
            <div className="space-y-2">
              {activeGroups[group]!.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Pagination hint : si on a hit la limite serveur (50), avertir l'user
          qu'il y a probablement d'autres items plus anciens. Vraie pagination
          déferrée (chantier dédié — modif page.tsx server + URL params). */}
      {!isEmpty && activeEntries.length >= 50 && (
        <p className="mt-6 text-center text-[11px] text-amber-600">
          Affichage des 50 plus récents — les éléments plus anciens ne sont pas
          listés ici. Ouvrez la page détail d&apos;un élément pour la traçabilité complète.
        </p>
      )}

      {/* Bandeau "lecture seule" pour rappeler que les actions se font sur les pages détail */}
      {!isEmpty && (
        <p className="mt-4 text-center text-[11px] text-gray-400">
          <ImageIcon size={11} className="inline-block mr-1 align-text-bottom" />
          Cliquez sur un élément pour ouvrir la page détail (regénération, suppression et actions y sont disponibles).
        </p>
      )}
    </div>
  );
}

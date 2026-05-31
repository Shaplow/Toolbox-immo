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
  Clapperboard,
  Mic,
  AlignLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
} from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
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

// Phase B refonte 2026-05-30 — palette Coastal Studio v2 par type de job.
// peach = création vidéo (renders), sky = sous-titres (captions),
// sage = parole / transcription, rose = génération texte long (descriptions).
type Tone = "peach" | "sky" | "sage" | "rose";

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

const TONE_ICON_BG: Record<Tone, string> = {
  peach: "bg-peach-100/70 text-peach-700",
  sky:   "bg-sky-100/70 text-sky-700",
  sage:  "bg-sage-100/70 text-sage-700",
  rose:  "bg-rose-100/70 text-rose-700",
};

// Bord gauche signature glass v2 — apparaît en <span> absolute dans TimelineRow
// (pas en `border-l` classique pour ne pas casser le padding sticky col).
const TONE_LEFT_BAR: Record<Tone, string> = {
  peach: "bg-peach-400",
  sky:   "bg-sky-400",
  sage:  "bg-sage-400",
  rose:  "bg-rose-400",
};

// Tab badge styles — classes statiques explicites (Tailwind purge ne supporte
// pas les interpolations dynamiques bg-${tone}-100).
const TAB_BADGE_ACTIVE: Record<Tone, string> = {
  peach: "bg-peach-100 text-peach-700",
  sky:   "bg-sky-100 text-sky-700",
  sage:  "bg-sage-100 text-sage-700",
  rose:  "bg-rose-100 text-rose-700",
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
  // Glass v2 pastilles — backdrop-blur + ring inset signature au lieu de border solide.
  const cls = isInProgress
    ? "bg-peach-50/70 text-peach-700 shadow-[inset_0_0_0_1px_rgba(221,140,90,0.22)]"
    : isDone
    ? "bg-sage-50/70 text-sage-700 shadow-[inset_0_0_0_1px_rgba(111,162,128,0.22)]"
    : isError
    ? "bg-rose-50/70 text-rose-700 shadow-[inset_0_0_0_1px_rgba(201,113,133,0.28)]"
    : "bg-white/60 text-gray-600 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full backdrop-blur-[6px] px-2 py-0.5 text-[10.5px] font-medium ${cls}`}>
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
      className="group relative block rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.10),0_4px_12px_-4px_rgba(15,23,42,0.10),0_12px_28px_-12px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 transition-all overflow-hidden pl-4 pr-3.5 py-3"
    >
      {/* Bord gauche signature couleur par type (3px) — span absolute pour ne
          pas perturber le calcul du padding et permettre l'effet hover smooth. */}
      <span className={`absolute inset-y-2.5 left-0 w-[3px] rounded-r-full ${TONE_LEFT_BAR[entry.iconTone]}`} />
      <div className="flex items-center gap-3">
        <div className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.04)] ${TONE_ICON_BG[entry.iconTone]}`}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-gray-950 truncate">{entry.title}</p>
            <StatusBadge status={entry.status} />
          </div>
          <p className="text-[11.5px] text-gray-500 mt-0.5 truncate">
            {entry.sublabel ?? "—"}
            {entry.ownerName && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-gray-400">
                <span className="text-gray-300">·</span> {entry.ownerName}
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px] text-gray-400">
          <span className="hidden sm:inline tabular-nums">{formatDate(entry.createdAt)}</span>
          <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-700 transition-colors" />
        </div>
      </div>
      {showError && (
        <p className="mt-2 pl-12 text-[11.5px] text-rose-700 line-clamp-2" title={entry.errorMsg ?? undefined}>
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
    icon: Clapperboard,
    iconTone: "peach",
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
    iconTone: "sky",
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
    iconTone: "sage",
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
    iconTone: "rose",
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
  const [search, setSearch] = useState("");
  // Filtre status : "all" | "in_progress" | "done" | "failed".
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "done" | "failed">("all");

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

  const rawEntries: TimelineEntry[] =
    tab === "templates"
      ? listingEntries
      : tab === "captions"
      ? captionEntries
      : tab === "transcription"
      ? transcriptionEntries
      : descriptionEntries;

  const activeEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawEntries.filter((e) => {
      if (statusFilter === "in_progress" && !["PENDING", "QUEUED", "PROCESSING", "RUNNING"].includes(e.status)) return false;
      if (statusFilter === "done" && !["COMPLETED", "DONE"].includes(e.status)) return false;
      if (statusFilter === "failed" && !["FAILED", "ERROR"].includes(e.status)) return false;
      if (q) {
        const haystack = [e.title, e.sublabel ?? "", e.ownerName ?? ""].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rawEntries, search, statusFilter]);

  const activeGroups = useMemo(() => groupByDate(activeEntries), [activeEntries]);
  const isEmpty = GROUP_ORDER.every((g) => !activeGroups[g]?.length);

  // ── Tab definitions ──────────────────────────────────────────────────────
  const tabs: { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[] = [
    { id: "templates", label: "Générations", count: filteredListings.length, tone: "peach", show: true },
    { id: "captions", label: "Captions", count: filteredCaptions.length, tone: "sky", show: hasCaptions },
    { id: "transcription", label: "Transcriptions", count: filteredTranscriptions.length, tone: "sage", show: hasTranscription },
    { id: "description", label: "Descriptions", count: filteredDescriptions.length, tone: "rose", show: hasDescription },
  ].filter((t) => t.show) as { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[];

  const emptyConfig = {
    templates: { icon: Clapperboard, label: "Aucune génération pour l'instant", linkHref: "/templates", linkLabel: "Studio" },
    captions: { icon: Film, label: "Aucun caption généré", linkHref: "/captions", linkLabel: "Captions" },
    transcription: { icon: Mic, label: "Aucune transcription", linkHref: "/transcriptions", linkLabel: "Transcriptions" },
    description: { icon: AlignLeft, label: "Aucune description générée", linkHref: "/descriptions", linkLabel: "Descriptions" },
  } as const;
  const empty = emptyConfig[tab];
  const EmptyIcon = empty.icon;

  return (
    <div>
      {/* Toolbar glass v2 : tabs + filtres (search / status / user admin) */}
      <div className="mb-6 rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] p-3 space-y-3">
        {/* Tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {tabs.map((t) => {
            const active = tab === t.id;
            const badgeBg = active ? TAB_BADGE_ACTIVE[t.tone] : "bg-white/60 text-gray-500";
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12.5px] font-medium transition-all ${
                  active
                    ? "bg-gradient-to-b from-white/95 to-white/70 backdrop-blur-[8px] text-gray-950 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_-2px_rgba(15,23,42,0.06)]"
                    : "text-gray-500 hover:text-gray-900 hover:bg-white/50"
                }`}
              >
                {t.label}
                <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${badgeBg}`}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {/* Filtres : search + status chips + user admin */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] max-w-[320px]">
            <Input value={search} onChange={setSearch} placeholder="Rechercher (titre, template, user)" icon={Search} />
          </div>
          <div className="inline-flex items-center gap-1">
            {([
              { id: "all", label: "Tous" },
              { id: "in_progress", label: "En cours" },
              { id: "done", label: "Terminés" },
              { id: "failed", label: "Échec" },
            ] as const).map((s) => (
              <Chip
                key={s.id}
                variant={statusFilter === s.id ? "sky" : "default"}
                selected={statusFilter === s.id}
                onClick={() => setStatusFilter(s.id)}
                size="sm"
              >
                {s.label}
              </Chip>
            ))}
          </div>
          {isAdmin && allUsers.length > 0 && (
            <div className="w-[200px]">
              <Combobox
                value={userFilter ?? ""}
                onChange={(v) => setUserFilter(v || null)}
                options={[
                  { value: "", label: "Tous les users" },
                  ...allUsers.map((n) => ({ value: n, label: n })),
                ]}
                placeholder="Filtrer par user"
                emptyMessage="Aucun user"
              />
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-20 rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/70 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-gray-400 mb-3">
            <EmptyIcon size={20} />
          </div>
          <p className="text-[14px] font-semibold text-gray-700">{empty.label}</p>
          <p className="mt-1 text-[12.5px] text-gray-500">
            {search || statusFilter !== "all" || userFilter ? (
              <button type="button" onClick={() => { setSearch(""); setStatusFilter("all"); setUserFilter(null); }} className="text-sky-700 hover:text-sky-900 transition-colors">
                Réinitialiser les filtres
              </button>
            ) : (
              <>
                Rendez-vous dans{" "}
                <Link href={empty.linkHref} className="text-sky-700 hover:text-sky-900 transition-colors">
                  {empty.linkLabel}
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {/* Date groups — uniform timeline avec headers sticky glass */}
      <div className="space-y-8">
        {GROUP_ORDER.filter((g) => activeGroups[g]?.length).map((group) => (
          <section key={group}>
            <div className="flex items-center gap-3 mb-3 sticky top-2 z-10">
              <h2 className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur-[10px] text-[10px] font-semibold text-gray-600 uppercase tracking-widest shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] shrink-0">
                {group}
                <span className="tabular-nums text-gray-400">({activeGroups[group]!.length})</span>
              </h2>
              <div className="flex-1 border-t border-white/40" />
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
        <p className="mt-6 text-center text-[11px] text-peach-600">
          Affichage des 50 plus récents — les éléments plus anciens ne sont pas
          listés ici. Ouvrez la page détail d&apos;un élément pour la traçabilité complète.
        </p>
      )}

      {/* Bandeau "lecture seule" pour rappeler que les actions se font sur les pages détail */}
      {!isEmpty && (
        <p className="mt-4 text-center text-[11px] text-gray-400">
          Cliquez sur un élément pour ouvrir la page détail (regénération, suppression et actions y sont disponibles).
        </p>
      )}
    </div>
  );
}

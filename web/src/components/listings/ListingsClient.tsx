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
import { useRouter } from "next/navigation";
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
  Eye,
  Download,
  RotateCw,
  ImageIcon,
} from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { Pagination } from "@/components/ui/Pagination";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { RenderQuickView, type QuickViewRender } from "./RenderQuickView";
import { DeleteListingButton } from "./DeleteListingButton";

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
  /** Slot auquel ce render est rattaché — bloque la suppression admin depuis /listings. */
  linkedSlotId: string | null;
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

export type CoverPackRow = {
  id: string;
  /** QUEUED | PROCESSING | READY | SELECTED | FAILED */
  status: string;
  finalCoverUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
  ownerName: string | null;
  templateName: string | null;
  /** Slot lié si pack rattaché via render ou publicationVersion. */
  slotId: string | null;
  slotTitle: string | null;
  accountHandle: string | null;
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
// sage = parole / transcription, rose = génération texte long (descriptions),
// amber = covers / images (cohérent avec ImageIcon des sections cover).
type Tone = "peach" | "sky" | "sage" | "rose" | "amber";

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
  /** Actions inline disponibles (tab Générations uniquement). */
  rowActions?: {
    templateId: string | null;
    listingId: string;
    renders: QuickViewRender[];
    initialRenderId: string;
    downloadUrl: string | null;
    downloadExt: string | null;
    quickViewTitle: string;
    /** Croix de suppression admin — false si un render du listing est lié à un slot. */
    canDelete: boolean;
  };
}

const TONE_ICON_BG: Record<Tone, string> = {
  peach: "bg-peach-100/70 text-peach-700",
  sky:   "bg-sky-100/70 text-sky-700",
  sage:  "bg-sage-100/70 text-sage-700",
  rose:  "bg-rose-100/70 text-rose-700",
  amber: "bg-amber-100/70 text-amber-700",
};

// Bord gauche signature glass v2 — apparaît en <span> absolute dans TimelineRow
// (pas en `border-l` classique pour ne pas casser le padding sticky col).
const TONE_LEFT_BAR: Record<Tone, string> = {
  peach: "bg-peach-400",
  sky:   "bg-sky-400",
  sage:  "bg-sage-400",
  rose:  "bg-rose-400",
  amber: "bg-amber-400",
};

// Tab badge styles — classes statiques explicites (Tailwind purge ne supporte
// pas les interpolations dynamiques bg-${tone}-100).
const TAB_BADGE_ACTIVE: Record<Tone, string> = {
  peach: "bg-peach-100 text-peach-700",
  sky:   "bg-sky-100 text-sky-700",
  sage:  "bg-sage-100 text-sage-700",
  rose:  "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "En attente",
  QUEUED: "En file",
  PROCESSING: "En cours",
  RUNNING: "En cours",
  COMPLETED: "Terminé",
  DONE: "Terminé",
  READY: "Prêt",
  SELECTED: "Sélectionné",
  FAILED: "Échec",
  ERROR: "Échec",
};

// Helpers status groupés — partagés par StatusBadge et les filtres pour
// rester cohérents quand on ajoute un nouveau status (ex: READY/SELECTED des
// cover packs).
const STATUS_IN_PROGRESS = new Set(["PENDING", "QUEUED", "PROCESSING", "RUNNING"]);
const STATUS_DONE = new Set(["COMPLETED", "DONE", "READY", "SELECTED"]);
const STATUS_ERROR = new Set(["FAILED", "ERROR"]);

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const isInProgress = STATUS_IN_PROGRESS.has(status);
  const isDone = STATUS_DONE.has(status);
  const isError = STATUS_ERROR.has(status);

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

function TimelineRow({
  entry,
  onQuickView,
}: {
  entry: TimelineEntry;
  onQuickView?: (entry: TimelineEntry) => void;
}) {
  const router = useRouter();
  const Icon = entry.icon;
  const isError = ["FAILED", "ERROR"].includes(entry.status);
  const showError = isError && entry.errorMsg;
  const actions = entry.rowActions;
  const canRegen = !!actions?.templateId;
  const canDownload = !!actions?.downloadUrl;
  const canQuickView = !!actions && actions.renders.length > 0;
  const canDelete = !!actions?.canDelete;

  // Helper pour intercepter les clics sur les actions sans déclencher la
  // navigation outer du <Link>.
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

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
            {actions && actions.renders.length > 1 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-peach-50/70 text-peach-700 shadow-[inset_0_0_0_1px_rgba(221,140,90,0.22)] tabular-nums">
                {actions.renders.length} variantes
              </span>
            )}
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
        {/* Actions inline + date + chevron */}
        <div className="shrink-0 flex items-center gap-1 text-[11px] text-gray-400">
          {(canQuickView || canRegen || canDownload || canDelete) && (
            <div className="flex items-center gap-0.5 mr-1">
              {canQuickView && (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    onQuickView?.(entry);
                  }}
                  title="Vue rapide"
                  aria-label="Vue rapide"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:text-gray-900 hover:bg-white/70 transition-all focus-ring"
                >
                  <Eye size={13} />
                </button>
              )}
              {canRegen && (
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    router.push(
                      `/generate/${actions!.templateId}?listingId=${actions!.listingId}`,
                    );
                  }}
                  title="Régénérer"
                  aria-label="Régénérer"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:text-peach-700 hover:bg-white/70 transition-all focus-ring"
                >
                  <RotateCw size={13} />
                </button>
              )}
              {canDownload && (
                <a
                  href={actions!.downloadUrl!}
                  download
                  onClick={(e) => e.stopPropagation()}
                  title={`Télécharger ${actions!.downloadExt?.toUpperCase() ?? ""}`}
                  aria-label="Télécharger"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:text-gray-900 hover:bg-white/70 transition-all focus-ring"
                >
                  <Download size={13} />
                </a>
              )}
              {canDelete && <DeleteListingButton listingId={actions!.listingId} />}
            </div>
          )}
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

function listingToEntry(
  item: GridItem,
  allListingRenders: RenderRow[],
  isAdmin: boolean,
): TimelineEntry {
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

  // Actions inline : on n'expose les variantes que parmi les renders terminés
  // qui ont un media. Téléchargement pointe sur le render courant (vidéo en
  // priorité, sinon image).
  const playableRenders: QuickViewRender[] = allListingRenders
    .filter((r) => r.pngUrl || r.videoUrl)
    .map((r) => ({
      id: r.id,
      status: r.status,
      pngUrl: r.pngUrl,
      videoUrl: r.videoUrl,
    }));

  const currentRender = item.render;
  const downloadUrl = currentRender?.videoUrl ?? currentRender?.pngUrl ?? null;
  const downloadExt = currentRender?.videoUrl
    ? "mp4"
    : currentRender?.pngUrl
      ? "png"
      : null;

  // Suppression possible si admin ET aucun render du listing n'est rattaché
  // à un slot — sinon la suppression doit passer par la fiche de publication
  // (sinon on viderait silencieusement la production d'une mission active).
  // Les listings sans renders (cas dégénéré) restent supprimables par l'admin.
  const canDelete =
    isAdmin && allListingRenders.every((r) => !r.linkedSlotId);

  const rowActions: TimelineEntry["rowActions"] = currentRender
    ? {
        templateId: template?.id ?? null,
        listingId: item.listing.id,
        renders: playableRenders,
        initialRenderId: currentRender.id,
        downloadUrl,
        downloadExt,
        quickViewTitle: titleBase,
        canDelete,
      }
    : undefined;

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
    rowActions,
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

function coverPackToEntry(pack: CoverPackRow): TimelineEntry {
  const parts: string[] = [];
  if (pack.templateName) parts.push(pack.templateName);
  if (pack.accountHandle) parts.push(`@${pack.accountHandle}`);
  // Si lié à un slot : ouvrir la sous-route cover de la publication. Sinon,
  // fallback /tools/cover (cas pack standalone créé directement depuis l'outil).
  const href = pack.slotId
    ? `/publications/${pack.slotId}/cover`
    : "/tools/cover";
  return {
    id: pack.id,
    icon: ImageIcon,
    iconTone: "amber",
    title: pack.slotTitle ?? pack.templateName ?? "Cover sans nom",
    sublabel: parts.join(" · ") || null,
    status: pack.status,
    createdAt: pack.createdAt,
    href,
    ownerName: pack.ownerName,
    errorMsg: pack.errorMsg,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

type TabKey = "templates" | "captions" | "transcription" | "description" | "covers";

const PAGE_SIZE = 20;

export function ListingsClient({
  initialListings,
  initialCaptionJobs,
  initialTranscriptionJobs,
  initialDescriptionJobs,
  initialCoverPacks,
  isAdmin,
  hasCaptions = false,
  hasTranscription = false,
  hasDescription = false,
  hasCovers = false,
}: {
  initialListings: ListingRow[];
  initialCaptionJobs: CaptionJobRow[];
  initialTranscriptionJobs: TranscriptionJobRow[];
  initialDescriptionJobs: DescriptionJobRow[];
  initialCoverPacks: CoverPackRow[];
  isAdmin: boolean;
  hasCaptions?: boolean;
  hasTranscription?: boolean;
  hasDescription?: boolean;
  hasCovers?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("templates");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Filtre status : "all" | "in_progress" | "done" | "failed".
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "done" | "failed">("all");
  // Modal de prévisualisation rapide (tab Générations uniquement).
  const [quickViewEntry, setQuickViewEntry] = useState<TimelineEntry | null>(null);

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
    for (const p of initialCoverPacks) if (p.ownerName) names.add(p.ownerName);
    return Array.from(names).sort();
  }, [initialListings, initialCaptionJobs, initialTranscriptionJobs, initialDescriptionJobs, initialCoverPacks]);

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
  const filteredCoverPacks = useMemo(
    () => (userFilter ? initialCoverPacks.filter((p) => p.ownerName === userFilter) : initialCoverPacks),
    [initialCoverPacks, userFilter],
  );

  // ── Build flat lists of entries (one timeline entry per item) ────────────
  const listingEntries = useMemo<TimelineEntry[]>(() => {
    const items: (GridItem & { allRenders: RenderRow[] })[] = [];
    for (const listing of filteredListings) {
      const renders = listing.renders.map((r) => renderStates[r.id] ?? r);
      if (renders.length === 0) {
        items.push({
          id: `listing-${listing.id}`,
          createdAt: listing.createdAt,
          listing,
          render: null,
          allRenders: [],
        });
      } else {
        for (const render of renders) {
          items.push({
            id: render.id,
            createdAt: render.createdAt,
            listing,
            render,
            allRenders: renders,
          });
        }
      }
    }
    return items
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => listingToEntry(item, item.allRenders, isAdmin));
  }, [filteredListings, renderStates, isAdmin]);

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

  const coverEntries = useMemo<TimelineEntry[]>(
    () =>
      filteredCoverPacks
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(coverPackToEntry),
    [filteredCoverPacks],
  );

  const rawEntries: TimelineEntry[] =
    tab === "templates"
      ? listingEntries
      : tab === "captions"
      ? captionEntries
      : tab === "transcription"
      ? transcriptionEntries
      : tab === "covers"
      ? coverEntries
      : descriptionEntries;

  const activeEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawEntries.filter((e) => {
      if (statusFilter === "in_progress" && !STATUS_IN_PROGRESS.has(e.status)) return false;
      if (statusFilter === "done" && !STATUS_DONE.has(e.status)) return false;
      if (statusFilter === "failed" && !STATUS_ERROR.has(e.status)) return false;
      if (q) {
        const haystack = [e.title, e.sublabel ?? "", e.ownerName ?? ""].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rawEntries, search, statusFilter]);

  // ── Pagination client-side ────────────────────────────────────────────────
  // Une page courante distincte par tab : on garde la position quand l'user
  // bascule d'un tab à l'autre puis revient. Reset auto à 1 quand le set
  // visible change (filtre status/search/user).
  const [pageByTab, setPageByTab] = useState<Record<TabKey, number>>({
    templates: 1, captions: 1, transcription: 1, description: 1, covers: 1,
  });
  const page = pageByTab[tab] ?? 1;
  const setPage = (n: number) => setPageByTab((prev) => ({ ...prev, [tab]: n }));

  // Reset la page courante quand l'ensemble visible change (les filtres).
  // Stocke la signature à laquelle on a déjà appliqué le reset pour ne pas
  // boucler ni écraser une nav explicite de l'user.
  const filterSignature = `${tab}|${search}|${statusFilter}|${userFilter ?? ""}`;
  const lastResetSignature = useRef(filterSignature);
  useEffect(() => {
    if (lastResetSignature.current !== filterSignature) {
      lastResetSignature.current = filterSignature;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPageByTab((prev) => ({ ...prev, [tab]: 1 }));
    }
  }, [filterSignature, tab]);

  const totalEntries = activeEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = useMemo(
    () => activeEntries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [activeEntries, safePage],
  );

  const activeGroups = useMemo(() => groupByDate(pagedEntries), [pagedEntries]);
  const isEmpty = GROUP_ORDER.every((g) => !activeGroups[g]?.length);

  // ── Tab definitions ──────────────────────────────────────────────────────
  const tabs: { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[] = [
    { id: "templates", label: "Générations", count: filteredListings.length, tone: "peach", show: true },
    { id: "covers", label: "Covers", count: filteredCoverPacks.length, tone: "amber", show: hasCovers },
    { id: "captions", label: "Captions", count: filteredCaptions.length, tone: "sky", show: hasCaptions },
    { id: "transcription", label: "Transcriptions", count: filteredTranscriptions.length, tone: "sage", show: hasTranscription },
    { id: "description", label: "Descriptions", count: filteredDescriptions.length, tone: "rose", show: hasDescription },
  ].filter((t) => t.show) as { id: TabKey; label: string; count: number; tone: Tone; show: boolean }[];

  const emptyConfig = {
    templates: { icon: Clapperboard, label: "Aucune génération pour l'instant", linkHref: "/templates", linkLabel: "Studio" },
    captions: { icon: Film, label: "Aucun caption généré", linkHref: "/captions", linkLabel: "Captions" },
    transcription: { icon: Mic, label: "Aucune transcription", linkHref: "/transcriptions", linkLabel: "Transcriptions" },
    description: { icon: AlignLeft, label: "Aucune description générée", linkHref: "/descriptions", linkLabel: "Descriptions" },
    covers: { icon: ImageIcon, label: "Aucune cover générée", linkHref: "/tools/cover", linkLabel: "Cover" },
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
                <TimelineRow
                  key={entry.id}
                  entry={entry}
                  onQuickView={setQuickViewEntry}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Pagination client-side — visible quand au moins 2 pages, sous la
          timeline (au-dessus du bandeau hint). */}
      {!isEmpty && totalPages > 1 && (
        <div className="mt-6 flex justify-center">
          <Pagination
            page={safePage}
            total={totalEntries}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            showRange
          />
        </div>
      )}


      {/* Modal de prévisualisation rapide (œil sur une row de génération).
          key= initialRenderId pour que l'index interne se reset proprement
          quand on change de render initial sans fermer le modal entre temps. */}
      {quickViewEntry?.rowActions && (
        <RenderQuickView
          key={quickViewEntry.rowActions.initialRenderId}
          open={!!quickViewEntry}
          onClose={() => setQuickViewEntry(null)}
          title={quickViewEntry.rowActions.quickViewTitle}
          templateId={quickViewEntry.rowActions.templateId}
          listingId={quickViewEntry.rowActions.listingId}
          renders={quickViewEntry.rowActions.renders}
          initialRenderId={quickViewEntry.rowActions.initialRenderId}
        />
      )}
    </div>
  );
}

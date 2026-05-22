"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Film, RefreshCw, Download, LayoutTemplate, Mic, AlignLeft, Copy, Check, X, RotateCcw, Image as ImageIcon } from "lucide-react";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { toast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderRow = {
  id: string;
  status: string;
  pngUrl: string | null;
  videoUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
  coverPack: { id: string; status: string } | null;
};

export type ListingRow = {
  id: string;
  templateId: string | null;
  jsonData: string;
  createdAt: string;
  ownerName: string | null;
  template: { id: string; name: string; client: string | null; formats: string; coverAutoEnabled: boolean } | null;
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

function isStale(createdAt: string, thresholdMs = 60 * 60 * 1000): boolean {
  return Date.now() - new Date(createdAt).getTime() > thresholdMs;
}

function staleDuration(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}j`;
  if (h >= 1) return `${h}h`;
  return "<1h";
}

// ── Main component ────────────────────────────────────────────────────────────

export function ListingsClient({
  initialListings,
  initialCaptionJobs,
  initialTranscriptionJobs,
  initialDescriptionJobs,
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
  isAdmin: boolean;
  hasCaptions?: boolean;
  hasTranscription?: boolean;
  hasDescription?: boolean;
  hasCovers?: boolean;
}) {
  const [tab, setTab] = useState<"templates" | "captions" | "transcription" | "description">("templates");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const router = useRouter();
  // Flat map of render states keyed by renderId
  const [renderStates, setRenderStates] = useState<Record<string, RenderRow>>(() => {
    const m: Record<string, RenderRow> = {};
    for (const l of initialListings) for (const r of l.renders) m[r.id] = r;
    return m;
  });
  const renderStatesRef = useRef(renderStates);
  useEffect(() => {
    renderStatesRef.current = renderStates;
  }, [renderStates]);

  const [deletedRenderIds, setDeletedRenderIds] = useState<Set<string>>(new Set());
  const [deletedCaptionJobIds, setDeletedCaptionJobIds] = useState<Set<string>>(new Set());
  const [deletedTranscriptionJobIds, setDeletedTranscriptionJobIds] = useState<Set<string>>(new Set());
  const [deletedDescriptionJobIds, setDeletedDescriptionJobIds] = useState<Set<string>>(new Set());
  const [coverBusyRenderId, setCoverBusyRenderId] = useState<string | null>(null);

  const handleDeleteRender = async (renderId: string) => {
    await fetch(`/api/renders/${renderId}`, { method: "DELETE" });
    setDeletedRenderIds((prev) => new Set([...prev, renderId]));
    router.refresh();
  };

  const handleRevertRenderUsage = async (renderId: string): Promise<{ warnings: string[]; cursors: { libraryId: string; reverted: boolean; skippedReason?: string }[] }> => {
    const res = await fetch(`/api/admin/renders/${renderId}/revert-usage`, { method: "POST" });
    const data = await res.json() as { assets?: unknown[]; cursors?: { libraryId: string; reverted: boolean; skippedReason?: string }[]; warnings?: string[]; error?: string };
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Erreur inconnue");
    return { warnings: data.warnings ?? [], cursors: data.cursors ?? [] };
  };

  const handleGenerateCover = async (renderId: string) => {
    setCoverBusyRenderId(renderId);
    try {
      const res = await fetch(`/api/renders/${renderId}/cover`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as { error?: string; packId?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur génération cover");
      toast.success("Préparation cover lancée.");
      router.push("/tools/cover");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur génération cover");
    } finally {
      setCoverBusyRenderId(null);
    }
  };

  const handleDeleteCaptionJob = async (jobId: string) => {
    await fetch(`/api/render/captions/${jobId}`, { method: "DELETE" });
    setDeletedCaptionJobIds((prev) => new Set([...prev, jobId]));
    router.refresh();
  };

  const handleDeleteTranscriptionJob = async (jobId: string) => {
    await fetch(`/api/transcription/${jobId}`, { method: "DELETE" });
    setDeletedTranscriptionJobIds((prev) => new Set([...prev, jobId]));
    router.refresh();
  };

  const handleDeleteDescriptionJob = async (jobId: string) => {
    setDeletedDescriptionJobIds((prev) => new Set([...prev, jobId]));
    router.refresh();
  };

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

  // SSE fast path — captions and transcription updated instantly via webhook
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

  useEffect(() => {
    const timer = setInterval(async () => {
      const pendingRenders = Object.values(renderStatesRef.current).filter(
        (r) => r.status === "PROCESSING" || r.status === "PENDING"
      );
      await Promise.all(
        pendingRenders.map(async (r) => {
          try {
            const res = await fetch(`/api/renders/${r.id}`);
            if (!res.ok) return;
            const data = await res.json() as Partial<RenderRow> & { status: string };
            if (data.status !== renderStatesRef.current[r.id]?.status) {
              setRenderStates((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...data } }));
            }
          } catch { /* ignore */ }
        })
      );
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Admin: unique user names for filter pills
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
    [initialListings, userFilter]
  );

  const filteredCaptions = useMemo(
    () =>
      (userFilter ? initialCaptionJobs.filter((j) => j.ownerName === userFilter) : initialCaptionJobs).filter(
        (j) => !deletedCaptionJobIds.has(j.id)
      ),
    [initialCaptionJobs, userFilter, deletedCaptionJobIds]
  );

  const filteredTranscriptions = useMemo(
    () =>
      (userFilter ? initialTranscriptionJobs.filter((j) => j.ownerName === userFilter) : initialTranscriptionJobs).filter(
        (j) => !deletedTranscriptionJobIds.has(j.id)
      ),
    [initialTranscriptionJobs, userFilter, deletedTranscriptionJobIds]
  );

  const filteredDescriptions = useMemo(
    () =>
      (userFilter ? initialDescriptionJobs.filter((j) => j.ownerName === userFilter) : initialDescriptionJobs).filter(
        (j) => !deletedDescriptionJobIds.has(j.id)
      ),
    [initialDescriptionJobs, userFilter, deletedDescriptionJobIds]
  );

  const descriptionGroups = useMemo(() => groupByDate(filteredDescriptions), [filteredDescriptions]);

  const listingGridItems = useMemo((): GridItem[] => {
    const items: GridItem[] = [];
    for (const listing of filteredListings) {
      const renders = listing.renders
        .map((r) => renderStates[r.id] ?? r)
        .filter((r) => !deletedRenderIds.has(r.id));
      if (renders.length === 0) {
        items.push({ id: `listing-${listing.id}`, createdAt: listing.createdAt, listing, render: null });
      } else {
        for (const render of renders) {
          items.push({ id: render.id, createdAt: render.createdAt, listing, render });
        }
      }
    }
    return items;
  }, [filteredListings, renderStates, deletedRenderIds]);

  const listingGridGroups = useMemo(() => groupByDate(listingGridItems), [listingGridItems]);
  const captionGroups = useMemo(() => groupByDate(filteredCaptions), [filteredCaptions]);
  const transcriptionGroups = useMemo(() => groupByDate(filteredTranscriptions), [filteredTranscriptions]);

  const activeGroups =
    tab === "templates" ? listingGridGroups :
    tab === "captions" ? captionGroups :
    tab === "transcription" ? transcriptionGroups :
    descriptionGroups;
  const isEmpty = GROUP_ORDER.every((g) => !activeGroups[g]?.length);

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab("templates")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === "templates" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Générations
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            tab === "templates" ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"
          }`}>
            {filteredListings.length}
          </span>
        </button>
        {hasCaptions && (
        <button
          onClick={() => setTab("captions")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === "captions" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Captions
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            tab === "captions" ? "bg-violet-100 text-violet-600" : "bg-gray-200 text-gray-500"
          }`}>
            {filteredCaptions.length}
          </span>
        </button>
        )}
        {hasTranscription && (
          <button
            onClick={() => setTab("transcription")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "transcription" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Transcription
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              tab === "transcription" ? "bg-teal-100 text-teal-600" : "bg-gray-200 text-gray-500"
            }`}>
              {filteredTranscriptions.length}
            </span>
          </button>
        )}
        {hasDescription && (
          <button
            onClick={() => setTab("description")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "description" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Descriptions
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              tab === "description" ? "bg-sky-100 text-sky-600" : "bg-gray-200 text-gray-500"
            }`}>
              {filteredDescriptions.length}
            </span>
          </button>
        )}
      </div>

      {/* Admin user filter pills */}
      {isAdmin && allUsers.length > 1 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
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
          {tab === "templates" ? (
            <>
              <LayoutTemplate size={40} className="mx-auto mb-4 opacity-30" />
              <p className="font-medium">Aucun template pour l&apos;instant</p>
              <p className="text-sm mt-1">
                Choisissez un template depuis la page{" "}
                <Link href="/tools/templates" className="text-indigo-600 hover:underline">Templates</Link>
              </p>
            </>
          ) : tab === "captions" ? (
            <>
              <Film size={40} className="mx-auto mb-4 opacity-30" />
              <p className="font-medium">Aucune vidéo caption</p>
              <p className="text-sm mt-1">
                Rendez-vous dans{" "}
                <Link href="/tools/captions" className="text-violet-600 hover:underline">Captions</Link>
              </p>
            </>
          ) : tab === "transcription" ? (
            <>
              <Mic size={40} className="mx-auto mb-4 opacity-30" />
              <p className="font-medium">Aucune transcription</p>
              <p className="text-sm mt-1">
                Rendez-vous dans{" "}
                <Link href="/tools/transcription" className="text-teal-600 hover:underline">Transcription</Link>
              </p>
            </>
          ) : (
            <>
              <AlignLeft size={40} className="mx-auto mb-4 opacity-30" />
              <p className="font-medium">Aucune description générée</p>
              <p className="text-sm mt-1">
                Rendez-vous dans{" "}
                <Link href="/tools/description" className="text-sky-600 hover:underline">Descriptions</Link>
              </p>
            </>
          )}
        </div>
      )}

      {/* Date groups */}
      <div className="space-y-10">
        {GROUP_ORDER.filter((g) => activeGroups[g]?.length).map((group) => (
          <section key={group}>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide shrink-0">
                {group}
              </h2>
              <div className="flex-1 border-t border-gray-100" />
            </div>

            {tab === "templates" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {(activeGroups[group] as GridItem[]).map((item) => (
                  <RenderGridCard
                    key={item.id}
                    item={item}
                    isAdmin={isAdmin}
                    hasCovers={hasCovers}
                    coverBusy={item.render ? coverBusyRenderId === item.render.id : false}
                    onDeleteRender={item.render ? () => handleDeleteRender(item.render!.id) : undefined}
                    onRevertUsage={item.render?.status === "DONE" ? () => handleRevertRenderUsage(item.render!.id) : undefined}
                    onGenerateCover={item.render ? () => handleGenerateCover(item.render!.id) : undefined}
                  />
                ))}
              </div>
            ) : tab === "captions" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(activeGroups[group] as CaptionJobRow[]).map((job) => (
                  <CaptionGridCard
                    key={job.id}
                    job={captionStates[job.id] ?? job}
                    isAdmin={isAdmin}
                    onDelete={() => handleDeleteCaptionJob(job.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {tab === "transcription" &&
                  (activeGroups[group] as TranscriptionJobRow[]).map((job) => (
                    <TranscriptionCard
                      key={job.id}
                      job={transcriptionStates[job.id] ?? job}
                      isAdmin={isAdmin}
                      onDelete={() => handleDeleteTranscriptionJob(job.id)}
                    />
                  ))}
                {tab === "description" &&
                  (activeGroups[group] as DescriptionJobRow[]).map((job) => (
                    <DescriptionCard
                      key={job.id}
                      job={job}
                      isAdmin={isAdmin}
                      onDelete={() => handleDeleteDescriptionJob(job.id)}
                    />
                  ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

// ── RenderGridCard ────────────────────────────────────────────────────────────

const FORMAT_ASPECT: Record<string, string> = {
  A3_LANDSCAPE:  "1587/1123",
  A4_PORTRAIT:   "794/1123",
  IG_1080x1350:  "4/5",
  IG_1080x1920:  "9/16",
  CUSTOM:        "16/9",
};

function getAspectFromFormats(formatsJson: string | undefined | null): string {
  if (!formatsJson) return "16/9";
  try {
    const arr = JSON.parse(formatsJson) as string[];
    const first = arr[0];
    if (first && first in FORMAT_ASPECT) return FORMAT_ASPECT[first]!;
  } catch { /* ignore */ }
  return "16/9";
}

type RevertResult = {
  warnings: string[];
  cursors: { libraryId: string; reverted: boolean; skippedReason?: string }[];
};

function RenderGridCard({
  item,
  isAdmin,
  hasCovers,
  coverBusy,
  onDeleteRender,
  onRevertUsage,
  onGenerateCover,
}: {
  item: GridItem;
  isAdmin: boolean;
  hasCovers: boolean;
  coverBusy: boolean;
  onDeleteRender?: () => Promise<void>;
  onRevertUsage?: () => Promise<RevertResult>;
  onGenerateCover?: () => Promise<void>;
}) {
  const { listing, render } = item;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertDone, setRevertDone] = useState(false);
  const [revertWarnings, setRevertWarnings] = useState<string[]>([]);

  const isPending = render?.status === "PROCESSING" || render?.status === "PENDING";
  const isError   = render?.status === "ERROR";
  const isDone    = render?.status === "DONE";
  const canGenerateCover = Boolean(hasCovers && isDone && render?.videoUrl && listing.template?.coverAutoEnabled && onGenerateCover);

  const aspectRatio = getAspectFromFormats(listing.template?.formats);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    await onDeleteRender?.();
  };

  const handleRevertConfirm = async () => {
    if (!onRevertUsage) return;
    setReverting(true);
    try {
      const result = await onRevertUsage();
      const warnings: string[] = [
        ...result.warnings,
        ...result.cursors
          .filter((c) => !c.reverted)
          .map((c) => `Curseur bibliothèque non revert : ${c.skippedReason ?? "déjà avancé"}`),
      ];
      setRevertWarnings(warnings);
      setRevertDone(true);
    } catch (err) {
      setRevertWarnings([err instanceof Error ? err.message : "Erreur inconnue"]);
      setRevertDone(true);
    } finally {
      setReverting(false);
      setConfirmRevert(false);
    }
  };

  return (
    <div className="group relative bg-white rounded-xl overflow-hidden border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all duration-150">
      {/* ── Media area ── */}
      <div className="relative bg-gray-50 overflow-hidden" style={{ aspectRatio }}>
        {isDone && render?.pngUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={render.pngUrl}
            alt={listing.template?.name ?? ""}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {isDone && !render?.pngUrl && render?.videoUrl && (
          <video
            src={render.videoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
          />
        )}
        {isPending && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-gray-400">En cours…</span>
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center text-red-300 text-2xl">⚠</div>
        )}
        {!render && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <LayoutTemplate size={28} className="text-gray-200" />
            {listing.templateId && (
              <Link
                href={`/generate/${listing.templateId}?listingId=${listing.id}`}
                className="text-[11px] px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                Générer
              </Link>
            )}
          </div>
        )}

        {/* Hover overlay — dark tint */}
        {isDone && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        )}

        {/* Download badges */}
        {isDone && (render?.videoUrl ?? render?.pngUrl) && (
          <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {render?.videoUrl && (
              <a
                href={render.videoUrl}
                download
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] px-2 py-1 bg-white/90 text-gray-900 rounded font-semibold hover:bg-white transition"
              >
                MP4
              </a>
            )}
            {render?.pngUrl && (
              <a
                href={render.pngUrl}
                download
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] px-2 py-1 bg-white/90 text-gray-900 rounded font-semibold hover:bg-white transition"
              >
                PNG
              </a>
            )}
          </div>
        )}

        {/* Admin delete render */}
        {isAdmin && onDeleteRender && !confirmDelete && !confirmRevert && (
          <button
            onClick={(e) => { e.preventDefault(); setConfirmDelete(true); }}
            aria-label="Supprimer le rendu"
            className="absolute top-2 right-2 w-6 h-6 bg-white/80 backdrop-blur-sm rounded-full text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
          >
            <X size={12} />
          </button>
        )}
        {isAdmin && confirmDelete && (
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
              className="text-[10px] px-2 py-1 bg-red-500 text-white rounded font-medium hover:bg-red-600 disabled:opacity-50"
            >
              {deleting ? "…" : "✓"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] px-2 py-1 bg-white/80 text-gray-600 rounded"
            >
              ✕
            </button>
          </div>
        )}

        {/* Admin revert usage */}
        {isAdmin && onRevertUsage && !revertDone && !confirmRevert && !confirmDelete && (
          <button
            onClick={(e) => { e.preventDefault(); setConfirmRevert(true); }}
            aria-label="Réinitialiser l'usage bibliothèque"
            title="Réinitialiser l'usage bibliothèque"
            className="absolute top-2 left-2 w-6 h-6 bg-white/80 backdrop-blur-sm rounded-full text-gray-400 hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
          >
            <RotateCcw size={11} />
          </button>
        )}
        {isAdmin && confirmRevert && (
          <div className="absolute top-2 left-2 flex gap-1 items-center">
            <span className="text-[9px] text-white bg-black/60 rounded px-1.5 py-0.5 whitespace-nowrap">Réinitialiser ?</span>
            <button
              onClick={() => void handleRevertConfirm()}
              disabled={reverting}
              className="text-[10px] px-2 py-1 bg-amber-500 text-white rounded font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {reverting ? "…" : "✓"}
            </button>
            <button
              onClick={() => setConfirmRevert(false)}
              className="text-[10px] px-2 py-1 bg-white/80 text-gray-600 rounded"
            >
              ✕
            </button>
          </div>
        )}
        {isAdmin && revertDone && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1 cursor-pointer"
            onClick={() => { setRevertDone(false); setRevertWarnings([]); }}
            title="Cliquer pour fermer"
          >
            {revertWarnings.length === 0 ? (
              <span className="text-[9px] text-white bg-green-600/90 rounded px-1.5 py-0.5">Revert OK</span>
            ) : (
              <span
                className="text-[9px] text-white bg-amber-600/90 rounded px-1.5 py-0.5 max-w-[120px] truncate"
                title={revertWarnings.join(" | ")}
              >
                ⚠ {revertWarnings[0]}
              </span>
            )}
          </div>
        )}

        {canGenerateCover && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onGenerateCover?.(); }}
            disabled={coverBusy}
            title={render?.coverPack ? "Régénérer une cover" : "Générer une cover"}
            className="absolute bottom-2 right-2 h-6 px-2 bg-white/90 backdrop-blur-sm rounded text-[10px] font-semibold text-indigo-700 hover:bg-white transition-all flex items-center gap-1 disabled:opacity-60"
          >
            {coverBusy ? (
              <span className="w-3 h-3 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin" />
            ) : (
              <ImageIcon size={11} />
            )}
            Cover
          </button>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-900 truncate leading-tight">
              {listing.template?.name ?? "Sans template"}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {listing.template?.client && (
                <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wide">
                  {listing.template.client}
                </span>
              )}
              {isAdmin && listing.ownerName && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded-full">
                  {listing.ownerName}
                </span>
              )}
              <span className="text-[10px] text-gray-400">{formatDate(item.createdAt)}</span>
            </div>
          </div>
          {listing.templateId && (
            <Link
              href={`/generate/${listing.templateId}?listingId=${listing.id}`}
              title="Régénérer"
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-500 transition-colors mt-0.5"
            >
              <RefreshCw size={11} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CaptionGridCard ───────────────────────────────────────────────────────────

function CaptionGridCard({
  job,
  isAdmin,
  onDelete,
}: {
  job: CaptionJobRow;
  isAdmin: boolean;
  onDelete: () => Promise<void>;
}) {
  const isInProgress = job.status === "PROCESSING" || job.status === "QUEUED";
  const isDone       = job.status === "DONE" || job.status === "COMPLETED";
  const isFailed     = job.status === "FAILED";
  const stale        = isInProgress && isStale(job.createdAt);
  const name         = job.inputName ?? "Vidéo";

  return (
    <div className={`group bg-white rounded-xl overflow-hidden border transition-all ${
      stale ? "border-amber-200 bg-amber-50/30" : "border-gray-100 hover:border-violet-200 hover:shadow-md"
    }`}>
      {/* ── Media area ── */}
      <div className="relative aspect-video bg-gray-50">
        {isDone && job.outputUrl && (
          <video
            src={job.outputUrl}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
          />
        )}
        {isInProgress && !stale && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-gray-400">Génération en cours…</span>
          </div>
        )}
        {stale && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="text-amber-400 text-xl">⚠</span>
            <span className="text-[10px] text-amber-600">Bloqué · {staleDuration(job.createdAt)}</span>
          </div>
        )}
        {isFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="text-red-300 text-xl">⚠</span>
            <span className="text-[10px] text-red-400">Génération échouée</span>
          </div>
        )}

        {/* Hover overlay + download */}
        {isDone && job.outputUrl && (
          <>
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <a
                href={job.outputUrl}
                download
                className="text-[10px] px-2 py-1 bg-white/90 text-gray-900 rounded font-semibold hover:bg-white transition"
              >
                MP4
              </a>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-900 truncate leading-tight">{name}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                isDone   ? "bg-green-50 text-green-600"   :
                isFailed ? "bg-red-50 text-red-500"        :
                stale    ? "bg-amber-50 text-amber-600"   :
                           "bg-violet-50 text-violet-600"
              }`}>
                {isDone ? "Terminé" : isFailed ? "Erreur" : stale ? "Bloqué" : "En cours…"}
              </span>
              {isAdmin && job.ownerName && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                  {job.ownerName}
                </span>
              )}
              <span className="text-[10px] text-gray-400">{formatDate(job.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {job.presetId && (
              <Link
                href={`/tools/captions/${job.presetId}/generate?captionJobId=${job.id}`}
                title="Régénérer"
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-500 transition-colors"
              >
                <RefreshCw size={11} />
              </Link>
            )}
            <DeleteCaptionJobButton jobId={job.id} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DeleteCaptionJobButton ────────────────────────────────────────────────────

function DeleteCaptionJobButton({ jobId, onDelete }: { jobId: string; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={async () => { setDeleting(true); await onDelete(); }} disabled={deleting}
          className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors">
          {deleting ? "…" : "Confirmer"}
        </button>
        <button onClick={() => setConfirming(false)}
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} title={`Supprimer le job ${jobId}`}
      aria-label="Supprimer"
      className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">
      <X size={14} />
    </button>
  );
}

// ── TranscriptionCard ─────────────────────────────────────────────────────────

function TranscriptionCard({
  job,
  isAdmin,
  onDelete,
}: {
  job: TranscriptionJobRow;
  isAdmin: boolean;
  onDelete: () => Promise<void>;
}) {
  const isInProgress = job.status === "PROCESSING" || job.status === "QUEUED";
  const isDone       = job.status === "COMPLETED";
  const isFailed     = job.status === "FAILED";
  const stale        = isInProgress && isStale(job.createdAt);
  const name = job.inputFilename ?? "Fichier audio";

  const durationLabel = job.duration
    ? job.duration >= 60
      ? `${Math.floor(job.duration / 60)}min${Math.round(job.duration % 60)}s`
      : `${Math.round(job.duration)}s`
    : null;

  return (
    <div className={`bg-white border rounded-xl px-4 py-3.5 transition-colors ${
      stale ? "border-amber-200 bg-amber-50/20" : "border-gray-100 hover:border-gray-200"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
            stale ? "bg-amber-400" :
            isDone ? "bg-green-400" :
            isFailed ? "bg-red-400" :
            "bg-teal-400 animate-pulse"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                isDone  ? "bg-green-50 text-green-600"  :
                isFailed? "bg-red-50 text-red-500"       :
                stale   ? "bg-amber-50 text-amber-600"  :
                isInProgress ? "bg-teal-50 text-teal-600" :
                               "bg-gray-100 text-gray-500"
              }`}>
                {isDone ? "Terminé" : isFailed ? "Erreur" : stale ? `Bloqué · ${staleDuration(job.createdAt)}` : "En cours…"}
              </span>
              {isDone && job.segmentCount != null && (
                <span className="text-[10px] text-gray-400 shrink-0">{job.segmentCount} segments</span>
              )}
              {isDone && durationLabel && (
                <span className="text-[10px] text-gray-400 shrink-0">{durationLabel}</span>
              )}
              {isDone && job.hasDiarization && (
                <span className="text-[10px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  Diarisation
                </span>
              )}
              {isAdmin && job.ownerName && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  {job.ownerName}
                </span>
              )}
            </div>

            {stale ? (
              <p className="text-xs text-amber-600 mt-1">Job bloqué depuis {staleDuration(job.createdAt)} — supprimer pour relancer.</p>
            ) : isInProgress ? (
              <div className="flex items-center gap-1.5 text-xs text-teal-500 mt-1">
                <div className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                Transcription en cours…
              </div>
            ) : isFailed ? (
              <p className="text-xs text-red-400 mt-1">La transcription a échoué.</p>
            ) : isDone ? (
              <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                <span>Modèle : {job.model}</span>
                {job.language && <span>Langue : {job.language}</span>}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDone && (
            <a
              href={`/api/transcription/${job.id}/download?format=srt`}
              download
              className="inline-flex items-center gap-1 text-[11px] text-teal-500 hover:text-teal-700 font-medium transition-colors"
            >
              <Download size={10} /> SRT
            </a>
          )}
          <Link
            href={`/tools/transcription/${job.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 font-medium transition-colors"
          >
            Détails →
          </Link>
          <span className="text-[11px] text-gray-400">{formatDate(job.createdAt)}</span>
          <DeleteTranscriptionJobButton jobId={job.id} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

// ── DeleteTranscriptionJobButton ──────────────────────────────────────────────

function DeleteTranscriptionJobButton({ jobId, onDelete }: { jobId: string; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={async () => { setDeleting(true); await onDelete(); }} disabled={deleting}
          className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors">
          {deleting ? "…" : "Confirmer"}
        </button>
        <button onClick={() => setConfirming(false)}
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors">
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} title={`Supprimer la transcription ${jobId}`}
      aria-label="Supprimer"
      className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">
      <X size={14} />
    </button>
  );
}

// ── DescriptionCard ───────────────────────────────────────────────────────────

function DescriptionCard({
  job,
  isAdmin,
  onDelete,
}: {
  job: DescriptionJobRow;
  isAdmin: boolean;
  onDelete: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isDone = job.status === "COMPLETED";
  const isFailed = job.status === "FAILED";
  const isInProgress = !isDone && !isFailed;
  const name = job.inputFilename ?? (job.inputType === "transcription" ? "Transcription" : "Sans nom");

  const handleCopy = () => {
    if (!job.result) return;
    void navigator.clipboard.writeText(job.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5 hover:border-gray-200 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
            isDone ? "bg-green-400" :
            isFailed ? "bg-red-400" :
            "bg-sky-400 animate-pulse"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
              {job.prompt && (
                <span className="text-[10px] text-gray-400 shrink-0">— {job.prompt.name}</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                isDone   ? "bg-green-50 text-green-600" :
                isFailed ? "bg-red-50 text-red-500"    :
                           "bg-sky-50 text-sky-600"
              }`}>
                {isDone ? "Terminé" : isFailed ? "Erreur" : "En cours…"}
              </span>
              {isAdmin && job.ownerName && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  {job.ownerName}
                </span>
              )}
            </div>

            {isDone && job.result ? (
              <div className="mt-2">
                <p className={`text-xs text-gray-600 leading-relaxed whitespace-pre-wrap ${expanded ? "" : "line-clamp-2"}`}>
                  {job.result}
                </p>
                {job.result.length > 120 && (
                  <button
                    onClick={() => setExpanded((v) => !v)}
                    className="text-[11px] text-sky-500 hover:text-sky-700 mt-1"
                  >
                    {expanded ? "Réduire ↑" : "Voir tout ↓"}
                  </button>
                )}
              </div>
            ) : isFailed ? (
              <p className="text-xs text-red-400 mt-1">La génération a échoué.</p>
            ) : isInProgress ? (
              <div className="flex items-center gap-1.5 text-xs text-sky-500 mt-1">
                <div className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                Génération en cours…
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDone && job.result && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[11px] text-sky-500 hover:text-sky-700 font-medium transition-colors"
              title="Copier la description"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "Copié" : "Copier"}
            </button>
          )}
          <Link
            href="/tools/description"
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 font-medium transition-colors"
          >
            Nouveau →
          </Link>
          <span className="text-[11px] text-gray-400">{formatDate(job.createdAt)}</span>
          {isAdmin && (
            <button
              onClick={() => void onDelete()}
              className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
              title="Supprimer"
              aria-label="Supprimer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

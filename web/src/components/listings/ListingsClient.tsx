"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Film, RefreshCw, Download, LayoutTemplate, Mic, AlignLeft, Copy, Check, Scissors, X } from "lucide-react";
import { DeleteListingButton } from "./DeleteListingButton";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderRow = {
  id: string;
  status: string;
  pngUrl: string | null;
  videoUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
};

export type ListingRow = {
  id: string;
  templateId: string | null;
  jsonData: string;
  createdAt: string;
  ownerName: string | null;
  template: { id: string; name: string; client: string | null } | null;
  renders: RenderRow[];
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

export type DerushJobRow = {
  id: string;
  status: string;
  analysisMode: string;
  visionProvider: string;
  presetName: string | null;
  fileCount: number;
  segmentCount: number | null;
  totalDuration: number | null;
  exportCount: number;
  errorMsg: string | null;
  createdAt: string;
  ownerName: string | null;
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
const MAX_VISIBLE = 4;

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
  initialDerushJobs,
  isAdmin,
  hasCaptions = false,
  hasTranscription = false,
  hasDescription = false,
  hasDerush = false,
}: {
  initialListings: ListingRow[];
  initialCaptionJobs: CaptionJobRow[];
  initialTranscriptionJobs: TranscriptionJobRow[];
  initialDescriptionJobs: DescriptionJobRow[];
  initialDerushJobs: DerushJobRow[];
  isAdmin: boolean;
  hasCaptions?: boolean;
  hasTranscription?: boolean;
  hasDescription?: boolean;
  hasDerush?: boolean;
}) {
  const [tab, setTab] = useState<"templates" | "captions" | "transcription" | "description" | "derush">("templates");
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
  const [deletedDerushJobIds, setDeletedDerushJobIds] = useState<Set<string>>(new Set());

  const handleDeleteRender = async (renderId: string) => {
    await fetch(`/api/renders/${renderId}`, { method: "DELETE" });
    setDeletedRenderIds((prev) => new Set([...prev, renderId]));
    router.refresh();
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

  const handleDeleteDerushJob = async (jobId: string) => {
    await fetch(`/api/derush/${jobId}`, { method: "DELETE" });
    setDeletedDerushJobIds((prev) => new Set([...prev, jobId]));
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
    for (const j of initialDerushJobs) if (j.ownerName) names.add(j.ownerName);
    return Array.from(names).sort();
  }, [initialListings, initialCaptionJobs, initialTranscriptionJobs, initialDescriptionJobs, initialDerushJobs]);

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

  const filteredDerush = useMemo(
    () =>
      (userFilter ? initialDerushJobs.filter((j) => j.ownerName === userFilter) : initialDerushJobs).filter(
        (j) => !deletedDerushJobIds.has(j.id)
      ),
    [initialDerushJobs, userFilter, deletedDerushJobIds]
  );

  const listingGroups = useMemo(() => groupByDate(filteredListings), [filteredListings]);
  const captionGroups = useMemo(() => groupByDate(filteredCaptions), [filteredCaptions]);
  const transcriptionGroups = useMemo(() => groupByDate(filteredTranscriptions), [filteredTranscriptions]);
  const descriptionGroups = useMemo(() => groupByDate(filteredDescriptions), [filteredDescriptions]);
  const derushGroups = useMemo(() => groupByDate(filteredDerush), [filteredDerush]);

  const activeGroups =
    tab === "templates" ? listingGroups :
    tab === "captions" ? captionGroups :
    tab === "transcription" ? transcriptionGroups :
    tab === "derush" ? derushGroups :
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
        {hasDerush && (
          <button
            onClick={() => setTab("derush")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "derush" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Dérush
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              tab === "derush" ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-500"
            }`}>
              {filteredDerush.length}
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
      {isEmpty && tab !== "derush" && (
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

      {isEmpty && tab === "derush" && (
        <div className="text-center py-24 text-gray-400">
          <Scissors size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun dérush pour l&apos;instant</p>
          <p className="text-sm mt-1">
            Rendez-vous dans{" "}
            <Link href="/tools/derush" className="text-orange-600 hover:underline">Dérush</Link>
          </p>
        </div>
      )}

      {/* Date groups */}
      <div className="space-y-8">
        {GROUP_ORDER.filter((g) => activeGroups[g]?.length).map((group) => (
          <section key={group}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide shrink-0">
                {group}
              </h2>
              <div className="flex-1 border-t border-gray-100" />
            </div>
            <div className="space-y-3">
              {tab === "templates"
                ? (activeGroups[group] as ListingRow[]).map((listing) => {
                    const renders = listing.renders
                      .map((r) => renderStates[r.id] ?? r)
                      .filter((r) => !deletedRenderIds.has(r.id));
                    return (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        renders={renders}
                        isAdmin={isAdmin}
                        onDeleteRender={handleDeleteRender}
                      />
                    );
                  })
                : tab === "captions"
                ? (activeGroups[group] as CaptionJobRow[]).map((job) => (
                    <CaptionCard
                      key={job.id}
                      job={captionStates[job.id] ?? job}
                      isAdmin={isAdmin}
                      onDelete={() => handleDeleteCaptionJob(job.id)}
                    />
                  ))
                : tab === "transcription"
                ? (activeGroups[group] as TranscriptionJobRow[]).map((job) => (
                    <TranscriptionCard
                      key={job.id}
                      job={transcriptionStates[job.id] ?? job}
                      isAdmin={isAdmin}
                      onDelete={() => handleDeleteTranscriptionJob(job.id)}
                    />
                  ))
                : (activeGroups[group] as DescriptionJobRow[]).map((job) => (
                    <DescriptionCard
                      key={job.id}
                      job={job}
                      isAdmin={isAdmin}
                      onDelete={() => handleDeleteDescriptionJob(job.id)}
                    />
                  ))}
              {tab === "derush" &&
                (activeGroups[group] as DerushJobRow[]).map((job) => (
                  <DerushCard
                    key={job.id}
                    job={job}
                    isAdmin={isAdmin}
                    onDelete={() => handleDeleteDerushJob(job.id)}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── ListingCard ───────────────────────────────────────────────────────────────

function ListingCard({
  listing,
  renders,
  isAdmin,
  onDeleteRender,
}: {
  listing: ListingRow;
  renders: RenderRow[];
  isAdmin: boolean;
  onDeleteRender: (id: string) => Promise<void>;
}) {
  const inProgress = renders.some((r) => r.status === "PROCESSING" || r.status === "PENDING");
  const visible = renders.slice(0, MAX_VISIBLE);
  const extra = renders.length - MAX_VISIBLE;

  return (
    <div className="bg-white border border-gray-100 rounded-xl flex overflow-hidden">
      {/* Left accent */}
      <div className="w-0.5 bg-indigo-400 shrink-0" />

      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Row 1: meta + actions */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <h3 className="text-sm font-medium text-gray-900 truncate">
              {listing.template?.name ?? "Sans template"}
            </h3>
            {listing.template?.client && (
              <span className="text-[10px] text-indigo-500 font-semibold uppercase tracking-wide shrink-0">
                {listing.template.client}
              </span>
            )}
            {inProgress && (
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shrink-0" />
            )}
            {isAdmin && listing.ownerName && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {listing.ownerName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-gray-400">{formatDate(listing.createdAt)}</span>
            {listing.templateId && (
              <Link
                href={`/generate/${listing.templateId}?listingId=${listing.id}`}
                className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
              >
                <RefreshCw size={10} /> Régénérer
              </Link>
            )}
            {isAdmin && <DeleteListingButton id={listing.id} />}
          </div>
        </div>

        {/* Row 2: renders */}
        {renders.length === 0 ? (
          <p className="text-xs text-gray-400">
            Aucun rendu
            {listing.templateId && (
              <> — <Link href={`/generate/${listing.templateId}?listingId=${listing.id}`} className="text-indigo-500 hover:underline">Générer →</Link></>
            )}
          </p>
        ) : (
          <div className="flex gap-2">
            {visible.map((render, idx) => (
              <RenderThumb
                key={render.id}
                render={render}
                index={idx + 1}
                isAdmin={isAdmin}
                extraCount={idx === MAX_VISIBLE - 1 && extra > 0 ? extra : 0}
                onDelete={() => onDeleteRender(render.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── RenderThumb ───────────────────────────────────────────────────────────────

function RenderThumb({
  render,
  index,
  isAdmin,
  extraCount,
  onDelete,
}: {
  render: RenderRow;
  index: number;
  isAdmin: boolean;
  extraCount: number;
  onDelete: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isPending = render.status === "PROCESSING" || render.status === "PENDING";
  const isError   = render.status === "ERROR";
  const isDone    = render.status === "DONE";
  const assetUrl  = render.pngUrl ?? render.videoUrl ?? null;

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete();
  };

  const thumb = (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-gray-100 border border-gray-100 transition-all group-hover:ring-2 group-hover:ring-indigo-400 group-hover:ring-offset-1">
      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {isError && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400">⚠</div>
      )}
      {isDone && (
        render.pngUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={render.pngUrl} alt={`Variante ${index}`} className="absolute inset-0 w-full h-full object-cover" />
        ) : render.videoUrl ? (
          <video src={render.videoUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">▦</div>
        )
      )}

      {/* "+N" extras overlay */}
      {extraCount > 0 && (
        <div className="absolute inset-0 bg-gray-900/55 flex items-center justify-center pointer-events-none">
          <span className="text-white text-sm font-bold">+{extraCount}</span>
        </div>
      )}

      {/* Download badges on hover */}
      {isDone && (
        <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {render.videoUrl && (
            <a href={render.videoUrl} download title="MP4" onClick={(e) => e.stopPropagation()}
              className="text-[8px] px-1.5 py-0.5 bg-indigo-600/90 text-white rounded font-medium">
              MP4
            </a>
          )}
          {render.pngUrl && (
            <a href={render.pngUrl} download title="PNG" onClick={(e) => e.stopPropagation()}
              className="text-[8px] px-1.5 py-0.5 bg-gray-700/80 text-white rounded font-medium">
              PNG
            </a>
          )}

        </div>
      )}

      {/* Admin delete */}
      {isAdmin && !confirmDelete && (
        <button
          onClick={(e) => { e.preventDefault(); setConfirmDelete(true); }}
          aria-label="Supprimer"
          className="absolute top-1 right-1 w-5 h-5 bg-white/80 backdrop-blur-sm rounded-full text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
        >
          <X size={12} />
        </button>
      )}
      {isAdmin && confirmDelete && (
        <div className="absolute top-1 right-1 flex gap-0.5">
          <button onClick={(e) => { e.preventDefault(); void handleDelete(); }} disabled={deleting}
            className="text-[9px] px-1.5 py-0.5 bg-red-500 text-white rounded font-medium hover:bg-red-600 disabled:opacity-50">
            {deleting ? "…" : "✓"}
          </button>
          <button onClick={(e) => { e.preventDefault(); setConfirmDelete(false); }}
            className="text-[9px] px-1.5 py-0.5 bg-white/80 text-gray-600 rounded">
            ✕
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 min-w-0 max-w-[200px] relative group">
      {isDone && assetUrl ? (
        <a href={assetUrl} target="_blank" rel="noopener noreferrer" className="block">
          {thumb}
        </a>
      ) : (
        thumb
      )}
    </div>
  );
}

// ── CaptionCard ───────────────────────────────────────────────────────────────

function CaptionCard({
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
  const name = job.inputName ?? "Vidéo";

  return (
    <div className={`bg-white border rounded-xl flex overflow-hidden ${stale ? "border-amber-200" : "border-gray-100"}`}>
      {/* Left accent */}
      <div className={`w-0.5 shrink-0 ${stale ? "bg-amber-400" : "bg-violet-400"}`} />

      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Row 1: meta + actions */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <h3 className="text-sm font-medium text-gray-900 truncate">{name}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              isDone  ? "bg-green-50 text-green-600"   :
              isFailed? "bg-red-50 text-red-500"        :
              stale   ? "bg-amber-50 text-amber-600"   :
              isInProgress ? "bg-violet-50 text-violet-600" :
                             "bg-gray-100 text-gray-500"
            }`}>
              {isDone ? "Terminé" : isFailed ? "Erreur" : stale ? `Bloqué · ${staleDuration(job.createdAt)}` : "En cours…"}
            </span>
            {isAdmin && job.ownerName && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {job.ownerName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDone && job.outputUrl && (
              <a
                href={job.outputUrl}
                download
                className="inline-flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 font-medium transition-colors"
              >
                <Download size={10} /> MP4
              </a>
            )}
            {job.presetId && (
              <Link
                href={`/tools/captions/${job.presetId}/generate?captionJobId=${job.id}`}
                className="inline-flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 font-medium transition-colors"
              >
                <RefreshCw size={10} /> Régénérer
              </Link>
            )}
            <span className="text-[11px] text-gray-400">{formatDate(job.createdAt)}</span>
            <DeleteCaptionJobButton jobId={job.id} onDelete={onDelete} />
          </div>
        </div>

        {/* Row 2: video thumb or status */}
        {isDone && job.outputUrl ? (
          <div className="max-w-[200px]">
            <video src={job.outputUrl} className="w-full h-auto rounded-lg" muted playsInline />
          </div>
        ) : isInProgress ? (
          <div className="flex items-center gap-1.5 text-xs text-violet-500">
            <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            Génération en cours…
          </div>
        ) : isFailed ? (
          <p className="text-xs text-red-400">La génération a échoué.</p>
        ) : null}
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
    <div className={`bg-white border rounded-xl flex overflow-hidden ${stale ? "border-amber-200" : "border-gray-100"}`}>
      {/* Left accent */}
      <div className={`w-0.5 shrink-0 ${stale ? "bg-amber-400" : "bg-teal-400"}`} />

      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Row 1: meta + actions */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <h3 className="text-sm font-medium text-gray-900 truncate">{name}</h3>
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

        {/* Row 2: status details */}
        {stale ? (
          <p className="text-xs text-amber-600">Job bloqué depuis {staleDuration(job.createdAt)} — supprimer pour relancer.</p>
        ) : isInProgress ? (
          <div className="flex items-center gap-1.5 text-xs text-teal-500">
            <div className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            Transcription en cours…
          </div>
        ) : isFailed ? (
          <p className="text-xs text-red-400">La transcription a échoué.</p>
        ) : isDone ? (
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>Modèle : {job.model}</span>
            {job.language && <span>Langue : {job.language}</span>}
          </div>
        ) : null}
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
  const name = job.inputFilename ?? (job.inputType === "transcription" ? "Transcription" : "Sans nom");

  const handleCopy = () => {
    if (!job.result) return;
    void navigator.clipboard.writeText(job.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl flex overflow-hidden">
      {/* Left accent */}
      <div className="w-0.5 bg-sky-400 shrink-0" />

      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Row 1: meta + actions */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <h3 className="text-sm font-medium text-gray-900 truncate">{name}</h3>
            {job.prompt && (
              <span className="text-[10px] text-gray-400 shrink-0">— {job.prompt.name}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              isDone   ? "bg-green-50 text-green-600" :
              isFailed ? "bg-red-50 text-red-500"    :
                         "bg-gray-100 text-gray-500"
            }`}>
              {isDone ? "Terminé" : isFailed ? "Erreur" : job.status}
            </span>
            {isAdmin && job.ownerName && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {job.ownerName}
              </span>
            )}
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

        {/* Row 2: result preview */}
        {isDone && job.result ? (
          <div>
            <p
              className={`text-xs text-gray-600 leading-relaxed whitespace-pre-wrap ${expanded ? "" : "line-clamp-2"}`}
            >
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
          <p className="text-xs text-red-400">La génération a échoué.</p>
        ) : null}
      </div>
    </div>
  );
}

// ── DerushCard ────────────────────────────────────────────────────────────────

function DerushCard({
  job,
  isAdmin,
  onDelete,
}: {
  job: DerushJobRow;
  isAdmin: boolean;
  onDelete: () => Promise<void>;
}) {
  const isInProgress = job.status === "PROCESSING" || job.status === "QUEUED";
  const isDone       = job.status === "COMPLETED";
  const isFailed     = job.status === "FAILED";
  const stale        = isInProgress && isStale(job.createdAt);

  const durationLabel = job.totalDuration
    ? job.totalDuration >= 60
      ? `${Math.floor(job.totalDuration / 60)}min${Math.round(job.totalDuration % 60)}s`
      : `${Math.round(job.totalDuration)}s`
    : null;

  const modeLabel = job.analysisMode === "transcription" ? "Transcription" : "Vision";
  const modeColor = job.analysisMode === "transcription" ? "text-teal-600 bg-teal-50" : "text-orange-600 bg-orange-50";

  return (
    <div className={`bg-white border rounded-xl flex overflow-hidden ${stale ? "border-amber-200" : "border-gray-100"}`}>
      {/* Left accent */}
      <div className={`w-0.5 shrink-0 ${stale ? "bg-amber-400" : "bg-orange-400"}`} />

      <div className="flex-1 min-w-0 px-4 py-3">
        {/* Row 1: meta + actions */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${modeColor}`}>
              {modeLabel}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              isDone  ? "bg-green-50 text-green-600"   :
              isFailed? "bg-red-50 text-red-500"       :
              stale   ? "bg-amber-50 text-amber-600"   :
              isInProgress ? "bg-orange-50 text-orange-600" :
                             "bg-gray-100 text-gray-500"
            }`}>
              {isDone ? "Terminé" : isFailed ? "Erreur" : stale ? `Bloqué · ${staleDuration(job.createdAt)}` : "En cours…"}
            </span>
            {job.fileCount > 0 && (
              <span className="text-[10px] text-gray-400 shrink-0">
                {job.fileCount} fichier{job.fileCount !== 1 ? "s" : ""}
              </span>
            )}
            {isDone && job.segmentCount != null && (
              <span className="text-[10px] text-gray-400 shrink-0">{job.segmentCount} segments</span>
            )}
            {isDone && durationLabel && (
              <span className="text-[10px] text-gray-400 shrink-0">{durationLabel}</span>
            )}
            {isDone && job.exportCount > 0 && (
              <span className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {job.exportCount} export{job.exportCount !== 1 ? "s" : ""}
              </span>
            )}
            {job.presetName && (
              <span className="text-[10px] text-gray-400 shrink-0">— {job.presetName}</span>
            )}
            {isAdmin && job.ownerName && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                {job.ownerName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/tools/derush/${job.id}`}
              className="inline-flex items-center gap-1 text-[11px] text-orange-500 hover:text-orange-700 font-medium transition-colors"
            >
              Détails →
            </Link>
            <span className="text-[11px] text-gray-400">{formatDate(job.createdAt)}</span>
            <button
              onClick={() => void onDelete()}
              className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
              title="Supprimer"
              aria-label="Supprimer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: status hint */}
        {stale ? (
          <p className="text-xs text-amber-600">Job bloqué depuis {staleDuration(job.createdAt)} — supprimer pour relancer.</p>
        ) : isInProgress ? (
          <div className="flex items-center gap-1.5 text-xs text-orange-500">
            <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            Analyse en cours…
          </div>
        ) : isFailed ? (
          <p className="text-xs text-red-400 truncate">{job.errorMsg ?? "L'analyse a échoué."}</p>
        ) : null}
      </div>
    </div>
  );
}

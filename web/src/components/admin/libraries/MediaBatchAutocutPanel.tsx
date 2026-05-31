"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Loader2, Play, RefreshCw,
  Square, CheckSquare, AlertTriangle, Wand2, ChevronRight,
  X, Trash2,
} from "lucide-react";
import { AutocutReviewCard, type AutocutJob } from "./AutocutReviewCard";

interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  duration: number | null;
  disabled: boolean;
}

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
}

interface Props {
  library: MediaLibrary;
  knownTags?: string[];
  onClose: () => void;
}

type AssetWithJobStatus = MediaAsset & {
  autocutStatus: "none" | "pending" | "processing" | "done" | "failed" | "cut";
  autocutJobId: string | null;
  /** Durée conservée après le cut (confirmedEnd - confirmedStart), null si non appliqué */
  cutDuration: number | null;
};

function fmt(s: number | null): string {
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const POLL_INTERVAL_MS = 5000;

import { useConfirm } from "@/components/ui/useConfirm";

export function MediaBatchAutocutPanel({ library, knownTags, onClose }: Props) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [view, setView] = useState<"select" | "review">("select");

  // ── Vue 1 : sélection ─────────────────────────────────────────────────────
  const [assets, setAssets] = useState<AssetWithJobStatus[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ batches: number; skipped: number } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ deleted: number } | null>(null);

  // ── Vue 2 : review ────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<AutocutJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotal, setReviewTotal] = useState(0);
  // Jobs qui viennent d'être appliqués — section de tracking live
  const [appliedJobs, setAppliedJobs] = useState<AutocutJob[]>([]);

  // ── Audio options (appliquées à tous au moment du batch-apply) ────────────────
  const [mixToMono, setMixToMono] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [gainDb, setGainDb] = useState(0);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Charger les assets + statuts autocut ─────────────────────────────────
  const loadAssets = useCallback(async () => {
    try {
      const [assetsRes, queueRes] = await Promise.all([
        fetch(`/api/admin/libraries/media/${library.id}/assets`),
        // lean=1 : skip les includes asset/editJob — on n'a besoin que des statuts ici
        fetch(`/api/admin/libraries/media/${library.id}/autocut-queue?pageSize=500&lean=1`),
      ]);

      if (!assetsRes.ok) throw new Error("Impossible de charger les assets");

      const assetsData = await assetsRes.json() as MediaAsset[];
      const queueData = queueRes.ok
        ? (await queueRes.json() as { jobs: AutocutJob[] }).jobs
        : [];

      // Construire un map jobId par assetId (dernier job connu)
      const jobByAsset = new Map<string, AutocutJob>();
      for (const job of queueData) {
        const existing = jobByAsset.get(job.assetId);
        if (!existing || new Date(job.createdAt as string) > new Date(existing.createdAt as string)) {
          jobByAsset.set(job.assetId, job);
        }
      }

      const enriched: AssetWithJobStatus[] = assetsData.filter((a) => !a.disabled).map((a) => {
        const job = jobByAsset.get(a.id);
        let autocutStatus: AssetWithJobStatus["autocutStatus"] = "none";
        let cutDuration: number | null = null;
        if (job) {
          if (job.reviewStatus === "applied") {
            autocutStatus = "cut";
            cutDuration =
              job.confirmedStart != null && job.confirmedEnd != null
                ? Math.round((job.confirmedEnd - job.confirmedStart) * 10) / 10
                : null;
          } else {
            autocutStatus = job.status as AssetWithJobStatus["autocutStatus"];
          }
        }
        return { ...a, autocutStatus, cutDuration, autocutJobId: job?.id ?? null };
      });

      setAssets(enriched);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoadingAssets(false);
    }
  }, [library.id]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  // Polling pour mise à jour des statuts pendant l'analyse
  useEffect(() => {
    const hasProcessing = assets.some(
      (a) => a.autocutStatus === "pending" || a.autocutStatus === "processing"
    );
    if (hasProcessing) {
      pollRef.current = setTimeout(() => void loadAssets(), POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [assets, loadAssets]);

  // ── Charger la queue de review ────────────────────────────────────────────
  const loadReviewQueue = useCallback(async (page = 1) => {
    setLoadingJobs(true);
    try {
      const res = await fetch(
        `/api/admin/libraries/media/${library.id}/autocut-queue?reviewStatus=pending_review&pageSize=20&page=${page}`
      );
      if (!res.ok) throw new Error("Erreur chargement queue");
      const data = await res.json() as { jobs: AutocutJob[]; total: number; page: number };
      setJobs(data.jobs);
      setReviewTotal(data.total);
      setReviewPage(data.page);
    } catch {
      // silencieux, queue vide
    } finally {
      setLoadingJobs(false);
    }
  }, [library.id]);

  useEffect(() => {
    if (view === "review") {
      void loadReviewQueue(reviewPage);
    }
  }, [view, reviewPage, loadReviewQueue]);

  // ── Polling pour le suivi live des jobs appliqués ───────────────────────
  useEffect(() => {
    if (applyPollRef.current) clearTimeout(applyPollRef.current);
    const hasPending =
      view === "review" &&
      appliedJobs.some(
        (j) => !j.editJob?.status || j.editJob.status === "pending" || j.editJob.status === "processing"
      );
    if (!hasPending) return;
    applyPollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/libraries/media/${library.id}/autocut-queue?reviewStatus=applied&pageSize=50`
        );
        if (!res.ok) return;
        const data = await res.json() as { jobs: AutocutJob[] };
        setAppliedJobs((prev) =>
          prev.map((pj) => {
            const fresh = data.jobs.find((fj) => fj.id === pj.id);
            return fresh ?? pj;
          })
        );
      } catch {
        // silencieux
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (applyPollRef.current) clearTimeout(applyPollRef.current);
    };
  }, [appliedJobs, view, library.id]);

  // ── Escape to close ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Actions sélection ────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const selectable = assets.filter(
      (a) => a.autocutStatus === "none" || a.autocutStatus === "failed"
    );
    if (selectedIds.size === selectable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map((a) => a.id)));
    }
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: "Supprimer toutes les analyses non-appliquées ?",
      description: "Les fichiers déjà coupés ne seront pas affectés. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch(`/api/admin/libraries/media/${library.id}/autocut-jobs`, {
        method: "DELETE",
      });
      const data = await res.json() as { deleted: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la réinitialisation");
      setResetResult({ deleted: data.deleted });
      void loadAssets();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setResetting(false);
    }
  };

  const handleAnalyze = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const res = await fetch(`/api/admin/libraries/media/${library.id}/autocut-packs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: Array.from(selectedIds) }),
      });
      const data = await res.json() as {
        batches: Array<{ batchId: string; assetCount: number; status: string }>;
        skipped: string[];
        error?: string;
      };
      if (!res.ok) {
        setSubmitError(data.error ?? "Erreur lors de la soumission");
        return;
      }
      setSubmitResult({
        batches: data.batches.length,
        skipped: data.skipped.length,
      });
      setSelectedIds(new Set());
      void loadAssets();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Actions review ────────────────────────────────────────────────────────
  const handleAccept = async (jobId: string, confirmedStart: number, confirmedEnd: number, tags: string[]) => {
    // Retrouver les données du job pour la section de tracking
    const jobData = jobs.find((j) => j.id === jobId);

    // 1. Marquer comme accepted + enregistrer les timings confirmés
    const patchRes = await fetch(`/api/admin/libraries/media/autocut/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus: "accepted", confirmedStart, confirmedEnd }),
    });
    if (!patchRes.ok) throw new Error("Erreur lors de la validation");

    // Appliquer les tags sur l’asset si l’utilisateur en a sélectionné
    if (tags.length > 0 && jobData?.assetId) {
      const tagsRes = await fetch(`/api/admin/libraries/media/${library.id}/assets/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [jobData.assetId], tags }),
      });
      if (!tagsRes.ok) {
        console.error("[handleAccept] tags PATCH failed", await tagsRes.text().catch(() => ""));
      }
    }

    // 2. Lancer immédiatement le MediaEditJob pour ce job spécifique
    const applyRes = await fetch(`/api/admin/libraries/media/${library.id}/batch-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobIds: [jobId],
        mixToMono,
        normalize,
        gainDb: gainDb !== 0 ? gainDb : undefined,
      }),
    });

    // Ajouter à la section de tracking, même si l'apply échoue
    if (jobData) {
      let editJobId: string | undefined;
      if (applyRes.ok) {
        try {
          const applyData = await applyRes.json() as {
            submitted: number;
            failed: Array<{ jobId: string; error: string }>;
            editJobs?: Array<{ autocutJobId: string; editJobId: string }>;
          };
          editJobId = applyData.editJobs?.find((e) => e.autocutJobId === jobId)?.editJobId;
        } catch { /* ok */ }
      } else {
        console.error("[handleAccept] batch-apply failed", await applyRes.text().catch(() => ""));
      }
      const appliedEntry: AutocutJob = {
        ...jobData,
        reviewStatus: "applied",
        confirmedStart,
        confirmedEnd,
        editJob: editJobId ? { id: editJobId, status: "pending" } : null,
      };
      setAppliedJobs((prev) => [appliedEntry, ...prev]);
    }

    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setReviewTotal((t) => Math.max(0, t - 1));
  };

  const handleSkip = async (jobId: string) => {
    const res = await fetch(`/api/admin/libraries/media/autocut/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus: "skipped" }),
    });
    if (!res.ok) throw new Error("Erreur lors du skip");
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setReviewTotal((t) => Math.max(0, t - 1));
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const selectableCount = assets.filter(
    (a) => a.autocutStatus === "none" || a.autocutStatus === "failed"
  ).length;
  const cutCount = assets.filter((a) => a.autocutStatus === "cut").length;
  const processingCount = assets.filter(
    (a) => a.autocutStatus === "pending" || a.autocutStatus === "processing"
  ).length;
  const doneCount = assets.filter((a) => a.autocutStatus === "done").length;

  const statusLabel = (asset: AssetWithJobStatus) => {
    switch (asset.autocutStatus) {
      case "none": return null;
      case "pending": return <span className="text-xs text-peach-700 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> En attente</span>;
      case "processing": return <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Analyse…</span>;
      case "done": return <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={10} /> Analysé</span>;
      case "failed": return <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={10} /> Erreur</span>;
      case "cut": return (
        <span className="text-xs text-gray-500 flex items-center gap-1">
          ✂ Coupé{asset.cutDuration != null ? <span className="text-gray-400">· {asset.cutDuration}s</span> : null}
        </span>
      );
    }
  };

  // ── Rendu vue sélection ───────────────────────────────────────────────────
  if (view === "select") {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mt-8 mb-8 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Wand2 size={18} className="text-rose-700" />
              <h2 className="text-base font-semibold text-gray-900">Atelier Autocut</h2>
              <span className="text-xs text-gray-400">— {library.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {doneCount > 0 && (
                <button
                  onClick={() => setView("review")}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700"
                >
                  Valider les analyses ({doneCount}) <ChevronRight size={13} />
                </button>
              )}
              {cutCount > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                  ✂ {cutCount} coupé{cutCount > 1 ? "s" : ""}
                </span>
              )}
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Stats bar */}
          {processingCount > 0 && (
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 flex items-center gap-2">
              <Loader2 size={11} className="animate-spin text-blue-500" />
              <span>{processingCount} asset{processingCount > 1 ? "s" : ""} en cours d&apos;analyse…</span>
            </div>
          )}

          {/* Toolbar */}
          <div className="px-6 py-3 flex items-center gap-3 border-b border-gray-50">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              {selectedIds.size === selectableCount && selectableCount > 0
                ? <CheckSquare size={14} className="text-sky-700" />
                : <Square size={14} />}
              Tout sélectionner
            </button>
            <span className="text-xs text-gray-400">{selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => void loadAssets()}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-400"
                title="Rafraîchir"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => void handleReset()}
                disabled={resetting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                title="Supprimer toutes les analyses non-appliquées"
              >
                {resetting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Réinitialiser
              </button>
              <button
                onClick={() => void handleAnalyze()}
                disabled={submitting || selectedIds.size === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Analyser ({selectedIds.size})
              </button>
            </div>
          </div>

          {/* Feedback */}
          {submitError && (
            <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {submitError}
            </div>
          )}
          {resetResult && (
            <div className="mx-6 mt-3 p-3 bg-peach-50 border border-peach-200 rounded-lg text-xs text-peach-800">
              {resetResult.deleted} analyse{resetResult.deleted > 1 ? "s" : ""} supprimée{resetResult.deleted > 1 ? "s" : ""}.
              Les fichiers déjà coupés sont préservés.
            </div>
          )}
          {submitResult && (
            <div className="mx-6 mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
              {submitResult.batches} pack{submitResult.batches > 1 ? "s" : ""} soumis à RunPod
              {submitResult.skipped > 0 && ` — ${submitResult.skipped} ignoré${submitResult.skipped > 1 ? "s" : ""} (déjà en cours)`}
            </div>
          )}

          {/* Asset list */}
          <div className="overflow-y-auto flex-1 max-h-[60vh]">
            {loadingAssets ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : loadError ? (
              <div className="p-6 text-sm text-red-600">{loadError}</div>
            ) : assets.length === 0 ? (
              <div className="p-6 text-sm text-gray-400 text-center">Aucun asset dans cette bibliothèque</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {assets.map((asset) => {
                  const isSelectable = asset.autocutStatus === "none" || asset.autocutStatus === "failed";
                  const isCut = asset.autocutStatus === "cut";
                  const isSelected = selectedIds.has(asset.id);
                  return (
                    <li
                      key={asset.id}
                      className={`flex items-center gap-3 px-6 py-2.5 transition-colors ${
                        isSelectable ? "cursor-pointer hover:bg-gray-50"
                        : isCut ? "bg-gray-50/50"
                        : "opacity-60"
                      }`}
                      onClick={() => isSelectable && toggleSelect(asset.id)}
                    >
                      {isSelectable ? (
                        isSelected
                          ? <CheckSquare size={15} className="text-sky-700 flex-shrink-0" />
                          : <Square size={15} className="text-gray-300 flex-shrink-0" />
                      ) : (
                        <span className="w-[15px] flex-shrink-0" />
                      )}
                      <span className={`text-sm flex-1 truncate ${isCut ? "text-gray-400" : "text-gray-800"}`}>
                        {asset.filename}
                      </span>
                      {asset.duration !== null && (
                        <span className="text-xs text-gray-400 flex-shrink-0">{fmt(asset.duration)}</span>
                      )}
                      <span className="flex-shrink-0 w-32 text-right">
                        {statusLabel(asset)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Rendu vue review ──────────────────────────────────────────────────────
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(reviewTotal / pageSize));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mt-8 mb-8 flex flex-col max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView("select")}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <ArrowLeft size={16} />
            </button>
            <h2 className="text-base font-semibold text-gray-900">
              Review — {reviewTotal} à valider
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Audio options */}
        <div className="mx-6 mt-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-5 flex-wrap">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Audio</span>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mixToMono}
              onChange={(e) => setMixToMono(e.target.checked)}
              className="rounded border-gray-300 text-sky-700 focus:ring-sky-400"
            />
            Mix mono
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
              className="rounded border-gray-300 text-sky-700 focus:ring-sky-400"
            />
            Normaliser
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 w-16">Volume</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={gainDb}
              onChange={(e) => setGainDb(parseFloat(e.target.value))}
              className="w-24 accent-indigo-600"
            />
            <span className="text-sm text-gray-700 w-14 text-right">
              {gainDb > 0 ? `+${gainDb}` : gainDb} dB
            </span>
            {gainDb !== 0 && (
              <button
                onClick={() => setGainDb(0)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                reset
              </button>
            )}
          </div>
        </div>

        {/* Review cards */}
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          {loadingJobs ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 size={32} className="text-green-400 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {reviewTotal === 0
                  ? "Aucune analyse à valider pour le moment."
                  : `${reviewTotal} analyse${reviewTotal > 1 ? "s" : ""} restante${reviewTotal > 1 ? "s" : ""} à valider.`}
              </p>
              {reviewTotal === 0 ? (
                <button
                  onClick={() => setView("select")}
                  className="mt-4 text-sm text-sky-700 hover:underline"
                >
                  ← Retour à la sélection
                </button>
              ) : (
                <button
                  onClick={() => { setReviewPage(1); void loadReviewQueue(1); }}
                  className="mt-4 flex items-center gap-1.5 mx-auto text-sm text-sky-700 hover:underline"
                >
                  Charger la suite <ChevronRight size={13} />
                </button>
              )}
            </div>
          ) : (
            jobs.map((job) => (
              <AutocutReviewCard
                key={job.id}
                job={job}
                knownTags={knownTags}
                onAccept={handleAccept}
                onSkip={handleSkip}
              />
            ))
          )}

          {/* Section de suivi des jobs appliqués — lignes compactes */}
          {appliedJobs.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide px-1 flex items-center gap-1.5">
                  {appliedJobs.some((j) => !j.editJob?.status || j.editJob.status === "pending" || j.editJob.status === "processing") && (
                    <Loader2 size={9} className="animate-spin" />
                  )}
                  En traitement ({appliedJobs.filter((j) => j.editJob?.status === "done").length}/{appliedJobs.length})
                </span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <ul className="flex flex-col gap-0.5">
                {appliedJobs.map((job) => {
                  const editStatus = job.editJob?.status ?? "pending";
                  const isDone = editStatus === "done";
                  const isFailed = editStatus === "failed";
                  const dur =
                    job.confirmedStart != null && job.confirmedEnd != null
                      ? Math.round((job.confirmedEnd - job.confirmedStart) * 10) / 10
                      : null;
                  return (
                    <li key={job.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 text-xs">
                      {isDone ? (
                        <CheckCircle2 size={11} className="text-green-500 flex-shrink-0" />
                      ) : isFailed ? (
                        <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
                      ) : (
                        <Loader2 size={11} className="animate-spin text-gray-400 flex-shrink-0" />
                      )}
                      <span className="flex-1 truncate text-gray-600">{job.asset.filename}</span>
                      {dur != null && isDone && (
                        <span className="text-gray-400 flex-shrink-0">{dur}s conservés</span>
                      )}
                      {isFailed && job.errorMsg && (
                        <span className="text-red-400 truncate max-w-[160px]">{job.errorMsg}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-600 border-t border-gray-100 shrink-0">
            <button
              onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
              disabled={reviewPage === 1}
              className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              ←
            </button>
            <span className="text-xs text-gray-500">Page {reviewPage} / {totalPages}</span>
            <button
              onClick={() => setReviewPage((p) => Math.min(totalPages, p + 1))}
              disabled={reviewPage === totalPages}
              className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              →
            </button>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

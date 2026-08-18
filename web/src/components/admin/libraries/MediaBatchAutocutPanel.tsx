"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Loader2, Play, RefreshCw,
  AlertTriangle, Wand2, ChevronRight, X, Trash2,
} from "lucide-react";
import { AutocutReviewCard, type AutocutJob } from "./AutocutReviewCard";
import { formatTimecode } from "@/lib/time";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Checkbox } from "@/components/ui/Checkbox";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Pagination } from "@/components/ui/Pagination";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useConfirm } from "@/components/ui/useConfirm";

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

const POLL_INTERVAL_MS = 5000;

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
      case "pending": return (
        <span className="text-xs text-warning-700 flex items-center gap-1 justify-end">
          <Loader2 size={10} className="animate-spin" /> En attente
        </span>
      );
      case "processing": return (
        <span className="text-xs text-info-600 flex items-center gap-1 justify-end">
          <Loader2 size={10} className="animate-spin" /> Analyse…
        </span>
      );
      case "done": return <Badge variant="success" icon={CheckCircle2}>Analysé</Badge>;
      case "failed": return <Badge variant="danger" icon={AlertTriangle}>Erreur</Badge>;
      case "cut": return (
        <span className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
          ✂ Coupé{asset.cutDuration != null ? <span className="text-muted-foreground">· {asset.cutDuration}s</span> : null}
        </span>
      );
    }
  };

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(reviewTotal / pageSize));
  const allSelected = selectableCount > 0 && selectedIds.size === selectableCount;

  return (
    <>
      <Modal open onClose={onClose} size="xl" className="flex flex-col max-h-[85vh]">
        {view === "select" ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Wand2 size={18} className="text-danger-700 shrink-0" />
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground truncate">Atelier Autocut</h2>
                <span className="text-xs text-muted-foreground truncate">— {library.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {doneCount > 0 && (
                  <Button size="sm" icon={ChevronRight} iconRight onClick={() => setView("review")}>
                    Valider les analyses ({doneCount})
                  </Button>
                )}
                {cutCount > 0 && (
                  <Badge>✂ {cutCount} coupé{cutCount > 1 ? "s" : ""}</Badge>
                )}
                <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
              </div>
            </div>

            {/* Stats bar */}
            {processingCount > 0 && (
              <div className="px-5 py-2 bg-muted border-b border-border text-xs text-muted-foreground flex items-center gap-2 shrink-0">
                <Loader2 size={11} className="animate-spin text-info-600" />
                <span>{processingCount} asset{processingCount > 1 ? "s" : ""} en cours d&apos;analyse…</span>
              </div>
            )}

            {/* Toolbar */}
            <div className="px-5 py-3 flex items-center gap-3 border-b border-border shrink-0 flex-wrap">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer select-none">
                <Checkbox
                  checked={allSelected ? true : selectedIds.size > 0 ? "indeterminate" : false}
                  onChange={toggleAll}
                  size="sm"
                  label="Tout sélectionner"
                />
                Tout sélectionner
              </label>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
                {selectedIds.size > 20 && (
                  <span className="ml-2 text-warning-700">
                    · découpé en {Math.ceil(selectedIds.size / 20)} batches de 20 max
                  </span>
                )}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <ButtonIcon icon={RefreshCw} label="Rafraîchir" variant="ghost" size="sm" onClick={() => void loadAssets()} />
                <Button
                  variant="destructive"
                  size="sm"
                  icon={Trash2}
                  loading={resetting}
                  onClick={() => void handleReset()}
                  title="Supprimer toutes les analyses non-appliquées"
                >
                  Réinitialiser
                </Button>
                <Button
                  size="sm"
                  icon={Play}
                  loading={submitting}
                  disabled={selectedIds.size === 0}
                  onClick={() => void handleAnalyze()}
                >
                  Analyser ({selectedIds.size})
                </Button>
              </div>
            </div>

            {/* Feedback */}
            {submitError && (
              <Alert variant="danger" className="mx-5 mt-3 shrink-0">{submitError}</Alert>
            )}
            {resetResult && (
              <Alert variant="warning" className="mx-5 mt-3 shrink-0">
                {resetResult.deleted} analyse{resetResult.deleted > 1 ? "s" : ""} supprimée{resetResult.deleted > 1 ? "s" : ""}.
                Les fichiers déjà coupés sont préservés.
              </Alert>
            )}
            {submitResult && (
              <Alert variant="success" className="mx-5 mt-3 shrink-0">
                {submitResult.batches} pack{submitResult.batches > 1 ? "s" : ""} soumis à RunPod
                {submitResult.skipped > 0 && ` — ${submitResult.skipped} ignoré${submitResult.skipped > 1 ? "s" : ""} (déjà en cours)`}
              </Alert>
            )}

            {/* Asset list */}
            <div className="overflow-y-auto flex-1 min-h-0">
              {loadingAssets ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : loadError ? (
                <div className="p-5">
                  <EmptyState
                    icon={AlertTriangle}
                    title="Erreur de chargement"
                    description={loadError}
                    cta={{ label: "Réessayer", onClick: () => void loadAssets() }}
                  />
                </div>
              ) : assets.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Wand2} title="Aucun asset dans cette bibliothèque" />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {assets.map((asset) => {
                    const isSelectable = asset.autocutStatus === "none" || asset.autocutStatus === "failed";
                    const isCut = asset.autocutStatus === "cut";
                    const isSelected = selectedIds.has(asset.id);
                    return (
                      <li
                        key={asset.id}
                        className={`flex items-center gap-3 px-5 py-2.5 transition-colors ${
                          isSelectable ? "cursor-pointer hover:bg-muted"
                          : isCut ? "bg-muted/50"
                          : "opacity-60"
                        }`}
                        onClick={() => isSelectable && toggleSelect(asset.id)}
                      >
                        {isSelectable ? (
                          <Checkbox
                            checked={isSelected}
                            onChange={() => toggleSelect(asset.id)}
                            size="sm"
                            label={`Sélectionner ${asset.filename}`}
                          />
                        ) : (
                          <span className="w-4 flex-shrink-0" />
                        )}
                        <span className={`text-sm flex-1 truncate ${isCut ? "text-muted-foreground" : "text-foreground"}`}>
                          {asset.filename}
                        </span>
                        {asset.duration !== null && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">{formatTimecode(asset.duration, { centiseconds: false })}</span>
                        )}
                        <span className="flex-shrink-0 w-32 flex justify-end">
                          {statusLabel(asset)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ButtonIcon icon={ArrowLeft} label="Retour à la sélection" variant="ghost" size="sm" onClick={() => setView("select")} />
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground truncate">
                  Review — {reviewTotal} à valider
                </h2>
              </div>
              <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
            </div>

            {/* Audio options */}
            <div className="mx-5 mt-3 px-4 py-3 bg-muted border border-border rounded-xl flex items-center gap-5 flex-wrap shrink-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Audio</span>
              <Switch checked={mixToMono} onChange={setMixToMono} label="Mix mono" size="sm" />
              <Switch checked={normalize} onChange={setNormalize} label="Normaliser" size="sm" />
              <div className="flex items-end gap-2">
                <Slider
                  label="Volume"
                  value={gainDb}
                  onChange={setGainDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  unit=" dB"
                  editable
                  className="w-56"
                />
                {gainDb !== 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setGainDb(0)} className="mb-0.5">
                    reset
                  </Button>
                )}
              </div>
            </div>

            {/* Review cards */}
            <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
              {loadingJobs ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : jobs.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title={
                    reviewTotal === 0
                      ? "Aucune analyse à valider pour le moment."
                      : `${reviewTotal} analyse${reviewTotal > 1 ? "s" : ""} restante${reviewTotal > 1 ? "s" : ""} à valider.`
                  }
                  cta={
                    reviewTotal === 0
                      ? { label: "Retour à la sélection", onClick: () => setView("select") }
                      : { label: "Charger la suite", onClick: () => { setReviewPage(1); void loadReviewQueue(1); } }
                  }
                />
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
                    <div className="flex-1 h-px bg-muted" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide px-1 flex items-center gap-1.5">
                      {appliedJobs.some((j) => !j.editJob?.status || j.editJob.status === "pending" || j.editJob.status === "processing") && (
                        <Loader2 size={9} className="animate-spin" />
                      )}
                      En traitement ({appliedJobs.filter((j) => j.editJob?.status === "done").length}/{appliedJobs.length})
                    </span>
                    <div className="flex-1 h-px bg-muted" />
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
                        <li key={job.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-xs">
                          {isDone ? (
                            <CheckCircle2 size={11} className="text-success-600 flex-shrink-0" />
                          ) : isFailed ? (
                            <AlertTriangle size={11} className="text-danger-600 flex-shrink-0" />
                          ) : (
                            <Loader2 size={11} className="animate-spin text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="flex-1 truncate text-muted-foreground">{job.asset.filename}</span>
                          {dur != null && isDone && (
                            <span className="text-muted-foreground flex-shrink-0">{dur}s conservés</span>
                          )}
                          {isFailed && job.errorMsg && (
                            <span className="text-danger-600 truncate max-w-[160px]">{job.errorMsg}</span>
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
              <div className="px-5 py-3 border-t border-border shrink-0">
                <Pagination page={reviewPage} total={reviewTotal} pageSize={pageSize} onPageChange={setReviewPage} />
              </div>
            )}
          </>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}

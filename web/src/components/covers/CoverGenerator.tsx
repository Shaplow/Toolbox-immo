"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, Upload, Download, RefreshCw, Check, X, Image as ImageIcon, Layers } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

// Espace minimum entre deux timestamps distincts.
// 1/30s couvre la plupart des vidéos (30fps). Si la vidéo est en 60fps
// les deux frames les plus proches seront identiques visuellement de toute façon.
const MIN_FRAME_GAP_S = 1 / 30;

type Frame = { timestamp: number; url: string };
type TemplateGroup = { id: string; name: string; hidden?: boolean; locked?: boolean };
type CoverPack = {
  id: string;
  status: string;
  renderId: string;
  templateName: string;
  client: string | null;
  ownerName: string | null;
  frameCount: number;
  duration: number | null;
  errorMsg: string | null;
  finalCoverUrl: string | null;
  overlayOffsetX: number;
  overlayOffsetY: number;
  overlayGroupIds: string[];
  templateGroups: TemplateGroup[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
  candidates: { id: string; timestamp: number; imageUrl: string; slotId: string | null; sequenceIndex: number | null }[];
};

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rounded = Math.round(seconds * 10) / 10;
  const s = Math.floor(rounded % 60);
  const decimal = Math.round((rounded - Math.floor(rounded)) * 10);
  return decimal > 0
    ? `${m}:${s.toString().padStart(2, "0")}.${decimal}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Construit tous les timestamps disponibles dans la plage qui ne sont PAS
 * déjà trop proches des timestamps déjà proposés.
 */
function availableCandidates(
  start: number,
  end: number,
  seen: number[]
): number[] {
  const candidates: number[] = [];
  const step = MIN_FRAME_GAP_S;
  // On démarre au centre du premier slot pour éviter les bords exacts
  for (let t = start + step / 2; t < end - step / 2; t += step) {
    const ts = Math.round(t * 1000) / 1000;
    const tooClose = seen.some((s) => Math.abs(s - ts) < step * 0.9);
    if (!tooClose) candidates.push(ts);
  }
  return candidates;
}

/**
 * Choisit `count` timestamps répartis uniformément parmi les candidats disponibles.
 */
function pickFromCandidates(candidates: number[], count: number): number[] {
  if (candidates.length === 0) return [];
  if (candidates.length <= count) return [...candidates];
  const step = candidates.length / count;
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(candidates[Math.floor(i * step + step / 2)]);
  }
  return picked;
}

interface CoverGeneratorProps {
  /**
   * Si fourni, ne charge que les packs cover liés à ce slot (via render OU
   * currentVersion). Sans ce filtre, /publications/[id]/cover affichait
   * TOUS les packs du système — la CM choisissait dans un mauvais lot.
   */
  slotId?: string;
  /**
   * Phase 2.5 — vidéo source pré-remplie pour l'onglet manuel.
   * Utilisé par /publications/[id]/cover avec mode=manualSelect pour
   * que la CM puisse extraire des frames depuis la vidéo finale sans
   * avoir à la re-uploader.
   */
  prefillVideoUrl?: string;
  prefillVideoName?: string;
  /**
   * Si "manual", on bascule sur l'onglet manuel au mount. Utile quand le
   * mode pattern est "manualSelect" : il n'y a pas de pack auto à montrer,
   * direct l'extraction libre.
   */
  initialTab?: "packs" | "manual";
}

export function CoverGenerator({ slotId, prefillVideoUrl, prefillVideoName, initialTab = "packs" }: CoverGeneratorProps = {}) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  // ── Tab ────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"packs" | "manual">(initialTab);

  // ── Auto packs ─────────────────────────────────────────────────────────────
  const [packs, setPacks] = useState<CoverPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packBusyId, setPackBusyId] = useState<string | null>(null);
  const [selectedCandidateByPack, setSelectedCandidateByPack] = useState<Record<string, string>>({});
  const [overlayOffsetByPack, setOverlayOffsetByPack] = useState<Record<string, { x: number; y: number }>>({});
  const [previewScaleByPack, setPreviewScaleByPack] = useState<Record<string, { x: number; y: number }>>({});
  const [dragState, setDragState] = useState<{ packId: string; scaleX: number; scaleY: number } | null>(null);
  const [overlayGroupsByPack, setOverlayGroupsByPack] = useState<Record<string, string[]>>({});
  const [groupPatchingPackId, setGroupPatchingPackId] = useState<string | null>(null);
  const [overlayKey, setOverlayKey] = useState(0); // increment to force overlay PNG re-fetch

  // ── Video ──────────────────────────────────────────────────────────────────
  // Phase 2.5 : pré-fill depuis prefillVideoUrl si fourni (mode manualSelect
  // qui démarre direct sur la vidéo finale sans upload).
  const [videoUrl, setVideoUrl] = useState<string | null>(prefillVideoUrl ?? null);
  const [videoName, setVideoName] = useState(prefillVideoName ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Settings ───────────────────────────────────────────────────────────────
  const [startMin, setStartMin] = useState("0");
  const [startSec, setStartSec] = useState("0");
  const [endMin, setEndMin] = useState("0");
  const [endSec, setEndSec] = useState("5");
  const [count, setCount] = useState(12);

  // ── Round state ────────────────────────────────────────────────────────────
  const [roundNumber, setRoundNumber] = useState(0);       // numéro d'affichage (1-based)
  const [seenTimestamps, setSeenTimestamps] = useState<number[]>([]); // tous les ts déjà proposés
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);

  const startSeconds = (parseInt(startMin) || 0) * 60 + (parseInt(startSec) || 0);
  const endSeconds = (parseInt(endMin) || 0) * 60 + (parseInt(endSec) || 0);
  const rangeValid = endSeconds > startSeconds;

  // Calcule en temps réel les candidats restants → sait si un prochain tirage est possible
  const remaining = useMemo(
    () => (rangeValid ? availableCandidates(startSeconds, endSeconds, seenTimestamps) : []),
    [startSeconds, endSeconds, seenTimestamps, rangeValid]
  );
  const canDoNextRound = remaining.length > 0;

  const loadPacks = useCallback(async (silent = false) => {
    if (!silent) setPacksLoading(true);
    try {
      const url = slotId
        ? `/api/cover-packs?slotId=${encodeURIComponent(slotId)}`
        : "/api/cover-packs";
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as CoverPack[];
      setPacks(data);
      setSelectedCandidateByPack((prev) => {
        const next = { ...prev };
        for (const pack of data) {
          if (!next[pack.id] && pack.candidates[0]) next[pack.id] = pack.candidates[0].id;
        }
        return next;
      });
      setOverlayOffsetByPack((prev) => {
        const next = { ...prev };
        for (const pack of data) {
          if (!next[pack.id]) next[pack.id] = { x: pack.overlayOffsetX ?? 0, y: pack.overlayOffsetY ?? 0 };
        }
        return next;
      });
      setOverlayGroupsByPack((prev) => {
        const next = { ...prev };
        for (const pack of data) {
          if (!next[pack.id]) next[pack.id] = pack.overlayGroupIds ?? [];
        }
        return next;
      });
    } catch (err) {
      toast.error(`Erreur chargement packs cover : ${String(err)}`);
    } finally {
      if (!silent) setPacksLoading(false);
    }
  }, [slotId]);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  useEffect(() => {
    const hasPendingPack = packs.some((pack) => pack.status === "QUEUED" || pack.status === "PROCESSING");
    if (!hasPendingPack) return;
    const intervalId = window.setInterval(async () => {
      const prevPacks = packs;
      const res = await fetch("/api/cover-packs").catch(() => null);
      if (!res?.ok) return;
      const nextPacks = await res.json() as CoverPack[];
      // Detect QUEUED/PROCESSING → READY transitions
      for (const next of nextPacks) {
        const prev = prevPacks.find((p) => p.id === next.id);
        if (prev && (prev.status === "QUEUED" || prev.status === "PROCESSING") && next.status === "READY") {
          toast.success(`Cover prête — sélectionnez votre frame (${next.templateName}${next.client ? ` · ${next.client}` : ""})`);
        }
      }
      setPacks(nextPacks);
      setSelectedCandidateByPack((prev) => {
        const next = { ...prev };
        for (const pack of nextPacks) {
          if (!next[pack.id] && pack.candidates[0]) next[pack.id] = pack.candidates[0].id;
        }
        return next;
      });
      setOverlayOffsetByPack((prev) => {
        const next = { ...prev };
        for (const pack of nextPacks) {
          if (!next[pack.id]) next[pack.id] = { x: pack.overlayOffsetX ?? 0, y: pack.overlayOffsetY ?? 0 };
        }
        return next;
      });
      setOverlayGroupsByPack((prev) => {
        const next = { ...prev };
        for (const pack of nextPacks) {
          if (!next[pack.id]) next[pack.id] = pack.overlayGroupIds ?? [];
        }
        return next;
      });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [loadPacks, packs]);

  useEffect(() => {
    if (!dragState) return;
    const handleMove = (event: PointerEvent) => {
      setOverlayOffsetByPack((prev) => {
        const current = prev[dragState.packId] ?? { x: 0, y: 0 };
        return {
          ...prev,
          [dragState.packId]: {
            x: Math.round(current.x + event.movementX * dragState.scaleX),
            y: Math.round(current.y + event.movementY * dragState.scaleY),
          },
        };
      });
    };
    const handleUp = () => setDragState(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragState]);

  const regeneratePack = useCallback(async (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (pack?.status === "SELECTED") {
      const confirmed = await confirm({
        title: "Régénérer un nouveau tirage ?",
        description: "Cela supprimera la cover actuelle et relancera l'extraction des frames.",
        confirmLabel: "Régénérer",
        variant: "danger",
      });
      if (!confirmed) return;
    }
    setPackBusyId(packId);
    try {
      const res = await fetch(`/api/cover-packs/${packId}/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Nouveau tirage lancé.");
      await loadPacks();
    } catch (err) {
      toast.error(`Erreur nouveau tirage : ${String(err)}`);
    } finally {
      setPackBusyId(null);
    }
  }, [confirm, loadPacks, packs]);

  const selectPackCover = useCallback(async (packId: string) => {
    const candidateId = selectedCandidateByPack[packId];
    if (!candidateId) return;
    const confirmed = await confirm({
      title: "Valider cette cover ?",
      description: "Les autres frames candidates seront supprimées. Cette action est irréversible.",
      confirmLabel: "Valider",
    });
    if (!confirmed) return;
    const offset = overlayOffsetByPack[packId] ?? { x: 0, y: 0 };
    setPackBusyId(packId);
    try {
      const res = await fetch(`/api/cover-packs/${packId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          overlayOffsetX: offset.x,
          overlayOffsetY: offset.y,
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      // Phase V2 — friction HIGH-4 du audit 2026-05-31 : avant on restait
      // bloqué sur l'outil après le seul clic qui compte. Désormais, si on
      // vient d'une fiche publication (slotId), on rebondit dessus avec un
      // toast confirmant l'application. Sans slotId, comportement legacy.
      if (slotId) {
        toast.success("Cover appliquée à la publication.");
        router.push(`/publications/${slotId}`);
        return;
      }
      toast.success("Cover PNG générée.");
      await loadPacks();
    } catch (err) {
      toast.error(`Erreur génération cover : ${String(err)}`);
    } finally {
      setPackBusyId(null);
    }
  }, [confirm, loadPacks, overlayOffsetByPack, selectedCandidateByPack, router, slotId]);

  const patchPackOverlayGroups = useCallback(async (packId: string, groupIds: string[]) => {
    // Optimistic update
    setOverlayGroupsByPack((prev) => ({ ...prev, [packId]: groupIds }));
    setGroupPatchingPackId(packId);
    try {
      const res = await fetch(`/api/cover-packs/${packId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlayGroupIds: groupIds }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      // Force overlay PNG re-fetch (new group config changes the overlay)
      setOverlayKey((k) => k + 1);
    } catch (err) {
      toast.error(`Erreur mise à jour groupes : ${String(err)}`);
      // Revert optimistic update — reload from server
      await loadPacks(true);
    } finally {
      setGroupPatchingPackId(null);
    }
  }, [loadPacks]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    try {
      const r = await fetch("/api/upload-presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { uploadUrl, publicUrl } = await r.json() as { uploadUrl: string; publicUrl: string };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () =>
          xhr.status < 400 ? resolve() : reject(new Error(`Upload HTTP ${xhr.status}`))
        );
        xhr.addEventListener("error", () => reject(new Error("Erreur réseau lors de l'upload")));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      setVideoUrl(publicUrl);
      setVideoName(file.name);
      setRoundNumber(0);
      setSeenTimestamps([]);
      setFrames([]);
      setSelected(new Set());
      setHasExtracted(false);
    } catch (err) {
      toast.error(`Erreur d'upload : ${String(err)}`);
    } finally {
      setUploading(false);
    }
  }, []);

  // ── Frame extraction ───────────────────────────────────────────────────────
  const extractFrames = useCallback(
    async (seen: number[]) => {
      if (!videoUrl || !rangeValid) return;
      const candidates = availableCandidates(startSeconds, endSeconds, seen);
      const timestamps = pickFromCandidates(candidates, count);
      if (timestamps.length === 0) return;
      setLoading(true);
      try {
        const res = await fetch("/api/cover-frames", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl, timestamps }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json() as Frame[];
        // Marquer les timestamps effectivement proposés comme vus
        setSeenTimestamps((prev) => [...prev, ...timestamps]);
        setFrames(data);
        setSelected(new Set());
        setHasExtracted(true);
      } catch (err) {
        toast.error(`Erreur extraction : ${String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [videoUrl, startSeconds, endSeconds, count, rangeValid]
  );

  const handleExtract = () => {
    setSeenTimestamps([]);
    setRoundNumber(1);
    void extractFrames([]);
  };

  const handleNewRound = () => {
    setRoundNumber((n) => n + 1);
    void extractFrames(seenTimestamps);
  };

    const toggleSelect = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); } else { next.add(i); }
      return next;
    });

  const handleDownload = async () => {
    const toDownload = frames.filter((_, i) => selected.has(i));
    for (const frame of toDownload) {
      try {
        const r = await fetch(frame.url);
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `cover_${fmt(frame.timestamp).replace(":", "m")}s.jpg`;
        a.click();
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore individual failures
      }
    }
  };

  const clearVideo = () => {
    setVideoUrl(null);
    setVideoName("");
    setFrames([]);
    setHasExtracted(false);
    setSeenTimestamps([]);
    setRoundNumber(0);
  };

  // Switch tab to manual if no packs exist after loading
  useEffect(() => {
    if (!packsLoading && packs.length === 0) setActiveTab("manual");
  }, [packsLoading, packs.length]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <ToolPageHeader
        icon={ImageIcon}
        iconColor="emerald"
        title="Générateur de covers"
        subtitle="Générez et sélectionnez la cover de vos vidéos."
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("packs")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "packs" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Layers size={14} />
          Packs semi-auto
          {!packsLoading && packs.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === "packs" ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"
            }`}>
              {packs.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("manual")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "manual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Upload size={14} />
          Extraction manuelle
        </button>
      </div>

      {activeTab === "packs" && (
      <section className="mb-8 bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Packs automatiques</h2>
            <p className="text-xs text-gray-500 mt-0.5">Frames préparées depuis les renders vidéo des templates activées.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadPacks()}
            disabled={packsLoading}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw size={14} className={packsLoading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>

        {packsLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="h-64 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : packs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm font-medium text-gray-700">Aucun pack cover à traiter.</p>
            <p className="text-xs text-gray-400 mt-1">Les prochains renders vidéo avec cover activée apparaîtront ici.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {packs.map((pack) => {
              const selectedId = selectedCandidateByPack[pack.id];
              const selectedFrame = pack.candidates.find((candidate) => candidate.id === selectedId) ?? pack.candidates[0];
              const offset = overlayOffsetByPack[pack.id] ?? { x: 0, y: 0 };
              const isBusy = packBusyId === pack.id;
              const ready = pack.status === "READY" && pack.candidates.length > 0;
              const selected = pack.status === "SELECTED" && pack.finalCoverUrl;
              return (
                <article key={pack.id} className="rounded-xl border border-gray-100 bg-gray-50/40 overflow-hidden">
                  <div className="grid gap-0 md:grid-cols-[minmax(220px,360px)_1fr]">
                    <div className="bg-white p-0 md:p-4 flex items-start justify-center">
                      {selected ? (
                        <div className="relative mx-auto aspect-[9/16] w-full max-w-[min(360px,36vh)] overflow-hidden rounded-lg bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pack.finalCoverUrl ?? ""} alt="Cover finale" className="absolute inset-0 h-full w-full object-contain" />
                        </div>
                      ) : selectedFrame ? (
                        <div
                          className={`relative mx-auto aspect-[9/16] w-full max-w-[min(360px,36vh)] overflow-hidden rounded-lg bg-white select-none touch-none ${dragState?.packId === pack.id ? "cursor-grabbing" : "cursor-grab"}`}
                          onPointerDown={(event) => {
                            const target = event.target as HTMLElement;
                            if (target.closest("button,a,input")) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            const scaleX = (pack.canvasWidth || 1080) / Math.max(1, rect.width);
                            const scaleY = (pack.canvasHeight || 1920) / Math.max(1, rect.height);
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setDragState({ packId: pack.id, scaleX, scaleY });
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedFrame.imageUrl}
                            alt="Frame sélectionnée"
                            className="absolute inset-0 h-full w-full object-cover"
                            onLoad={(event) => {
                              const img = event.currentTarget;
                              setPreviewScaleByPack((prev) => ({
                                ...prev,
                                [pack.id]: {
                                  x: img.clientWidth / Math.max(1, pack.canvasWidth || 1080),
                                  y: img.clientHeight / Math.max(1, pack.canvasHeight || 1920),
                                },
                              }));
                            }}
                          />
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/cover-packs/${pack.id}/overlay?v=${overlayKey}`}
                            alt=""
                            aria-hidden
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                            style={{
                              transform: `translate(${Math.round(offset.x * (previewScaleByPack[pack.id]?.x ?? 1))}px, ${Math.round(offset.y * (previewScaleByPack[pack.id]?.y ?? 1))}px)`,
                            }}
                          />
                        </div>
                      ) : (
                        <div className="mx-auto aspect-[9/16] w-full max-w-[360px] rounded-lg flex items-center justify-center text-xs text-gray-400 bg-white">Aucune frame</div>
                      )}
                    </div>

                    <div className="flex-1 p-4 md:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-gray-900 truncate">
                            {pack.templateName}{pack.client ? ` · ${pack.client}` : ""}
                          </h3>
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              pack.status === "READY" ? "bg-green-50 text-green-600" :
                              pack.status === "SELECTED" ? "bg-indigo-50 text-indigo-600" :
                              pack.status === "FAILED" ? "bg-red-50 text-red-500" :
                              "bg-indigo-50 text-indigo-600"
                            }`}>
                              {pack.status === "READY" ? "À choisir" : pack.status === "SELECTED" ? "Cover validée" : pack.status === "FAILED" ? "Erreur" : "Préparation…"}
                            </span>
                            <span className="text-[10px] text-gray-400">{new Date(pack.createdAt).toLocaleString("fr-FR")}</span>
                            {pack.ownerName && <span className="text-[10px] text-gray-400">{pack.ownerName}</span>}
                          </div>
                          {selected && (
                            <p className="text-[10px] text-indigo-500 mt-1">Cover enregistrée sur ce rendu.</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {selected && (
                            <>
                              <Link
                                href={`/renders/${pack.renderId}`}
                                className="px-3 py-2 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors"
                              >
                                Voir le rendu →
                              </Link>
                              <a
                                href={pack.finalCoverUrl ?? ""}
                                download
                                className="px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-700 transition-colors flex items-center gap-1.5"
                              >
                                <Download size={13} />
                                PNG
                              </a>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => void regeneratePack(pack.id)}
                            disabled={isBusy || pack.status === "PROCESSING" || pack.status === "QUEUED"}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <RefreshCw size={13} className={isBusy ? "animate-spin" : ""} />
                            Nouveau tirage
                          </button>
                        </div>
                      </div>

                      {pack.errorMsg && (
                        <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{pack.errorMsg}</p>
                      )}

                      {ready && (
                        <>
                          {/* Frame thumbnail grid */}
                          <div className="mt-4 max-h-[340px] overflow-y-auto pr-1">
                            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                              {pack.candidates.map((candidate) => {
                                const seqLabel = candidate.sequenceIndex !== null
                                  ? `S${candidate.sequenceIndex + 1}`
                                  : null;
                                const titleLabel = candidate.slotId
                                  ? `${candidate.slotId} · ${fmt(candidate.timestamp)}`
                                  : fmt(candidate.timestamp);
                                return (
                                  <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => setSelectedCandidateByPack((prev) => ({ ...prev, [pack.id]: candidate.id }))}
                                    className={`relative rounded-lg overflow-hidden border-2 transition ${
                                      selectedId === candidate.id ? "border-indigo-500 shadow-sm" : "border-transparent hover:border-gray-300"
                                    }`}
                                    title={titleLabel}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={candidate.imageUrl} alt={fmt(candidate.timestamp)} className="w-full aspect-[9/16] object-cover" loading="lazy" />
                                    {selectedId === candidate.id && (
                                      <span className="absolute top-1 right-1 w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                                        <Check size={9} className="text-white" strokeWidth={3} />
                                      </span>
                                    )}
                                    {seqLabel && (
                                      <span className="absolute top-1 left-1 text-[9px] font-bold bg-black/60 text-white px-1 py-0.5 rounded">
                                        {seqLabel}
                                      </span>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                                      <span className="text-[9px] font-medium text-white">{fmt(candidate.timestamp)}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Overlay groups toggle */}
                          {pack.templateGroups.filter((g) => !g.hidden && !g.locked).length > 0 ? (
                            <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-gray-600">Overlays</span>
                                {groupPatchingPackId === pack.id && (
                                  <span className="text-[10px] text-indigo-500">Enregistrement…</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {pack.templateGroups
                                  .filter((g) => !g.hidden && !g.locked)
                                  .map((group) => {
                                    const currentGroupIds = overlayGroupsByPack[pack.id] ?? pack.overlayGroupIds;
                                    const isChecked = currentGroupIds.includes(group.id);
                                    return (
                                      <label
                                        key={group.id}
                                        className={`flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1 rounded-md border transition-colors ${
                                          isChecked
                                            ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                            : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                                        } ${groupPatchingPackId === pack.id ? "opacity-60 pointer-events-none" : ""}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          className="accent-indigo-600 w-3 h-3"
                                          disabled={groupPatchingPackId === pack.id}
                                          onChange={(event) => {
                                            const checked = event.target.checked;
                                            const next = checked
                                              ? [...currentGroupIds, group.id]
                                              : currentGroupIds.filter((id) => id !== group.id);
                                            void patchPackOverlayGroups(pack.id, next);
                                          }}
                                        />
                                        {group.name}
                                      </label>
                                    );
                                  })}
                              </div>
                              {(overlayGroupsByPack[pack.id] ?? pack.overlayGroupIds).length === 0 && (
                                <p className="text-[10px] text-gray-400 mt-1.5">Aucun overlay — la cover sera la frame brute.</p>
                              )}
                            </div>
                          ) : pack.templateGroups.length === 0 ? (
                            <p className="mt-3 text-[10px] text-gray-400">Ce template n&apos;a pas d&apos;overlays.</p>
                          ) : null}

                          {/* Offset controls */}
                          <div className="mt-4 flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span className="w-16 shrink-0">X</span>
                              <input
                                type="range"
                                min={-(pack.canvasWidth ?? 1080)}
                                max={pack.canvasWidth ?? 1080}
                                step={1}
                                value={offset.x}
                                onChange={(event) => setOverlayOffsetByPack((prev) => ({
                                  ...prev,
                                  [pack.id]: { x: Number(event.target.value) || 0, y: offset.y },
                                }))}
                                className="min-w-0 flex-1 accent-indigo-600"
                                aria-label="Décalage horizontal"
                              />
                              <input
                                type="number"
                                value={offset.x}
                                onChange={(event) => setOverlayOffsetByPack((prev) => ({
                                  ...prev,
                                  [pack.id]: { x: Number(event.target.value) || 0, y: offset.y },
                                }))}
                                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                aria-label="Décalage horizontal"
                              />
                              <span className="w-14 shrink-0">px horiz.</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span className="w-16 shrink-0">Y</span>
                              <input
                                type="range"
                                min={-(pack.canvasHeight ?? 1920)}
                                max={pack.canvasHeight ?? 1920}
                                step={1}
                                value={offset.y}
                                onChange={(event) => setOverlayOffsetByPack((prev) => ({
                                  ...prev,
                                  [pack.id]: { x: offset.x, y: Number(event.target.value) || 0 },
                                }))}
                                className="min-w-0 flex-1 accent-indigo-600"
                                aria-label="Décalage vertical"
                              />
                              <input
                                type="number"
                                value={offset.y}
                                onChange={(event) => setOverlayOffsetByPack((prev) => ({
                                  ...prev,
                                  [pack.id]: { x: offset.x, y: Number(event.target.value) || 0 },
                                }))}
                                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                aria-label="Décalage vertical"
                              />
                              <span className="w-14 shrink-0">px vert.</span>
                            </div>
                          </div>

                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void selectPackCover(pack.id)}
                              disabled={!selectedId || isBusy}
                              className="sm:ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                            >
                              {isBusy ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Check size={14} />}
                              Valider cette cover
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {activeTab === "manual" && (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Upload */}
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Vidéo source</h2>
            {videoUrl ? (
              <div className="flex items-center gap-3 py-3 px-4 bg-green-50 rounded-xl border border-green-100">
                <Film size={17} className="text-green-600 shrink-0" />
                <span className="text-sm text-green-800 truncate flex-1 min-w-0">{videoName}</span>
                <button
                  type="button"
                  onClick={clearVideo}
                  className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Supprimer la vidéo"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex flex-col items-center gap-3 py-10 px-6 border-2 border-dashed border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <div className="w-7 h-7 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <span className="text-sm text-gray-500">
                      Envoi en cours… {uploadProgress}%
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={22} className="text-gray-400" />
                    <span className="text-sm text-gray-500">Cliquer pour choisir une vidéo</span>
                    <span className="text-xs text-gray-400">MP4, MOV, WebM — max 2 Go</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelect(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Frames grid */}
          {(hasExtracted || loading) && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">
                  Tirage #{roundNumber}
                  {!loading && frames.length > 0 && (
                    <span className="font-normal text-gray-400 ml-1.5">— {frames.length} frames</span>
                  )}
                </h2>
                {selected.size > 0 && (
                  <span className="text-xs font-medium text-indigo-600">
                    {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="aspect-[9/16] bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : frames.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  Aucune frame extraite pour cette plage.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {frames.map((frame, i) => (
                    <button
                      key={frame.url}
                      type="button"
                      onClick={() => toggleSelect(i)}
                      className={`relative block w-full rounded-xl overflow-hidden border-2 transition-all ${
                        selected.has(i)
                          ? "border-indigo-500 shadow-md scale-[1.02]"
                          : "border-transparent hover:border-gray-300"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={frame.url}
                        alt={`${fmt(frame.timestamp)}`}
                        className="w-full h-auto block"
                        loading="lazy"
                      />
                      {selected.has(i) && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center shadow">
                          <Check size={11} className="text-white" strokeWidth={3} />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                        <span className="text-[10px] font-medium text-white">{fmt(frame.timestamp)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          {/* Settings */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Paramètres</h2>
            <div className="flex flex-col gap-4">
              {/* Start */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Début</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={startMin}
                    onChange={(e) => setStartMin(e.target.value)}
                    className="w-14 text-center rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="0"
                  />
                  <span className="text-xs text-gray-400">min</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={startSec}
                    onChange={(e) => setStartSec(e.target.value)}
                    className="w-14 text-center rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="0"
                  />
                  <span className="text-xs text-gray-400">sec</span>
                </div>
              </div>

              {/* End */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Fin</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={endMin}
                    onChange={(e) => setEndMin(e.target.value)}
                    className="w-14 text-center rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="0"
                  />
                  <span className="text-xs text-gray-400">min</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={endSec}
                    onChange={(e) => setEndSec(e.target.value)}
                    className="w-14 text-center rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="30"
                  />
                  <span className="text-xs text-gray-400">sec</span>
                </div>
                {!rangeValid && (startMin || startSec || endMin || endSec) && (
                  <p className="text-xs text-red-500 mt-1.5">La fin doit être après le début.</p>
                )}
              </div>

              {/* Count */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                  Frames par tirage :{" "}
                  <span className="text-gray-900 font-semibold">{count}</span>
                </label>
                <input
                  type="range"
                  min="6"
                  max="20"
                  value={count}
                  onChange={(e) => {
                    setCount(parseInt(e.target.value));
                    setSeenTimestamps([]);
                    setRoundNumber(0);
                    setFrames([]);
                    setHasExtracted(false);
                  }}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                  <span>6</span>
                  <span>20</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleExtract}
              disabled={!videoUrl || !rangeValid || loading || uploading}
              className="w-full py-2.5 px-4 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Extraction…
                </>
              ) : (
                <>
                  <Film size={14} />
                  Extraire les frames
                </>
              )}
            </button>

            {hasExtracted && canDoNextRound && (
              <button
                type="button"
                onClick={handleNewRound}
                disabled={loading}
                className="w-full py-2.5 px-4 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                Nouveau tirage
              </button>
            )}

            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="w-full py-2.5 px-4 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors flex items-center justify-center gap-2"
              >
                <Download size={14} />
                Télécharger ({selected.size})
              </button>
            )}

            {hasExtracted && !canDoNextRound && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                <p className="text-xs font-semibold text-amber-800">
                  Toutes les frames ont été proposées.
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Modifiez la plage de temps pour continuer.
                </p>
              </div>
            )}

            {hasExtracted && canDoNextRound && (
              <p className="text-center text-xs text-gray-400">
                {remaining.length} frame{remaining.length > 1 ? "s" : ""} restante{remaining.length > 1 ? "s" : ""} dans la plage
              </p>
            )}
          </div>
        </div>
      </div>
      )}
      {confirmDialog}
    </div>
  );
}

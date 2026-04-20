"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Film, Upload, Download, RefreshCw, Check, X, Image as ImageIcon } from "lucide-react";
import { toast } from "@/components/ui/Toast";

// Espace minimum entre deux timestamps distincts.
// 1/30s couvre la plupart des vidéos (30fps). Si la vidéo est en 60fps
// les deux frames les plus proches seront identiques visuellement de toute façon.
const MIN_FRAME_GAP_S = 1 / 30;

type Frame = { timestamp: number; url: string };

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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

export function CoverGenerator() {
  // ── Video ──────────────────────────────────────────────────────────────────
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shrink-0">
          <ImageIcon size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Générateur de covers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Extrayez des frames depuis une vidéo pour choisir votre cover idéale.
          </p>
        </div>
      </div>

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
    </div>
  );
}

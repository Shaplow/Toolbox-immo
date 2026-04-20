"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scissors, Upload, Clock, CheckCircle, XCircle, Loader2, Film, Plus, X, ChevronDown, Settings } from "lucide-react";
import type { DerushJobCreatePayload, DerushFormat } from "@/types/derush";

const VIDEO_ACCEPT = ".mp4,.mov,.mkv,.webm,.avi,.mts,.m2ts,.mxf";
const SRT_ACCEPT   = ".srt,.json,.vtt";

type Preset = { id: string; name: string; analysisMode: string; isBuiltin: boolean };

const WHISPER_MODELS = [
  { value: "large-v3-turbo", label: "large-v3-turbo (défaut)" },
  { value: "large-v3", label: "large-v3 (plus précis, +lent)" },
  { value: "medium", label: "medium (rapide)" },
];

type Job = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  analysisMode: "vision" | "transcription";
  visionProvider: string;
  presetName: string | null;
  fileCount: number;
  segmentCount: number | null;
  totalDuration: number | null;
  createdAt: string;
};

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_ICON: Record<Job["status"], React.ReactNode> = {
  QUEUED:     <Clock className="w-4 h-4 text-gray-400" />,
  PROCESSING: <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />,
  COMPLETED:  <CheckCircle className="w-4 h-4 text-green-500" />,
  FAILED:     <XCircle className="w-4 h-4 text-red-500" />,
};

const STATUS_LABEL: Record<Job["status"], string> = {
  QUEUED:     "En attente",
  PROCESSING: "En cours",
  COMPLETED:  "Terminé",
  FAILED:     "Échec",
};

export function DerushList({ initialJobs }: { initialJobs: Job[] }) {
  const router = useRouter();
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const srtInputRef     = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [dragging, setDragging]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Presets
  const [presets, setPresets]   = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState<string>("");

  // Pending files (multi-file)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Options
  const [analysisMode, setAnalysisMode] = useState<"vision" | "transcription">("vision");
  const [visionProvider, setVisionProvider] = useState("heuristic");

  // Transcription-specific options
  const [transcrLang, setTranscrLang]   = useState("fr");
  const [transcrModel, setTranscrModel] = useState("large-v3-turbo");
  const [srtFile, setSrtFile]           = useState<File | null>(null);  // upload SRT instead of running whisper

  // Format
  const [formats, setFormats]           = useState<DerushFormat[]>([]);
  const [formatId, setFormatId]         = useState<string>("");
  const [enableDiarization, setEnableDiarization] = useState(false);

  // Upload progress per file
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});

  // Load presets filtered to current analysis mode
  useEffect(() => {
    fetch("/api/derush-presets")
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((data: Preset[]) => setPresets(data.filter((p) => p.analysisMode === analysisMode)))
      .catch(() => {/* ignore */});
    setPresetId(""); // reset selection on mode change
  }, [analysisMode]);

  // Load formats
  useEffect(() => {
    fetch("/api/derush/formats")
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((data: DerushFormat[]) => setFormats(data))
      .catch(() => {/* ignore */});
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const next = arr.filter((f) => !existing.has(f.name));
      return [...prev, ...next].slice(0, 20);
    });
  }, []);

  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submitJob = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    setError(null);
    setSubmitting(true);
    setUploadProgress({});

    try {
      // ── Étape 1 : créer le job + obtenir les URLs pré-signées ────────────
      const payload: DerushJobCreatePayload = {
        files: pendingFiles.map((f) => ({
          filename: f.name,
          ext: f.name.split(".").pop()?.toLowerCase() ?? "mp4",
          contentType: f.type || "video/mp4",
        })),
        analysisMode,
        presetId: presetId || undefined,
        formatId: analysisMode === "transcription" ? (formatId || undefined) : undefined,
        enableDiarization: analysisMode === "transcription" ? enableDiarization : undefined,
        visionProvider: analysisMode === "vision" ? visionProvider : undefined,
        // Transcription options are passed via JSON extra fields interpreted by the submit route
        ...(analysisMode === "transcription" ? {
          transcriptionLanguage: transcrLang,
          transcriptionModel: transcrModel,
          ...(srtFile ? {
            transcriptionInputFilename: srtFile.name,
            transcriptionInputExt: srtFile.name.split(".").pop()?.toLowerCase() ?? "srt",
          } : {}),
        } : {}),
      };

      const createRes = await fetch("/api/derush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json() as {
        jobId?: string; uploadUrls?: string[];
        transcriptionUploadUrl?: string; error?: string;
      };
      if (!createRes.ok) throw new Error(createData.error ?? `Erreur ${createRes.status}`);

      const { jobId, uploadUrls, transcriptionUploadUrl } = createData;
      if (!jobId || !uploadUrls) throw new Error("Réponse invalide du serveur");

      // ── Étape 2 : upload direct vers R2 pour chaque fichier ──────────────
      const uploads: Promise<void>[] = pendingFiles.map((file, idx) =>
        new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrls[idx]);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setUploadProgress((prev) => ({ ...prev, [idx]: Math.round((e.loaded / e.total) * 100) }));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress((prev) => ({ ...prev, [idx]: 100 }));
              resolve();
            } else {
              reject(new Error(`Upload R2 fichier ${idx + 1} échoué : ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error(`Erreur réseau fichier ${idx + 1}`));
          xhr.send(file);
        })
      );

      // SRT upload if present
      if (srtFile && transcriptionUploadUrl) {
        uploads.push(new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", transcriptionUploadUrl);
          xhr.setRequestHeader("Content-Type", "text/plain");
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload SRT échoué : ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("Erreur réseau SRT"));
          xhr.send(srtFile);
        }));
      }

      await Promise.all(uploads);

      // ── Étape 3 : déclencher RunPod ──────────────────────────────────────
      const submitRes = await fetch(`/api/derush/${jobId}/submit`, { method: "POST" });
      if (!submitRes.ok) {
        const submitErr = await submitRes.json() as { error?: string };
        throw new Error(submitErr.error ?? `Erreur submit ${submitRes.status}`);
      }

      router.push(`/tools/derush/${jobId}`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setSubmitting(false);
      setUploadProgress({});
    }
  }, [pendingFiles, analysisMode, visionProvider, presetId, formatId, enableDiarization, transcrLang, transcrModel, srtFile, router]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
    e.target.value = "";
  }, [addFiles]);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/derush");
      if (res.ok) {
        const data = await res.json() as Job[];
        setJobs(data);
      }
    } catch { /* silently ignore */ }
  }, []);

  // Total upload progress
  const progressValues = Object.values(uploadProgress);
  const avgProgress = progressValues.length > 0
    ? Math.round(progressValues.reduce((a, b) => a + b, 0) / pendingFiles.length)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-rose-600 rounded-xl flex items-center justify-center text-white">
          <Scissors className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dérush</h1>
          <p className="text-sm text-gray-500">Sélection automatique des meilleurs plans par vision IA ou transcription</p>
        </div>
      </div>

      {/* Drop zone / file picker */}
      <div
        role="button"
        tabIndex={0}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
          dragging ? "border-rose-400 bg-rose-50" : "border-gray-200 hover:border-rose-300 hover:bg-gray-50"
        } ${submitting ? "pointer-events-none opacity-60" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
      >
        <input ref={fileInputRef} type="file" accept={VIDEO_ACCEPT} multiple className="hidden" onChange={handleFileInput} />
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Upload className="w-8 h-8" />
          <div>
            <p className="font-medium text-gray-600">Déposez vos fichiers vidéo ici</p>
            <p className="text-sm mt-1">mp4, mov, mkv, mts… — multi-sélection (max 20)</p>
          </div>
        </div>
      </div>

      {/* Pending files list */}
      {pendingFiles.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
          {pendingFiles.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className="flex items-center gap-3 px-4 py-3">
              <Film className="w-4 h-4 text-gray-300 shrink-0" />
              <span className="flex-1 text-sm text-gray-700 truncate">{file.name}</span>
              {uploadProgress[idx] !== undefined && (
                <div className="w-20">
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 transition-all duration-150" style={{ width: `${uploadProgress[idx]}%` }} />
                  </div>
                </div>
              )}
              <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(0)} Mo</span>
              {!submitting && (
                <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="text-gray-300 hover:text-red-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Options ───────────────────────────────────────────────────────── */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Pipeline d&apos;analyse</p>

        {/* Analysis mode */}
        <div className="grid grid-cols-2 gap-3">
          {(["vision", "transcription"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAnalysisMode(mode)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                analysisMode === mode ? "border-rose-500 bg-rose-50" : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="text-sm font-medium text-gray-800">{mode === "vision" ? "Vision IA" : "Transcription"}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {mode === "vision" ? "Netteté, stabilité, exposition, plan" : "Contenu, banter, retakes, speaker"}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {mode === "vision" ? "Rushes vidéo, B-roll" : "Podcast, interview, tuto"}
              </div>
            </button>
          ))}
        </div>

        {/* Preset selector */}
        {presets.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Preset de scoring</label>
            <div className="relative">
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                <option value="">— Paramètres par défaut —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isBuiltin ? " (builtin)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Vision-specific */}
        {analysisMode === "vision" && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Fournisseur d&apos;analyse</label>
            <select
              value={visionProvider}
              onChange={(e) => setVisionProvider(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <option value="heuristic">Heuristique (OpenCV — local, gratuit)</option>
            </select>
            <p className="text-xs text-gray-400">Détection de plans, métriques de netteté/stabilité/exposition. Prochainement : Gemini Vision, GPT-4o.</p>
          </div>
        )}

        {/* Transcription-specific */}
        {analysisMode === "transcription" && (
          <div className="space-y-3">
            {/* Format selector */}
            {formats.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Format de segmentation</label>
                  <Link href="/tools/derush/formats" className="flex items-center gap-1 text-xs text-rose-600 hover:underline">
                    <Settings className="w-3 h-3" />
                    Gérer les formats
                  </Link>
                </div>
                <div className="relative">
                  <select
                    value={formatId}
                    onChange={(e) => setFormatId(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <option value="">— Aucun format (découpe par défaut) —</option>
                    {formats.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}{f.isBuiltin ? " ★" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                {formatId && (() => {
                  const selected = formats.find((f) => f.id === formatId);
                  return selected?.description ? (
                    <p className="text-xs text-gray-400">{selected.description}</p>
                  ) : null;
                })()}
              </div>
            )}

            {/* Diarization checkbox */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableDiarization}
                onChange={(e) => setEnableDiarization(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-rose-500"
              />
              <span className="text-sm text-gray-700">Activer la séparation par speaker (diarisation)</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Langue</label>
                <select
                  value={transcrLang}
                  onChange={(e) => setTranscrLang(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="it">Italiano</option>
                  <option value="pt">Português</option>
                  <option value="auto">Détection auto</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Modèle Whisper</label>
                <select
                  value={transcrModel}
                  onChange={(e) => setTranscrModel(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* SRT upload option */}
            <div className="rounded-lg border border-dashed border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Importer une transcription existante</p>
                  <p className="text-xs text-gray-400 mt-0.5">Fichier SRT, VTT ou JSON — évite la transcription Whisper</p>
                </div>
                <button
                  type="button"
                  onClick={() => srtInputRef.current?.click()}
                  className="text-xs text-violet-600 hover:underline shrink-0 ml-3"
                >
                  {srtFile ? "Changer" : "Importer"}
                </button>
                <input ref={srtInputRef} type="file" accept={SRT_ACCEPT} className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  setSrtFile(f ?? null);
                  e.target.value = "";
                }} />
              </div>
              {srtFile && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  <span className="truncate">{srtFile.name}</span>
                  <button type="button" onClick={() => setSrtFile(null)} className="text-gray-300 hover:text-red-400 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Submit button */}
      <button
        type="button"
        onClick={() => void submitJob()}
        disabled={pendingFiles.length === 0 || submitting}
        className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {avgProgress !== null && avgProgress < 100 ? `Upload… ${avgProgress}%` : "Analyse en cours…"}
          </>
        ) : (
          <>
            <Plus className="w-4 h-4" />
            Lancer l&apos;analyse
            {pendingFiles.length > 0 && ` (${pendingFiles.length} fichier${pendingFiles.length > 1 ? "s" : ""})`}
          </>
        )}
      </button>

      {/* Jobs list */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Analyses récentes</p>
            <button type="button" onClick={() => void refreshJobs()} className="text-xs text-rose-600 hover:underline">
              Actualiser
            </button>
          </div>
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <a
                  href={`/tools/derush/${job.id}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-rose-200 hover:bg-rose-50/30 transition-colors"
                >
                  <Film className="w-5 h-5 text-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {job.fileCount} fichier{job.fileCount > 1 ? "s" : ""} ·{" "}
                      <span className="text-gray-500">{job.analysisMode === "vision" ? "Vision IA" : "Transcription"}</span>
                      {job.presetName && <span className="text-gray-400"> · {job.presetName}</span>}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(job.createdAt)}
                      {job.segmentCount != null && ` · ${job.segmentCount} segments`}
                      {job.totalDuration != null && ` · ${fmtDuration(job.totalDuration)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {STATUS_ICON[job.status]}
                    <span className="text-xs text-gray-500">{STATUS_LABEL[job.status]}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

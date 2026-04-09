"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mic, Upload, Clock, CheckCircle, XCircle, Loader2, FileAudio } from "lucide-react";

const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.flac,.ogg,.aac,.mp4,.mov,.mkv,.webm";

type Job = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  inputFilename: string | null;
  model: string;
  language: string;
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: string;
  errorMsg: string | null;
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

export function TranscriptionList({
  initialJobs,
}: {
  initialJobs: Job[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [model, setModel] = useState("turbo");
  const [language, setLanguage] = useState("fr");
  const [enableDiarization, setEnableDiarization] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const submit = useCallback(async (file: File) => {
    setError(null);
    setSubmitting(true);
    setUploadProgress(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

      // ── Étape 1 : obtenir une URL pré-signée + jobId (pas de fichier envoyé ici) ──
      const prepareRes = await fetch("/api/transcription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, ext, model, language, enable_diarization: enableDiarization }),
      });
      const prepareData = await prepareRes.json() as { jobId?: string; uploadUrl?: string; error?: string };
      if (!prepareRes.ok) throw new Error(prepareData.error ?? `Erreur ${prepareRes.status}`);

      const { jobId, uploadUrl } = prepareData;
      if (!jobId) throw new Error("Réponse invalide du serveur");

      if (uploadUrl) {
        // ── Étape 2 : upload direct vers R2 (contourne complètement Next.js) ──
        setUploadProgress(0);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload R2 échoué : ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
          xhr.send(file);
        });
        setUploadProgress(100);

        // ── Étape 3 : déclencher RunPod ──────────────────────────────────────
        const submitRes = await fetch(`/api/transcription/${jobId}/submit`, { method: "POST" });
        if (!submitRes.ok) {
          const submitErr = await submitRes.json() as { error?: string };
          throw new Error(submitErr.error ?? `Erreur submit ${submitRes.status}`);
        }
      }

      router.push(`/tools/transcription/${jobId}`);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setSubmitting(false);
      setUploadProgress(null);
    }
  }, [model, language, enableDiarization, router]);

  const handleFile = useCallback(async (file: File) => {
    await submit(file);
  }, [submit]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/transcription");
      if (res.ok) {
        const data = await res.json() as { jobs: Job[] };
        setJobs(data.jobs);
      }
    } catch { /* silently ignore */ }
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
          <Mic className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transcription</h1>
          <p className="text-sm text-gray-500">Convertissez audio et vidéo en texte, SRT ou chunks pour l&apos;IA</p>
        </div>
      </div>

      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"
        } ${submitting ? "pointer-events-none opacity-70" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void handleDrop(e)}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(e) => void handleFileInput(e)}
        />
        {submitting ? (
          <div className="flex flex-col items-center gap-3 text-indigo-600">
            <Loader2 className="w-8 h-8 animate-spin" />
            {uploadProgress !== null && uploadProgress < 100 ? (
              <div className="w-48 space-y-1">
                <p className="font-medium text-sm text-center">Upload en cours… {uploadProgress}%</p>
                <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            ) : (
              <p className="font-medium">Envoi en cours…</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <Upload className="w-8 h-8" />
            <div>
              <p className="font-medium text-gray-700">Déposez un fichier audio ou vidéo</p>
              <p className="text-sm mt-1">mp3, wav, m4a, mp4, mov… — ou cliquez pour sélectionner</p>
            </div>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Options</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-sm font-medium text-gray-700">Modèle de transcription</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setModel("turbo")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  model === "turbo"
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-medium text-gray-800">Rapide</div>
                <div className="text-xs text-gray-500 mt-0.5">Résultat en ~1 min</div>
                <div className="text-xs text-gray-400 mt-1">Idéal pour audio studio</div>
              </button>
              <button
                type="button"
                onClick={() => setModel("large-v3")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  model === "large-v3"
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-medium text-gray-800">Haute précision</div>
                <div className="text-xs text-gray-500 mt-0.5">Résultat en 2–4 min</div>
                <div className="text-xs text-gray-400 mt-1">Accents, réunions, jargon</div>
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Langue</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
              <option value="es">Espagnol</option>
              <option value="de">Allemand</option>
              <option value="it">Italien</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enableDiarization}
            onChange={(e) => setEnableDiarization(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700">
            Identifier les intervenants
            <span className="ml-1.5 text-gray-400 text-xs">(diarisation — allonge le traitement)</span>
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Jobs list */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Transcriptions récentes</p>
            <button
              type="button"
              onClick={() => void refreshJobs()}
              className="text-xs text-indigo-600 hover:underline"
            >
              Actualiser
            </button>
          </div>
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <a
                  href={`/tools/transcription/${job.id}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors"
                >
                  <FileAudio className="w-5 h-5 text-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {job.inputFilename ?? "Fichier inconnu"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(job.createdAt)}
                      {job.duration != null && ` · ${fmtDuration(job.duration)}`}
                      {job.hasDiarization && " · Diarisé"}
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

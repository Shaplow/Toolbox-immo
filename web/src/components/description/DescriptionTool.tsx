"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Mic,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Wand2,
  Settings,
  X,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { parseSRT } from "@/lib/srt";
import type { Segment } from "@/lib/transcriptionProcess";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DescriptionPromptRow = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
};

export type DescriptionJobRow = {
  id: string;
  status: string;
  inputFilename: string | null;
  inputType: string;
  promptId: string | null;
  promptSnapshot: string | null;
  personalization: string | null;
  model: string;
  result: string | null;
  errorMsg: string | null;
  createdAt: string;
  prompt: { name: string } | null;
};

type TranscriptionItem = {
  id: string;
  inputFilename: string | null;
  createdAt: string;
  status: string;
};

type ReferenceImage = {
  dataUrl: string;
  filename: string;
  sizeBytes: number;
};

const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REFERENCE_IMAGE_ACCEPT = Array.from(REFERENCE_IMAGE_MIME_TYPES).join(",");

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractTextFromSRT(raw: string): string {
  const captions = parseSRT(raw);
  return captions.map((c) => c.text.replace(/\{HL:\d+\}|\{\/HL:\d+\}/g, "")).join(" ");
}

function extractTextFromJSON(raw: string): string {
  try {
    const data = JSON.parse(raw) as Segment[];
    if (Array.isArray(data)) {
      return data.map((s) => s.text?.trim() ?? "").filter(Boolean).join(" ");
    }
  } catch {
    // not valid JSON
  }
  return "";
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DescriptionTool({
  initialPrompts,
  initialJobs,
  isAdmin,
  aiConfig,
}: {
  initialPrompts: DescriptionPromptRow[];
  initialJobs: DescriptionJobRow[];
  isAdmin: boolean;
  aiConfig: { hasClaude: boolean; hasGPT: boolean };
}) {
  // Input
  const [inputTab, setInputTab] = useState<"upload" | "transcription">("upload");
  const [transcriptText, setTranscriptText] = useState("");
  const [inputFilename, setInputFilename] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  // Transcription source
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const [loadingTranscriptions, setLoadingTranscriptions] = useState(false);

  // Prompt
  const [prompts, setPrompts] = useState<DescriptionPromptRow[]>(initialPrompts);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(
    initialPrompts[0]?.id ?? null
  );
  const [promptModalOpen, setPromptModalOpen] = useState(false);

  // Personalization
  const [personalization, setPersonalization] = useState("");

  // Model
  const defaultModel = aiConfig.hasClaude ? "claude" : aiConfig.hasGPT ? "gpt" : null;
  const [model, setModel] = useState<"claude" | "gpt">(defaultModel ?? "claude");

  // Generation
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // History
  const [jobs, setJobs] = useState<DescriptionJobRow[]>(initialJobs);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load transcription list when tab selected
  useEffect(() => {
    if (inputTab === "transcription" && transcriptions.length === 0) {
      setLoadingTranscriptions(true);
      fetch("/api/transcription")
        .then((r) => r.json())
        .then((data: unknown) => {
          const list: TranscriptionItem[] = Array.isArray(data)
            ? (data as TranscriptionItem[])
            : ((data as { jobs?: TranscriptionItem[] }).jobs ?? []);
          setTranscriptions(list.filter((j) => j.status === "COMPLETED"));
        })
        .catch(() => {/* ignore */})
        .finally(() => setLoadingTranscriptions(false));
    }
  }, [inputTab, transcriptions.length]);

  // Load transcript text when transcription selected
  useEffect(() => {
    if (!transcriptionId) {
      setTranscriptText("");
      setInputFilename(null);
      return;
    }
    const t = transcriptions.find((t) => t.id === transcriptionId);
    setInputFilename(t?.inputFilename ?? null);

    fetch(`/api/transcription/${transcriptionId}/download?format=srt`)
      .then((r) => r.text())
      .then((raw) => {
        setTranscriptText(extractTextFromSRT(raw));
      })
      .catch(() => setFileError("Impossible de charger la transcription"));
  }, [transcriptionId, transcriptions]);

  const processFile = useCallback((file: File) => {
    setFileError(null);
    const name = file.name;
    const ext = name.split(".").pop()?.toLowerCase();

    if (ext !== "srt" && ext !== "json") {
      setFileError("Seuls les fichiers .srt et .json sont acceptés");
      return;
    }

    // Remove extension for display name
    const baseName = name.replace(/\.[^.]+$/, "");
    setInputFilename(baseName);

    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      const text = ext === "srt" ? extractTextFromSRT(raw) : extractTextFromJSON(raw);
      if (!text) {
        setFileError("Impossible d'extraire le texte depuis ce fichier");
        return;
      }
      setTranscriptText(text);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const processReferenceImage = useCallback((file: File) => {
    setImageError(null);

    if (!REFERENCE_IMAGE_MIME_TYPES.has(file.type)) {
      setImageError("Formats acceptés : PNG, JPG ou WEBP");
      return;
    }

    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      setImageError("Image trop volumineuse (4 Mo max)");
      return;
    }

    setImageLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl !== "string" || !dataUrl.startsWith(`data:${file.type};base64,`)) {
        setImageError("Impossible de charger l'image");
        setImageLoading(false);
        return;
      }

      setReferenceImage({
        dataUrl,
        filename: file.name,
        sizeBytes: file.size,
      });
      setImageLoading(false);
    };
    reader.onerror = () => {
      setImageError("Impossible de charger l'image");
      setImageLoading(false);
    };
    reader.readAsDataURL(file);
  }, []);

  const hasTranscript = transcriptText.trim().length > 0;
  const hasSourceInput = hasTranscript || !!referenceImage;

  const handleGenerate = async () => {
    if (!hasSourceInput || !selectedPromptId || !model) {
      setGenError("Ajoutez une transcription ou une image de référence");
      return;
    }
    setGenerating(true);
    setGenError(null);
    setResult(null);

    try {
      const res = await fetch("/api/description/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptText: hasTranscript ? transcriptText : undefined,
          promptId: selectedPromptId,
          personalization: personalization || undefined,
          model,
          inputFilename: inputFilename ?? undefined,
          transcriptionId: inputTab === "transcription" ? transcriptionId ?? undefined : undefined,
          referenceImage: referenceImage
            ? {
                dataUrl: referenceImage.dataUrl,
                filename: referenceImage.filename,
              }
            : undefined,
        }),
      });

      const data = await res.json() as { result?: string; error?: string; jobId?: string };

      if (!res.ok || data.error) {
        setGenError(data.error ?? "Erreur lors de la génération");
        return;
      }

      setResult(data.result ?? null);

      // Refresh history
      const jobsRes = await fetch("/api/description/jobs");
      if (jobsRes.ok) {
        const newJobs = await jobsRes.json() as DescriptionJobRow[];
        setJobs(newJobs);
      }
    } catch {
      setGenError("Erreur réseau");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canGenerate =
    hasSourceInput && !!selectedPromptId && !!model && !generating && !imageLoading;

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── Section 1: Source ──────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Source</h2>
        </div>

        {/* Input tabs */}
        <div className="px-5 pt-4 pb-2 flex items-center gap-1 bg-gray-50/50">
          <button
            onClick={() => setInputTab("upload")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              inputTab === "upload"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Upload size={12} /> Uploader un fichier
          </button>
          <button
            onClick={() => setInputTab("transcription")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              inputTab === "transcription"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Mic size={12} /> Transcription existante
          </button>
        </div>

        <div className="px-5 py-4">
          {inputTab === "upload" ? (
            <>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-indigo-400 bg-indigo-50"
                    : transcriptText
                    ? "border-green-300 bg-green-50/50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file);
                  }}
                />
                {transcriptText ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <Check size={16} className="text-green-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-800">
                      {inputFilename ?? "Fichier chargé"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {transcriptText.length.toLocaleString()} caractères extraits
                    </p>
                    <p className="text-xs text-gray-400">Cliquer pour changer de fichier</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={28} className="text-gray-300" />
                    <p className="text-sm font-medium text-gray-600">
                      Glisser un fichier .srt ou .json
                    </p>
                    <p className="text-xs text-gray-400">ou cliquer pour parcourir</p>
                  </div>
                )}
              </div>
              {fileError && (
                <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={12} /> {fileError}
                </p>
              )}
            </>
          ) : (
            <>
              {loadingTranscriptions ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Chargement…
                </div>
              ) : transcriptions.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-4">
                  Aucune transcription terminée. <br />
                  <Link href="/tools/transcription" className="text-teal-600 hover:underline">
                    Lancer une transcription →
                  </Link>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {transcriptions.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTranscriptionId(t.id)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-sm ${
                        transcriptionId === t.id
                          ? "border-teal-300 bg-teal-50 text-teal-800"
                          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700"
                      }`}
                    >
                      <Mic size={14} className={transcriptionId === t.id ? "text-teal-500" : "text-gray-300"} />
                      <span className="flex-1 truncate">
                        {t.inputFilename ?? "Transcription sans nom"}
                      </span>
                      {transcriptionId === t.id && (
                        <Check size={12} className="text-teal-500 shrink-0" />
                      )}
                      <span className="text-xs text-gray-400 shrink-0">{formatDate(t.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-gray-700">
                  Image de référence{" "}
                  <span className="text-xs font-normal text-gray-400">(optionnel)</span>
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  Ajoutez une capture d&apos;écran ou une photo contenant des infos à intégrer. Cette image peut aussi servir de seule source si vous n&apos;avez pas de SRT ou de transcription.
                </p>
              </div>
              {referenceImage && !imageLoading && (
                <button
                  type="button"
                  onClick={() => {
                    setReferenceImage(null);
                    setImageError(null);
                    if (imageInputRef.current) imageInputRef.current.value = "";
                  }}
                  className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
                >
                  Retirer
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (imageInputRef.current) imageInputRef.current.value = "";
                imageInputRef.current?.click();
              }}
              className={`w-full rounded-xl border border-dashed px-4 py-4 text-left transition-colors ${
                referenceImage
                  ? "border-amber-200 bg-amber-50/70 hover:border-amber-300"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept={REFERENCE_IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processReferenceImage(file);
                }}
              />

              {imageLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 size={14} className="animate-spin" /> Chargement de l&apos;image…
                </div>
              ) : referenceImage ? (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <Check size={16} className="text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {referenceImage.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatFileSize(referenceImage.sizeBytes)} • Cliquer pour remplacer
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                    <ImageIcon size={16} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Ajouter une image pour enrichir l&apos;analyse
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      PNG, JPG ou WEBP. Utile pour une capture d&apos;écran avec données ou visuels.
                    </p>
                  </div>
                </div>
              )}
            </button>

            {imageError && (
              <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
                <AlertCircle size={12} /> {imageError}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-400">
              L&apos;image n&apos;est envoyée qu&apos;avec cette génération et n&apos;est pas stockée dans l&apos;historique.
            </p>
          </div>
        </div>
      </div>

      {/* ── Section 2: Prompt ─────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Prompt</h2>
          {isAdmin && (
            <button
              onClick={() => setPromptModalOpen(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
            >
              <Settings size={12} /> Gérer les prompts
            </button>
          )}
        </div>
        <div className="px-5 py-4">
          {prompts.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">
              Aucun prompt disponible.
              {isAdmin && (
                <>
                  {" "}
                  <button
                    onClick={() => setPromptModalOpen(true)}
                    className="text-indigo-500 hover:underline"
                  >
                    En créer un →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {prompts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPromptId(p.id)}
                  className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                    selectedPromptId === p.id
                      ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                      : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{p.prompt}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Personnalisation ───────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">
            Personnalisation{" "}
            <span className="text-xs font-normal text-gray-400">(optionnel)</span>
          </h2>
        </div>
        <div className="px-5 py-4">
          <textarea
            value={personalization}
            onChange={(e) => setPersonalization(e.target.value)}
            placeholder={"Ex: Contactez Bonjour Oscar au 06 12 34 56 78\nAgence Premier Immo — Paris 16e"}
            rows={3}
            className="w-full text-sm text-gray-800 placeholder-gray-300 border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">
            Ces informations seront injectées dans le prompt avant l&apos;analyse de la source.
          </p>
        </div>
      </div>

      {/* ── Section 4: Modèle + Génération ───────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Model selector */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          <button
            disabled={!aiConfig.hasClaude}
            onClick={() => setModel("claude")}
            title={!aiConfig.hasClaude ? "ANTHROPIC_API_KEY non configuré" : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              model === "claude" && aiConfig.hasClaude
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-400 cursor-not-allowed"
            } ${aiConfig.hasClaude ? "hover:text-gray-700" : ""}`}
          >
            Claude Sonnet
          </button>
          <button
            disabled={!aiConfig.hasGPT}
            onClick={() => setModel("gpt")}
            title={!aiConfig.hasGPT ? "OPENAI_API_KEY non configuré" : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              model === "gpt" && aiConfig.hasGPT
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-400 cursor-not-allowed"
            } ${aiConfig.hasGPT ? "hover:text-gray-700" : ""}`}
          >
            ChatGPT
          </button>
        </div>

        {/* Generate button */}
        <button
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {generating ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Génération…
            </>
          ) : (
            <>
              <Wand2 size={14} /> Générer la description
            </>
          )}
        </button>
      </div>

      {/* ── Erreur génération ─────────────────────────────────────────── */}
      {genError && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {genError}
        </div>
      )}

      {/* ── Résultat ─────────────────────────────────────────────────── */}
      {result !== null && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Description générée</h2>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-green-500" />
                  <span className="text-green-600">Copié !</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  Copier
                </>
              )}
            </button>
          </div>
          <div className="px-5 py-4">
            <textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={10}
              className="w-full text-sm text-gray-800 border border-gray-200 rounded-lg px-3 py-2.5 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent font-sans leading-relaxed"
            />
          </div>
        </div>
      )}

      {/* ── Historique ───────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <button
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <h2 className="text-sm font-semibold text-gray-700">
              Historique{" "}
              <span className="text-xs font-normal text-gray-400">({jobs.length})</span>
            </h2>
            {historyOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </button>

          {historyOpen && (
            <div className="border-t border-gray-50 divide-y divide-gray-50">
              {jobs.map((job) => (
                <HistoryItem key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: gestion des prompts (admin) ───────────────────────── */}
      {isAdmin && promptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            onClick={() => setPromptModalOpen(false)}
          />
          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Gérer les prompts</h2>
              <button
                onClick={() => setPromptModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <PromptsManager
                prompts={prompts}
                onPromptsChange={(updated) => {
                  setPrompts(updated);
                  if (selectedPromptId && !updated.find((p) => p.id === selectedPromptId)) {
                    setSelectedPromptId(updated[0]?.id ?? null);
                  }
                  if (!selectedPromptId && updated.length > 0) {
                    setSelectedPromptId(updated[0].id);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PromptsManager (admin modal body) ─────────────────────────────────────────

function PromptsManager({
  prompts,
  onPromptsChange,
}: {
  prompts: DescriptionPromptRow[];
  onPromptsChange: (updated: DescriptionPromptRow[]) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormPrompt("");
    setError(null);
    setCreating(true);
  };

  const openEdit = (p: DescriptionPromptRow) => {
    setCreating(false);
    setFormName(p.name);
    setFormPrompt(p.prompt);
    setError(null);
    setEditingId(p.id);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      setError("Nom et prompt requis");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const res = await fetch("/api/description/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as DescriptionPromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        onPromptsChange([...prompts, data]);
        setCreating(false);
      } else if (editingId) {
        const res = await fetch(`/api/description/prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as DescriptionPromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        onPromptsChange(prompts.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce prompt ?")) return;
    const res = await fetch(`/api/description/prompts/${id}`, { method: "DELETE" });
    if (res.ok) onPromptsChange(prompts.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-3">
      {/* New prompt button */}
      {!creating && (
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus size={13} /> Nouveau prompt
        </button>
      )}

      {/* Create form */}
      {creating && (
        <PromptInlineForm
          name={formName}
          prompt={formPrompt}
          error={error}
          saving={saving}
          onName={setFormName}
          onPrompt={setFormPrompt}
          onSave={() => void handleSave()}
          onCancel={cancelForm}
          label="Créer"
        />
      )}

      {/* List */}
      {prompts.length === 0 && !creating && (
        <p className="text-sm text-gray-400 text-center py-6">Aucun prompt. Créez-en un pour commencer.</p>
      )}
      <div className="space-y-2">
        {prompts.map((p) => (
          <div key={p.id} className="border border-gray-100 rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-3">
                <PromptInlineForm
                  name={formName}
                  prompt={formPrompt}
                  error={error}
                  saving={saving}
                  onName={setFormName}
                  onPrompt={setFormPrompt}
                  onSave={() => void handleSave()}
                  onCancel={cancelForm}
                  label="Enregistrer"
                />
              </div>
            ) : (
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-line">{p.prompt}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
                    title="Modifier"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => void handleDelete(p.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptInlineForm({
  name, prompt, error, saving, onName, onPrompt, onSave, onCancel, label,
}: {
  name: string; prompt: string; error: string | null; saving: boolean;
  onName: (v: string) => void; onPrompt: (v: string) => void;
  onSave: () => void; onCancel: () => void; label: string;
}) {
  return (
    <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Nom</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Ex: Annonce immobilière courte"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Instructions</label>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder="Tu es un expert en immobilier. À partir de la transcription, rédige une annonce professionnelle…"
          rows={5}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {label}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          <X size={12} /> Annuler
        </button>
      </div>
    </div>
  );
}

// ── HistoryItem ────────────────────────────────────────────────────────────────

function HistoryItem({ job }: { job: DescriptionJobRow }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDone = job.status === "COMPLETED";
  const isFailed = job.status === "FAILED";

  const handleCopy = () => {
    if (!job.result) return;
    void navigator.clipboard.writeText(job.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left flex items-center gap-2 min-w-0"
        >
          <span className="text-sm font-medium text-gray-800 truncate">
            {job.inputFilename ?? "Sans nom"}
          </span>
          {job.prompt && (
            <span className="text-[10px] text-gray-400 shrink-0">— {job.prompt.name}</span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              isDone ? "bg-green-50 text-green-600" : isFailed ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-500"
            }`}
          >
            {isDone ? "OK" : isFailed ? "Erreur" : job.status}
          </span>
        </button>
        <span className="text-[11px] text-gray-400 shrink-0">
          {new Date(job.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </span>
        {isDone && job.result && (
          <button
            onClick={handleCopy}
            className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
            title="Copier"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          </button>
        )}
        <button onClick={() => setOpen((v) => !v)} className="shrink-0 text-gray-300 hover:text-gray-500">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {open && (
        <div className="mt-2">
          {isDone && job.result ? (
            <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
              {job.result}
            </p>
          ) : isFailed ? (
            <p className="text-xs text-red-400 bg-red-50 rounded-lg px-3 py-2">{job.errorMsg}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

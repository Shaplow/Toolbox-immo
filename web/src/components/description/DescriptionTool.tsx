"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  ArrowLeft,
  Loader2,
  Wand2,
  Settings,
  X,
  RefreshCw,
} from "lucide-react";
import { parseSRT } from "@/lib/srt";
import type { Segment } from "@/lib/transcriptionProcess";
import { DescriptionPromptsManager } from "@/components/description/DescriptionPromptsManager";
import { DescriptionHistoryItem } from "@/components/description/DescriptionHistoryItem";

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
  const searchParams = useSearchParams();
  const slotIdFromUrl = searchParams?.get("slotId") ?? null;
  // returnTo : URL relative à laquelle le bouton "← Retour" doit
  // ramener l'utilisateur. Construit par DescriptionSection quand
  // on entre depuis la fiche publication, sinon absent.
  const returnToRaw = searchParams?.get("returnTo") ?? null;
  // Garde-fou contre open-redirect : on accepte uniquement les chemins
  // simples /a/b/c (lettres, chiffres, tirets, slashes, query/hash sûrs).
  // Refuse explicitement : "//foo", "/\\foo", " /foo", caractères
  // encodés non-ASCII, séquences ".." même URL-encodées.
  function isSafeRelativePath(raw: string): boolean {
    if (!raw.startsWith("/")) return false;
    if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
    if (/\s/.test(raw)) return false;
    // Décode pour détecter les traversées encodées (%2e%2e, etc.).
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return false;
    }
    if (decoded.includes("..")) return false;
    if (decoded.startsWith("//") || decoded.startsWith("/\\")) return false;
    // Seuls les caractères path/query/hash sûrs.
    return /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]*$/.test(raw);
  }
  const returnTo = returnToRaw && isSafeRelativePath(returnToRaw) ? returnToRaw : null;

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
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  /**
   * V2 friction HIGH-2 du audit : avant, le tool standalone produisait un
   * résultat mais l'user devait copier/coller manuellement dans la fiche.
   * Le DescriptionJob avait bien slotId rempli côté API mais slot.description
   * restait vide. Désormais, si on vient d'un slot (slotIdFromUrl), un bouton
   * PATCH directement le slot et rebondit sur la fiche.
   */
  const handleApplyToSlot = useCallback(async () => {
    if (!slotIdFromUrl || !result) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slotIdFromUrl}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: result }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Échec de l'application au slot");
      }
      setApplied(true);
      // Rebond fiche après une courte pause pour laisser voir le ✓ Appliqué.
      setTimeout(() => router.push(returnTo ?? `/publications/${slotIdFromUrl}`), 600);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Erreur inconnue.");
      setApplying(false);
    }
  }, [slotIdFromUrl, result, router, returnTo]);

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
          slotId: slotIdFromUrl ?? undefined,
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

      {/* Breadcrumb retour — visible quand on entre depuis la fiche publication. */}
      {returnTo && (
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          <ArrowLeft size={14} />
          Retour à la fiche publication
        </Link>
      )}

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
                  <Link href="/transcriptions" className="text-teal-600 hover:underline">
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
          <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700">Description générée</h2>
            <div className="flex items-center gap-3">
              {slotIdFromUrl && (
                <button
                  onClick={() => void handleApplyToSlot()}
                  disabled={applying || applied}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Écrit ce résultat dans slot.description et retourne à la fiche"
                >
                  {applied ? (
                    <>
                      <Check size={12} />
                      Appliqué — redirection…
                    </>
                  ) : applying ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      Application…
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      Appliquer à la publication
                    </>
                  )}
                </button>
              )}
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
                <DescriptionHistoryItem key={job.id} job={job} />
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
              <DescriptionPromptsManager
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


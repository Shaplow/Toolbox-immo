"use client";

import { useState, useEffect } from "react";
import {
  Film, FileText, Upload, X, ChevronLeft, Download,
  Wand2, ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { Caption, parseSRT, parseHighlightedSRT, serializeSRT } from "@/lib/srt";
import CaptionEditor from "@/components/captions/CaptionEditor";
import { SegmentTrimEditor } from "@/components/captions/SegmentTrimEditor";
import { buildSubtitlesFromWords, type Segment } from "@/lib/transcriptionProcess";

type TextTransform = "none" | "upper" | "lower" | "title";
type ExportProfile = "draft" | "balanced" | "final";
type AIModel = "claude" | "gpt";

type PresetData = {
  id: string;
  name: string;
  isBuiltin: boolean;
  config: Record<string, unknown>;
};

type QueuedJob = {
  id: string;
  status: string;
  videoUrl?: string;
  quality: string;
  videoName: string;
  createdAt: Date;
};

type CustomPrompt = { id: string; name: string; prompt: string };

const STORAGE_KEY = "caption_ai_prompts";

function srtTimeToSeconds(t: string): number {
  // Handles "HH:MM:SS,mmm" and "HH:MM:SS.mmm"
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function loadPrompts(): CustomPrompt[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as CustomPrompt[];
  } catch {
    return [];
  }
}

function savePrompts(prompts: CustomPrompt[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

function nested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

export default function CaptionsGenerateForm({
  preset,
  initialSrt,
  initialSegments,
  aiConfig = { hasClaude: true, hasGpt: true },
}: {
  preset: PresetData;
  initialSrt?: string | null;
  initialSegments?: Segment[] | null;
  aiConfig?: { hasClaude: boolean; hasGpt: boolean };
}) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [pendingSegments, setPendingSegments] = useState<Segment[] | null>(
    initialSegments && initialSegments.length > 0
      ? buildSubtitlesFromWords(initialSegments)
      : null
  );
  const [showTrimEditor, setShowTrimEditor] = useState<boolean>(
    !!(initialSegments && initialSegments.length > 0)
  );
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [highlighted, setHighlighted] = useState<Map<string, number>>(new Map());
  const [exportProfile, setExportProfile] = useState<ExportProfile>(
    (nested(preset.config, "export_profile") as ExportProfile | undefined) ?? "balanced"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [renderProgress, setRenderProgress] = useState(-1);

  // Queue of submitted jobs
  const [jobs, setJobs] = useState<QueuedJob[]>([]);

  // AI corrector state
  const [showAI, setShowAI] = useState(false);
  const [aiModel, setAiModel] = useState<AIModel>(
    aiConfig.hasClaude ? "claude" : "gpt"
  );
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>(() => loadPrompts());
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptText, setNewPromptText] = useState("");
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const baseTransform =
    (nested(preset.config, "base", "text_transform") as TextTransform | undefined) ?? "none";
  const highlight2Enabled =
    (nested(preset.config, "highlight2", "enabled") as boolean | undefined) ?? false;

  // Pre-load SRT from a previous job (bypasses TrimEditor — regen flow)
  useEffect(() => {
    if (initialSrt) {
      const { captions: parsed, highlighted: hl } = parseHighlightedSRT(initialSrt);
      setCaptions(parsed);
      setHighlighted(hl);
    }
  }, [initialSrt]);

  // Poll pending jobs in the queue
  useEffect(() => {
    const pending = jobs.filter((j) => j.status === "QUEUED" || j.status === "PROCESSING");
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      await Promise.all(
        pending.map(async (job) => {
          try {
            const res = await fetch(`/api/render/captions/${job.id}`);
            if (!res.ok) return;
            const data = await res.json() as { status: string; videoUrl?: string };
            const mapped =
              data.status === "COMPLETED" || data.status === "DONE" ? "DONE" : data.status;
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? { ...j, status: mapped, videoUrl: data.videoUrl ?? j.videoUrl }
                  : j
              )
            );
          } catch { /* ignore */ }
        })
      );
    }, 2500);
    return () => clearInterval(timer);
  }, [jobs]);

  const toggleWord = (key: string) => {
    setHighlighted((prev) => {
      const next = new Map(prev);
      const current = next.get(key);
      if (current === undefined) next.set(key, 0);
      else if (current === 0 && highlight2Enabled) next.set(key, 1);
      else next.delete(key);
      return next;
    });
  };

  const canGenerate = !!videoFile && (!!subsFile || captions.length > 0) && !showTrimEditor;

  const handleGenerate = async () => {
    if (!videoFile) { setMessage("Ajoutez une vidéo"); return; }
    if (!subsFile && captions.length === 0) { setMessage("Ajoutez les sous-titres"); return; }

    setBusy(true);
    setMessage("Rendu en cours…");
    setRenderProgress(0.05);

    const srtContent =
      captions.length > 0 ? serializeSRT(captions, highlighted) : await subsFile!.text();
    const srtBlob = new Blob([srtContent], { type: "text/plain" });
    const srtFileName = subsFile?.name ?? "captions.srt";
    const configWithProfile = { ...preset.config, export_profile: exportProfile };

    let fakeVal = 0.05;
    const fakeTimer = setInterval(() => {
      fakeVal = Math.min(fakeVal + 0.008, 0.88);
      setRenderProgress(fakeVal);
    }, 800);

    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("subtitles", srtBlob, srtFileName);
      form.append("config", JSON.stringify(configWithProfile));
      form.append("preview_mode", "false");
      form.append("preset_id", preset.id);

      const submitRes = await fetch("/api/render/captions", { method: "POST", body: form });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string };
        throw new Error(err.error ?? submitRes.statusText);
      }

      const submitData = await submitRes.json() as { captionJobId?: string; videoUrl?: string };

      if (submitData.videoUrl && submitData.captionJobId) {
        setJobs((prev) => [
          {
            id: submitData.captionJobId!,
            status: "DONE",
            videoUrl: submitData.videoUrl,
            quality: exportProfile,
            videoName: videoFile?.name ?? "vidéo",
            createdAt: new Date(),
          },
          ...prev,
        ]);
        setRenderProgress(1);
        setMessage("Rendu terminé !");
        return;
      }

      if (submitData.captionJobId) {
        setJobs((prev) => [
          { id: submitData.captionJobId!, status: "QUEUED", quality: exportProfile, videoName: videoFile?.name ?? "vidéo", createdAt: new Date() },
          ...prev,
        ]);
      }

      setMessage("Job soumis — en attente…");
      setRenderProgress(0.15);
    } catch (error) {
      setMessage(`Erreur : ${String(error)}`);
    } finally {
      clearInterval(fakeTimer);
      setBusy(false);
      if (renderProgress < 1) setTimeout(() => setRenderProgress(-1), 2000);
    }
  };

  const handleSavePrompt = () => {
    if (!newPromptName.trim() || !newPromptText.trim()) return;
    let updated: CustomPrompt[];
    if (editingPromptId) {
      updated = customPrompts.map((p) =>
        p.id === editingPromptId ? { ...p, name: newPromptName.trim(), prompt: newPromptText.trim() } : p
      );
      setSelectedPromptId(editingPromptId);
      setEditingPromptId(null);
    } else {
      const newP: CustomPrompt = { id: crypto.randomUUID(), name: newPromptName.trim(), prompt: newPromptText.trim() };
      updated = [...customPrompts, newP];
      setSelectedPromptId(newP.id);
    }
    setCustomPrompts(updated);
    savePrompts(updated);
    setNewPromptName("");
    setNewPromptText("");
    setShowNewPromptForm(false);
  };

  const handleEditPrompt = (p: CustomPrompt) => {
    setEditingPromptId(p.id);
    setNewPromptName(p.name);
    setNewPromptText(p.prompt);
    setShowNewPromptForm(true);
  };

  const handleDeletePrompt = (id: string) => {
    const updated = customPrompts.filter((p) => p.id !== id);
    setCustomPrompts(updated);
    savePrompts(updated);
    if (selectedPromptId === id) setSelectedPromptId(updated[0]?.id ?? null);
  };

  const handleAICorrect = async () => {
    if (captions.length === 0) { setAiError("Importez d'abord un fichier .srt"); return; }
    const selected = customPrompts.find((p) => p.id === selectedPromptId);
    const prompt = selected?.prompt.trim() ?? "";
    if (!prompt) { setAiError("Sélectionnez un prompt ou créez-en un"); return; }

    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/captions/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captions, prompt, model: aiModel }),
      });
      const data = await res.json() as { captions?: Caption[]; error?: string };
      if (!res.ok || !data.captions) throw new Error(data.error ?? "Erreur inconnue");
      setCaptions(data.captions);
      setHighlighted(new Map()); // reset highlights after correction
    } catch (err) {
      setAiError(String(err instanceof Error ? err.message : err));
    } finally {
      setAiLoading(false);
    }
  };

  const qualities: { value: ExportProfile; label: string; desc: string }[] = [
    { value: "draft", label: "Rapide", desc: "8 Mb/s" },
    { value: "balanced", label: "Équilibré", desc: "15 Mb/s" },
    { value: "final", label: "Max", desc: "20 Mb/s" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Back + Header */}
        <div className="mb-8">
          <Link
            href="/tools/captions"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-5"
          >
            <ChevronLeft size={14} />
            Captions
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center shrink-0">
              <Film size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{preset.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {initialSrt ? "Sous-titres pré-chargés depuis la génération précédente" : "Générez une vidéo avec des sous-titres brûlés"}
              </p>
            </div>
          </div>
        </div>

        {/* Upload row */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* Video */}
          <label
            className={`flex flex-col items-center gap-2.5 p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
              videoFile
                ? "border-violet-300 bg-violet-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                videoFile ? "bg-violet-100" : "bg-gray-100"
              }`}
            >
              <Upload size={15} className={videoFile ? "text-violet-500" : "text-gray-400"} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-800">Vidéo</p>
              {videoFile ? (
                <p className="text-xs text-violet-600 mt-0.5 max-w-[130px] truncate">
                  {videoFile.name}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">MP4 · MOV · WEBM</p>
              )}
            </div>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {/* SRT / JSON */}
          <label
            className={`flex flex-col items-center gap-2.5 p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
              subsFile || captions.length > 0 || showTrimEditor
                ? "border-violet-300 bg-violet-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                subsFile || captions.length > 0 || showTrimEditor ? "bg-violet-100" : "bg-gray-100"
              }`}
            >
              <FileText
                size={15}
                className={subsFile || captions.length > 0 || showTrimEditor ? "text-violet-500" : "text-gray-400"}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-800">Sous-titres</p>
              {subsFile || captions.length > 0 || showTrimEditor ? (
                <p className="text-xs text-violet-600 mt-0.5 max-w-[130px] truncate">
                  {subsFile?.name ?? (showTrimEditor ? `${pendingSegments?.length ?? 0} segments` : `${captions.length} lignes`)}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">.srt ou .json</p>
              )}
            </div>
            <input
              type="file"
              accept=".srt,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setSubsFile(f);
                if (f.name.endsWith(".json")) {
                  void f.text().then((txt) => {
                    try {
                      const segs = JSON.parse(txt) as Segment[];
                      setPendingSegments(segs);
                      setShowTrimEditor(true);
                      setCaptions([]);
                      setHighlighted(new Map());
                    } catch {
                      // Silently ignore malformed JSON
                    }
                  });
                } else {
                  void f.text().then((txt) => {
                    const parsed = parseSRT(txt);
                    const segs: Segment[] = parsed.map((c) => ({
                      start: srtTimeToSeconds(c.start),
                      end: srtTimeToSeconds(c.end),
                      text: c.text,
                    }));
                    setPendingSegments(segs);
                    setShowTrimEditor(true);
                    setCaptions([]);
                    setHighlighted(new Map());
                  });
                }
              }}
            />
          </label>
        </div>

        {/* Segment trim editor — shown after SRT or JSON import */}
        {showTrimEditor && pendingSegments && pendingSegments.length > 0 && (
          <SegmentTrimEditor
            segments={pendingSegments}
            videoFile={videoFile}
            onConfirm={(srt) => {
              const parsed = parseSRT(srt);
              setCaptions(parsed);
              setHighlighted(new Map());
              setShowTrimEditor(false);
            }}
            onCancel={() => {
              setShowTrimEditor(false);
              setPendingSegments(null);
              setSubsFile(null);
            }}
          />
        )}

        {/* Highlight editor + AI corrector — shown after SRT parsed */}
        {!showTrimEditor && captions.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-3">
            {/* Editor header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Mots à surligner</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cliquez sur les mots pour les mettre en valeur
                </p>
              </div>
              <div className="flex items-center gap-2">
                {highlighted.size > 0 && (
                  <button
                    onClick={() => setHighlighted(new Map())}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={10} />
                    Effacer tout
                  </button>
                )}
                {/* AI corrector toggle */}
                <button
                  onClick={() => setShowAI((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    showAI
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600"
                  }`}
                >
                  <Wand2 size={11} />
                  Auto-corriger
                  {showAI ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              </div>
            </div>

            {/* AI corrector panel */}
            {showAI && (
              <div className="mb-4 bg-violet-50 border border-violet-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-violet-800 mb-3">Correction IA</p>

                {/* Model selector */}
                <div className="flex gap-2 mb-4">
                  {([
                    { id: "claude" as AIModel, label: "Claude Sonnet 4.6", enabled: aiConfig.hasClaude },
                    { id: "gpt" as AIModel, label: "ChatGPT 5.4", enabled: aiConfig.hasGpt },
                  ]).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setAiModel(m.id)}
                      disabled={!m.enabled}
                      title={!m.enabled ? "Clé API non configurée" : undefined}
                      className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
                        !m.enabled
                          ? "border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed"
                          : aiModel === m.id
                          ? "border-violet-400 bg-violet-600 text-white"
                          : "border-violet-200 text-violet-700 hover:bg-violet-100"
                      }`}
                    >
                      {m.label}
                      {!m.enabled && <span className="ml-1 text-[9px] opacity-60">non configuré</span>}
                    </button>
                  ))}
                </div>

                {/* Custom prompts list */}
                {customPrompts.length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-3">
                    {customPrompts.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center gap-1 rounded-lg border transition-colors ${
                          selectedPromptId === p.id
                            ? "border-violet-400 bg-white"
                            : "border-transparent hover:bg-violet-100"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedPromptId(p.id)}
                          className="flex-1 text-left text-xs px-3 py-2 text-violet-700"
                        >
                          {selectedPromptId === p.id
                            ? <span className="font-semibold">{p.name}</span>
                            : p.name
                          }
                        </button>
                        <button
                          onClick={() => handleEditPrompt(p)}
                          className="shrink-0 text-violet-300 hover:text-violet-600 transition-colors text-xs px-1"
                          title="Modifier ce prompt"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(p.id)}
                          className="shrink-0 pr-2 text-violet-300 hover:text-red-400 transition-colors text-sm"
                          title="Supprimer ce prompt"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add prompt form */}
                {showNewPromptForm ? (
                  <div className="mb-3 bg-white border border-violet-200 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-xs font-semibold text-violet-700 mb-0.5">{editingPromptId ? "Modifier le prompt" : "Nouveau prompt"}</p>
                    <input
                      autoFocus
                      value={newPromptName}
                      onChange={(e) => setNewPromptName(e.target.value)}
                      placeholder="Nom du prompt…"
                      className="w-full text-xs border border-violet-100 rounded-lg px-2.5 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    />
                    <textarea
                      value={newPromptText}
                      onChange={(e) => setNewPromptText(e.target.value)}
                      placeholder="Instructions de correction…"
                      rows={3}
                      className="w-full text-xs border border-violet-100 rounded-lg px-2.5 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSavePrompt}
                        disabled={!newPromptName.trim() || !newPromptText.trim()}
                        className="flex-1 text-xs py-1.5 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors"
                      >
                        Enregistrer
                      </button>
                      <button
                        onClick={() => { setShowNewPromptForm(false); setEditingPromptId(null); setNewPromptName(""); setNewPromptText(""); }}
                        className="flex-1 text-xs py-1.5 border border-violet-200 text-violet-600 rounded-lg hover:bg-violet-50 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewPromptForm(true)}
                    className="w-full text-xs py-1.5 mb-3 border border-dashed border-violet-300 text-violet-500 rounded-lg hover:bg-violet-50 transition-colors"
                  >
                    + Nouveau prompt
                  </button>
                )}

                {aiError && (
                  <p className="text-xs text-red-500 mb-2">{aiError}</p>
                )}

                <button
                  onClick={handleAICorrect}
                  disabled={aiLoading || !selectedPromptId}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  {aiLoading ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Correction en cours…
                    </>
                  ) : (
                    <>
                      <Wand2 size={12} />
                      Corriger avec {aiModel === "claude" ? "Claude Sonnet 4.6" : "ChatGPT 5.4"}
                    </>
                  )}
                </button>
              </div>
            )}

            <CaptionEditor
              captions={captions}
              onChange={setCaptions}
              highlighted={highlighted}
              onToggleWord={toggleWord}
              baseTransform={baseTransform}
              highlight2Enabled={highlight2Enabled}
            />
          </div>
        )}

        {/* Quality selector — only visible when not in trim editor */}
        {!showTrimEditor && <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
          <p className="text-sm font-medium text-gray-900 mb-3">Qualité d&apos;export</p>
          <div className="grid grid-cols-3 gap-2">
            {qualities.map((q) => (
              <button
                key={q.value}
                onClick={() => setExportProfile(q.value)}
                className={`flex flex-col items-center gap-0.5 py-3 rounded-xl border transition-all text-sm ${
                  exportProfile === q.value
                    ? "border-violet-300 bg-violet-50 text-violet-700"
                    : "border-gray-100 bg-white text-gray-600 hover:border-gray-200"
                }`}
              >
                <span className="font-medium">{q.label}</span>
                <span className="text-[10px] opacity-60">{q.desc}</span>
              </button>
            ))}
          </div>
        </div>}

        {/* Generate button — only visible when not in trim editor */}
        {!showTrimEditor && <>
        <button
          disabled={!canGenerate || busy}
          onClick={handleGenerate}
          className="w-full flex items-center justify-center gap-2 py-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-colors"
        >
          {busy ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {message}
            </>
          ) : (
            <>
              <Film size={16} />
              Générer
            </>
          )}
        </button>

        {!canGenerate && !busy && (
          <p className="text-xs text-center text-gray-400 mt-2">
            {!videoFile ? "Ajoutez une vidéo" : "Ajoutez un fichier .srt ou .json"}
          </p>
        )}

        {/* Progress bar */}
        {renderProgress >= 0 && (
          <div className="mt-4 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
            <div
              className="bg-violet-500 h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(renderProgress * 100)}%` }}
            />
          </div>
        )}

        {/* Status (non-busy) */}
        {message && !busy && (
          <p
            className={`text-sm text-center mt-3 ${
              message.startsWith("Erreur") ? "text-red-500" : "text-gray-500"
            }`}
          >
            {message}
          </p>
        )}

        {/* Generation queue */}
        {jobs.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-gray-400" />
              <p className="text-sm font-medium text-gray-700">File de génération</p>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {jobs.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {jobs.map((job) => {
                const isDone = job.status === "DONE" || job.status === "COMPLETED";
                const isFailed = job.status === "FAILED";
                return (
                  <div
                    key={job.id}
                    className="bg-white border border-gray-100 rounded-xl overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Status icon */}
                      <div className="shrink-0">
                        {isDone ? (
                          <CheckCircle2 size={16} className="text-green-500" />
                        ) : isFailed ? (
                          <AlertCircle size={16} className="text-red-400" />
                        ) : (
                          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {job.videoName} · {job.quality} · {job.createdAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <p className={`text-[10px] mt-0.5 ${
                          isDone ? "text-green-600" : isFailed ? "text-red-400" : "text-violet-500"
                        }`}>
                          {isDone ? "Terminé" : isFailed ? "Échec" : "En cours…"}
                        </p>
                      </div>

                      {/* Download action */}
                      {isDone && job.videoUrl && (
                        <a
                          href={job.videoUrl}
                          download
                          className="shrink-0 inline-flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          <Download size={12} />
                          MP4
                        </a>
                      )}
                    </div>

                    {/* Video preview (compact) */}
                    {isDone && job.videoUrl && (
                      <div className="border-t border-gray-50 p-3">
                        <div className="max-w-[280px]">
                          <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100">
                            <video
                              src={job.videoUrl}
                              controls
                              className="absolute inset-0 w-full h-full object-contain"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>}
      </div>
    </div>
  );
}

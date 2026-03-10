"use client";

import { useState } from "react";
import { Film, FileText, Upload, X, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Caption, parseSRT, serializeSRT } from "@/lib/srt";
import CaptionEditor from "@/components/captions/CaptionEditor";

type TextTransform = "none" | "upper" | "lower" | "title";
type ExportProfile = "draft" | "balanced" | "final";

type PresetData = {
  id: string;
  name: string;
  isBuiltin: boolean;
  config: Record<string, unknown>;
};

function nested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

export default function CaptionsGenerateForm({ preset }: { preset: PresetData }) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subsFile, setSubsFile] = useState<File | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [highlighted, setHighlighted] = useState<Map<string, number>>(new Map());
  const [exportProfile, setExportProfile] = useState<ExportProfile>(
    (nested(preset.config, "export_profile") as ExportProfile | undefined) ?? "balanced"
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [renderProgress, setRenderProgress] = useState(-1);
  const [videoUrl, setVideoUrl] = useState("");

  const baseTransform =
    (nested(preset.config, "base", "text_transform") as TextTransform | undefined) ?? "none";
  const highlight2Enabled =
    (nested(preset.config, "highlight2", "enabled") as boolean | undefined) ?? false;

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

  const canGenerate = !!videoFile && (!!subsFile || captions.length > 0);

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

      const submitRes = await fetch("/api/render/captions", { method: "POST", body: form });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string };
        throw new Error(err.error ?? submitRes.statusText);
      }

      const submitData = await submitRes.json() as { captionJobId?: string; videoUrl?: string };

      if (submitData.videoUrl) {
        setVideoUrl(submitData.videoUrl);
        setRenderProgress(1);
        setMessage("Rendu terminé !");
        return;
      }

      setMessage("Job soumis — en attente…");
      setRenderProgress(0.15);
      clearInterval(fakeTimer);

      await new Promise<void>((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/render/captions/${submitData.captionJobId}`);
            if (!statusRes.ok) { clearInterval(poll); reject(new Error(`Status ${statusRes.status}`)); return; }
            const status = await statusRes.json() as {
              status: string; videoUrl?: string; outputUrl?: string; error?: string;
            };
            if (status.status === "COMPLETED" || status.status === "DONE") {
              clearInterval(poll);
              setVideoUrl(status.videoUrl ?? status.outputUrl ?? "");
              setRenderProgress(1);
              setMessage("Rendu terminé !");
              resolve();
            } else if (status.status === "FAILED") {
              clearInterval(poll);
              reject(new Error(status.error ?? "Rendu échoué"));
            } else {
              setRenderProgress((p) => Math.min(p + 0.02, 0.9));
              setMessage(status.status === "PROCESSING" ? "Rendu en cours…" : "En file d'attente…");
            }
          } catch (e) { clearInterval(poll); reject(e); }
        }, 2000);
      });
    } catch (error) {
      setMessage(`Erreur : ${String(error)}`);
    } finally {
      clearInterval(fakeTimer);
      setBusy(false);
      if (renderProgress < 1) setTimeout(() => setRenderProgress(-1), 2000);
    }
  };

  const qualities: { value: ExportProfile; label: string; desc: string }[] = [
    { value: "draft", label: "Rapide", desc: "Test" },
    { value: "balanced", label: "Équilibré", desc: "Recommandé" },
    { value: "final", label: "Max", desc: "Plus lent" },
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
                Générez une vidéo avec des sous-titres brûlés
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

          {/* SRT */}
          <label
            className={`flex flex-col items-center gap-2.5 p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
              subsFile || captions.length > 0
                ? "border-violet-300 bg-violet-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                subsFile || captions.length > 0 ? "bg-violet-100" : "bg-gray-100"
              }`}
            >
              <FileText
                size={15}
                className={subsFile || captions.length > 0 ? "text-violet-500" : "text-gray-400"}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-800">Sous-titres</p>
              {subsFile || captions.length > 0 ? (
                <p className="text-xs text-violet-600 mt-0.5 max-w-[130px] truncate">
                  {subsFile?.name ?? `${captions.length} lignes`}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">Fichier .srt</p>
              )}
            </div>
            <input
              type="file"
              accept=".srt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setSubsFile(f);
                  void f.text().then((txt) => {
                    setCaptions(parseSRT(txt));
                    setHighlighted(new Map());
                  });
                }
              }}
            />
          </label>
        </div>

        {/* Highlight editor — shown after SRT parsed */}
        {captions.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-3">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Mots à surligner</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cliquez sur les mots pour les mettre en valeur
                </p>
              </div>
              {highlighted.size > 0 && (
                <button
                  onClick={() => setHighlighted(new Map())}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={10} />
                  Effacer tout
                </button>
              )}
            </div>
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

        {/* Quality selector */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
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
        </div>

        {/* Generate button */}
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
            {!videoFile ? "Ajoutez une vidéo" : "Ajoutez un fichier .srt"}
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

        {/* Video result */}
        {videoUrl && (
          <div className="mt-6 bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <video controls src={videoUrl} className="w-full" />
            <div className="p-4 flex justify-end border-t border-gray-50">
              <a
                href={videoUrl}
                download
                className="text-sm text-violet-600 hover:text-violet-800 font-medium transition-colors"
              >
                Télécharger
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

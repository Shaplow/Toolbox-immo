"use client";

/**
 * UserCaptionsMode — variante USER simplifiée pour le mode captions.
 *
 * Phase F (split CaptionsApp 969 LOC). UserCaptionsMode + StepCard
 * étaient inline (~170 LOC) dans CaptionsApp pour la version "lite"
 * destinée aux utilisateurs avec permissions `captions` mais pas full
 * admin. Step-by-step UI (Preset / Vidéo / Sous-titres / Export).
 */

import type { ReactNode } from "react";
import { Film, FileText, Upload } from "lucide-react";
import type { Caption } from "@/lib/srt";
import type { CaptionConfigState } from "@/lib/captionPresetConfig";

type ConfigState = CaptionConfigState;

export interface UserModePreset {
  id: string;
  name: string;
  isBuiltin: boolean;
  config: ConfigState;
  createdAt: string;
}

export interface UserModeProps {
  presets: UserModePreset[];
  presetsLoading: boolean;
  selectedPresetId: string | null;
  onSelectPreset: (p: UserModePreset) => void;
  videoFile: File | null;
  onVideoChange: (f: File | null) => void;
  subsFile: File | null;
  captions: Caption[];
  restoredSubsFileName: string;
  onSubsChange: (f: File) => void;
  exportProfile: ConfigState["export_profile"];
  onExportProfileChange: (v: ConfigState["export_profile"]) => void;
  busy: boolean;
  message: string;
  renderProgress: number;
  videoUrl: string;
  onRender: () => void;
  onReset: () => void;
}

export function UserCaptionsMode({
  presets, presetsLoading, selectedPresetId, onSelectPreset,
  videoFile, onVideoChange, subsFile, captions, restoredSubsFileName, onSubsChange,
  exportProfile, onExportProfileChange,
  busy, message, renderProgress, videoUrl,
  onRender, onReset,
}: UserModeProps) {
  const preset = presets.find((p) => p.id === selectedPresetId) ?? null;
  const canGenerate = !!videoFile && (!!subsFile || captions.length > 0) && !!preset;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Film size={18} className="text-rose-500" /> Captions
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Brûlez des sous-titres dans votre vidéo</p>
          </div>
          <button onClick={onReset} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Réinitialiser
          </button>
        </div>

        {/* Step 1 — Preset */}
        <StepCard number={1} title="Style de sous-titres">
          {presetsLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <div className="w-4 h-4 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
              Chargement…
            </div>
          ) : presets.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">Aucun preset disponible — contactez votre administrateur.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectPreset(p)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    selectedPresetId === p.id
                      ? "bg-rose-50 border-rose-300 shadow-sm"
                      : "bg-white border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                    selectedPresetId === p.id ? "bg-rose-500 border-rose-500" : "border-gray-300"
                  }`} />
                  <div>
                    <p className={`text-sm font-medium ${selectedPresetId === p.id ? "text-rose-800" : "text-gray-800"}`}>
                      {p.name}
                    </p>
                    {p.isBuiltin && (
                      <p className="text-[10px] text-rose-400 mt-0.5">Style intégré</p>
                    )}
                  </div>
                  {selectedPresetId === p.id && <span className="ml-auto text-rose-500 text-sm">✓</span>}
                </button>
              ))}
            </div>
          )}
        </StepCard>

        {/* Step 2 — Vidéo */}
        <StepCard number={2} title="Votre vidéo">
          <label className={`flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            videoFile ? "border-rose-300 bg-rose-50" : "border-gray-200 hover:border-gray-300 bg-white"
          }`}>
            <Upload size={20} className={videoFile ? "text-rose-500" : "text-gray-400"} />
            <span className="text-sm font-medium text-gray-700">
              {videoFile ? videoFile.name : "Cliquer pour choisir une vidéo"}
            </span>
            {videoFile && (
              <span className="text-xs text-rose-700">{(videoFile.size / 1_000_000).toFixed(1)} Mo</span>
            )}
            <input type="file" accept="video/*" className="hidden"
              onChange={(e) => onVideoChange(e.target.files?.[0] ?? null)} />
          </label>
        </StepCard>

        {/* Step 3 — Sous-titres */}
        <StepCard number={3} title="Sous-titres (.srt)">
          <label className={`flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            (subsFile || captions.length > 0) ? "border-rose-300 bg-rose-50" : "border-gray-200 hover:border-gray-300 bg-white"
          }`}>
            <FileText size={20} className={(subsFile || captions.length > 0) ? "text-rose-500" : "text-gray-400"} />
            <span className="text-sm font-medium text-gray-700">
              {subsFile
                ? subsFile.name
                : captions.length > 0
                ? `${restoredSubsFileName || "Sous-titres restaurés"} (${captions.length} lignes)`
                : "Cliquer pour choisir un fichier .srt"}
            </span>
            <input type="file" accept=".srt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSubsChange(f); }} />
          </label>
        </StepCard>

        {/* Step 4 — Generate */}
        <StepCard number={4} title="Qualité d&apos;export">
          <select
            value={exportProfile}
            onChange={(e) => onExportProfileChange(e.target.value as ConfigState["export_profile"])}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            <option value="draft">Rapide (8 Mb/s)</option>
            <option value="balanced">Équilibré (12 Mb/s, recommandé)</option>
            <option value="final">Max (16 Mb/s)</option>
          </select>
        </StepCard>

        {/* Generate button */}
        <button
          disabled={!canGenerate || busy}
          onClick={onRender}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors"
        >
          {busy
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Génération en cours…</>
            : <><Film size={16}/> Générer la vidéo</>
          }
        </button>
        {!canGenerate && !busy && (
          <p className="text-xs text-center text-gray-400">
            {!preset ? "① Choisissez un preset" : !videoFile ? "② Ajoutez une vidéo" : "③ Ajoutez les sous-titres (.srt)"}
          </p>
        )}

        {/* Progress */}
        {renderProgress >= 0 && (
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="bg-rose-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(renderProgress * 100)}%` }} />
          </div>
        )}

        {/* Status */}
        <div className={`text-sm text-center ${message.startsWith("Erreur") ? "text-red-500" : "text-gray-500"}`}>
          {message}
        </div>

        {/* Result video */}
        {videoUrl && (
          <div className="space-y-3">
            <video src={videoUrl} controls className="w-full rounded-xl border border-gray-200" />
            <a href={videoUrl} download
              className="flex items-center justify-center gap-2 py-3 bg-gray-900 hover:bg-gray-700 text-white rounded-xl font-medium text-sm transition-colors">
              ↓ Télécharger MP4
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-6 h-6 rounded-full bg-rose-100 text-rose-800 text-xs font-bold flex items-center justify-center shrink-0">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

"use client";

/**
 * CaptionsGenerateButton — bouton "Générer" + hint + progress bar + status
 * message de CaptionsGenerateForm.
 *
 * Phase F3-step8 du split. Le bloc inline (~45 LOC) regroupait le bouton
 * principal + son disabled-hint + la progress bar + le message status
 * non-busy. Extrait en composant pur consommant les props nécessaires.
 */

import { Film } from "lucide-react";

interface Props {
  canGenerate: boolean;
  busy: boolean;
  message: string;
  renderProgress: number;
  hasVideoFile: boolean;
  onGenerate: () => void;
}

export function CaptionsGenerateButton({
  canGenerate,
  busy,
  message,
  renderProgress,
  hasVideoFile,
  onGenerate,
}: Props) {
  return (
    <>
      <button
        disabled={!canGenerate || busy}
        onClick={onGenerate}
        className="w-full flex items-center justify-center gap-2 py-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-colors"
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
          {!hasVideoFile ? "Ajoutez une vidéo" : "Sélectionnez une source de sous-titres"}
        </p>
      )}

      {/* Progress bar — visible pendant le rendu */}
      {renderProgress >= 0 && (
        <div className="mt-4 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
          <div
            className="bg-rose-500 h-1 rounded-full transition-all duration-500"
            style={{ width: `${Math.round(renderProgress * 100)}%` }}
          />
        </div>
      )}

      {/* Status (non-busy) — message d'info ou d'erreur */}
      {message && !busy && (
        <p
          className={`text-sm text-center mt-3 ${
            message.startsWith("Erreur") ? "text-red-500" : "text-gray-500"
          }`}
        >
          {message}
        </p>
      )}
    </>
  );
}

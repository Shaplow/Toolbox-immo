"use client";

/**
 * CaptionsAIPanel — toggle "Auto-corriger" + panel de correction IA.
 *
 * Phase F3-step2 du split de CaptionsGenerateForm (plan F3). Le panel
 * était inline (~145 LOC) avec 6 useState + handler async côté parent.
 * Tous les states restent dans le parent (pour qu'il puisse les
 * influencer depuis d'autres handlers — ex. quand un nouveau preset
 * est chargé), mais le rendu est isolé ici.
 *
 * Le toggle et le panel sont rendus ensemble : ouvre/ferme via
 * onToggleShowAI + affiche conditionnellement le panel.
 */

import { AlertCircle, ChevronDown, ChevronUp, Wand2 } from "lucide-react";
import type { CaptionPromptRow } from "@/lib/captionPrompt";
import {
  formatAutoHighlightModeLabel,
  formatAutoHighlightPlacementLabel,
} from "./utils";

type AIModel = "claude" | "gpt";

interface Props {
  // Toggle
  showAI: boolean;
  onToggleShowAI: () => void;
  // Model selector
  aiModel: AIModel;
  setAiModel: (m: AIModel) => void;
  aiConfig: { hasClaude: boolean; hasGpt: boolean };
  // Prompts
  customPrompts: CaptionPromptRow[];
  selectedPromptId: string | null;
  setSelectedPromptId: (id: string | null) => void;
  selectedPrompt: CaptionPromptRow | null;
  // Highlight 2 warning
  selectedPromptNeedsHighlight2: boolean;
  highlight2Enabled: boolean;
  // Storage availability
  promptStorageAvailable: boolean;
  promptStorageMessage?: string | null;
  // Action state
  aiError: string;
  aiLoading: boolean;
  onCorrect: () => void;
}

export function CaptionsAIPanel({
  showAI,
  onToggleShowAI,
  aiModel,
  setAiModel,
  aiConfig,
  customPrompts,
  selectedPromptId,
  setSelectedPromptId,
  selectedPrompt,
  selectedPromptNeedsHighlight2,
  highlight2Enabled,
  promptStorageAvailable,
  promptStorageMessage,
  aiError,
  aiLoading,
  onCorrect,
}: Props) {
  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggleShowAI}
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

      {/* Expanded panel */}
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

          {/* Prompts list */}
          {customPrompts.length > 0 ? (
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
                    <div className="flex items-center gap-2">
                      {selectedPromptId === p.id
                        ? <span className="font-semibold">{p.name}</span>
                        : <span>{p.name}</span>
                      }
                      {p.autoHighlight.enabled && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                          {formatAutoHighlightModeLabel(p.autoHighlight.mode)}
                        </span>
                      )}
                    </div>
                    {p.autoHighlight.enabled && (
                      <p className="mt-1 text-[10px] text-violet-400">
                        Auto-highlight {formatAutoHighlightPlacementLabel(p.autoHighlight.placement)}
                      </p>
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-violet-100 bg-white px-3 py-2.5">
              <p className="text-[11px] text-violet-500">
                Aucun prompt disponible pour le moment. Contactez votre administrateur.
              </p>
            </div>
          )}

          {selectedPrompt?.autoHighlight.enabled && (
            <div className="mb-3 rounded-xl border border-violet-200 bg-white px-3 py-2.5">
              <p className="text-[11px] font-semibold text-violet-700">Auto-highlight actif</p>
              <p className="mt-0.5 text-[11px] text-violet-600">
                {formatAutoHighlightModeLabel(selectedPrompt.autoHighlight.mode)} · consigne insérée {formatAutoHighlightPlacementLabel(selectedPrompt.autoHighlight.placement)}
              </p>
              {selectedPrompt.autoHighlight.prompt && (
                <p className="mt-1 text-[11px] text-violet-500">
                  {selectedPrompt.autoHighlight.prompt}
                </p>
              )}
            </div>
          )}

          {selectedPromptNeedsHighlight2 && !highlight2Enabled && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p className="text-[11px] leading-5">
                Le prompt sélectionné demande Highlight 2, mais ce preset ne l&apos;active pas.
              </p>
            </div>
          )}

          {!promptStorageAvailable && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p className="text-[11px] leading-5">
                {promptStorageMessage ?? "Les prompts captions ne sont pas disponibles sur cette instance."}
              </p>
            </div>
          )}

          {aiError && (
            <p className="text-xs text-red-500 mb-2">{aiError}</p>
          )}

          <button
            onClick={onCorrect}
            disabled={
              !promptStorageAvailable ||
              aiLoading ||
              !selectedPromptId ||
              (selectedPromptNeedsHighlight2 && !highlight2Enabled)
            }
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
    </>
  );
}

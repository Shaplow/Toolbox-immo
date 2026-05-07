"use client";
import { useState } from "react";
import { SelectionRuleEditor } from "@/components/builder/shared/SelectionRuleEditor";
import { normalizeSelectionRule } from "@/components/builder/shared/SelectionRuleEditor";
import type { VideoSequenceSlot } from "@/types/template";
import { type OverlayMode, getOverlayMode } from "@/lib/videoSequenceUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { OverlayMode };
type SourceMode = "form" | "library";

const OVERLAY_OPTIONS: { value: OverlayMode; label: string; desc: string }[] = [
  { value: "raw",    label: "Clip seul",          desc: "Aucun texte ni donnée — clip brut" },
  { value: "data",   label: "Avec les infos",      desc: "Prix, surface, adresse… sur le clip" },
  { value: "groups", label: "Groupes spécifiques", desc: "Seulement certains blocs du template" },
];

const SEQUENCE_STRATEGIES = [
  { value: "theme_sequence", label: "Auto" },
  { value: "least_used",     label: "Moins utilisée" },
  { value: "oldest_used",    label: "La plus ancienne" },
  { value: "random",         label: "Aléatoire" },
  { value: "manual",         label: "Manuelle (choix à la génération)" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export interface SlotPropertiesFormProps {
  slot: VideoSequenceSlot;
  index: number;
  schema: { key: string; label?: string; type: string }[];
  groups: { id: string; name: string }[];
  videoLibraries: { id: string; name: string }[];
  /** All VideoBlocks in the template, used for the positioning picker. */
  videoBlocks?: { id: string; label?: string }[];
  onChange: (changes: Partial<VideoSequenceSlot>) => void;
}

export function SlotPropertiesForm({
  slot,
  index,
  schema,
  groups,
  videoLibraries,
  videoBlocks = [],
  onChange,
}: SlotPropertiesFormProps) {
  const overlayMode = getOverlayMode(slot);
  const bindingFields = schema.filter((f) => ["video", "text", "url"].includes(f.type));
  const { strategy } = normalizeSelectionRule(slot.selectionRule);

  // intendedSource tracks which mode the user clicked, independently of whether
  // libraryId has been set yet. This ensures the "Bibliothèque" button visually
  // activates before the user picks a library from the dropdown.
  const [intendedSource, setIntendedSource] = useState<SourceMode>(
    slot.libraryId ? "library" : "form",
  );
  const sourceMode: SourceMode = slot.libraryId ? "library" : intendedSource;

  function switchToForm() {
    setIntendedSource("form");
    onChange({ libraryId: undefined, selectionRule: undefined });
  }

  function switchToLibrary() {
    setIntendedSource("library");
    onChange({ binding: undefined });
  }

  function setOverlayMode(mode: OverlayMode) {
    if (mode === "raw")    onChange({ overlayGroupIds: [] });
    if (mode === "data")   onChange({ overlayGroupIds: undefined });
    if (mode === "groups") {
      onChange({
        overlayGroupIds: slot.overlayGroupIds?.length
          ? slot.overlayGroupIds
          : groups[0] ? [groups[0].id] : [],
      });
    }
  }

  function toggleOverlayGroup(groupId: string, checked: boolean) {
    const current = slot.overlayGroupIds ?? [];
    onChange({ overlayGroupIds: checked ? [...current, groupId] : current.filter((id) => id !== groupId) });
  }

  return (
    <div className="flex flex-col gap-4 text-xs">

      {/* Nom */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Nom</span>
        <input
          type="text"
          value={slot.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          placeholder={`Clip ${index + 1}`}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>

      {/* Source vidéo */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Source vidéo</span>
        <p className="text-[10px] text-gray-400 leading-relaxed -mt-0.5">
          D’où vient la vidéo pour ce clip ?
        </p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={switchToForm}
            className={`flex items-start gap-2 text-left px-2.5 py-2.5 rounded-lg border transition-colors ${
              sourceMode === "form"
                ? "bg-indigo-50 border-indigo-300"
                : "bg-white border-gray-200 hover:border-gray-300"
            }`}
          >
            <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
              sourceMode === "form" ? "border-indigo-500" : "border-gray-300"
            }`}>
              {sourceMode === "form" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />}
            </span>
            <span>
              <span className={`block text-[11px] font-medium ${
                sourceMode === "form" ? "text-indigo-800" : "text-gray-700"
              }`}>Saisie à la génération</span>
              <span className="block text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                L’utilisateur choisit/upload la vidéo au moment de créer la vidéo
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={switchToLibrary}
            className={`flex items-start gap-2 text-left px-2.5 py-2.5 rounded-lg border transition-colors ${
              sourceMode === "library"
                ? "bg-indigo-50 border-indigo-300"
                : "bg-white border-gray-200 hover:border-gray-300"
            }`}
          >
            <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
              sourceMode === "library" ? "border-indigo-500" : "border-gray-300"
            }`}>
              {sourceMode === "library" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />}
            </span>
            <span>
              <span className={`block text-[11px] font-medium ${
                sourceMode === "library" ? "text-indigo-800" : "text-gray-700"
              }`}>Bibliothèque (auto-sélection)</span>
              <span className="block text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                Toolbox pioche automatiquement une vidéo depuis vos assets
              </span>
            </span>
          </button>
        </div>

        {sourceMode === "form" && (
          bindingFields.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-2">
                <p className="text-[10px] text-blue-700 leading-relaxed">
                  Quel champ du formulaire contient la vidéo à utiliser pour ce clip ?
                </p>
              </div>
              <select
                value={slot.binding ?? ""}
                onChange={(e) => onChange({ binding: e.target.value || undefined })}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— Choisir le champ vidéo —</option>
                {bindingFields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label || f.key}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <p className="text-[10px] text-amber-700 leading-relaxed">
                Aucun champ vidéo. Ajoutez un champ de type <strong>Vidéo</strong> dans l&apos;onglet Formulaire (☰).
              </p>
            </div>
          )
        )}

        {sourceMode === "library" && (
          <div className="flex flex-col gap-1.5">
            <select
              value={slot.libraryId ?? ""}
              onChange={(e) => onChange({ libraryId: e.target.value || undefined })}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">— Choisir une bibliothèque —</option>
              {videoLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
            {videoLibraries.length === 0 && (
              <p className="text-[10px] text-gray-400">Aucune bibliothèque vidéo disponible.</p>
            )}
            {slot.libraryId && (
              <SelectionRuleEditor
                rule={slot.selectionRule}
                onChange={(r) => onChange({ selectionRule: r })}
                strategies={SEQUENCE_STRATEGIES}
                schema={schema}
              />
            )}
          </div>
        )}
      </div>

      {/* Positionnement (VideoBlock) — only shown when there are multiple VideoBlocks */}
      {videoBlocks.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Bloc vidéo</span>
          <p className="text-[10px] text-gray-400 leading-relaxed -mt-0.5">
            Position et dimensions utilisées pour cadrer ce clip dans le template.
          </p>
          <select
            value={slot.videoBlockId ?? ""}
            onChange={(e) => onChange({ videoBlockId: e.target.value || undefined })}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">— Détecter automatiquement —</option>
            {videoBlocks.map((vb) => (
              <option key={vb.id} value={vb.id}>{vb.label || vb.id.slice(-6)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Infos affichées sur le clip */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Quoi afficher sur le clip ?</span>
        <p className="text-[10px] text-gray-400 leading-relaxed -mt-0.5">
          Les blocs du template (prix, adresse, logo…) peuvent apparaître en overlay sur ce clip ou non.
        </p>
        <div className="flex flex-col gap-1">
          {OVERLAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setOverlayMode(opt.value)}
              className={`flex items-start gap-2 text-left px-2.5 py-2 rounded-lg border transition-colors ${
                overlayMode === opt.value
                  ? "bg-indigo-50 border-indigo-300 text-indigo-900"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
                overlayMode === opt.value ? "border-indigo-500" : "border-gray-300"
              }`}>
                {overlayMode === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />}
              </span>
              <span>
                <span className="block text-[11px] font-medium">{opt.label}</span>
                <span className="block text-[10px] opacity-60 mt-0.5">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {overlayMode === "groups" && (
          <div className="mt-0.5 flex flex-col gap-1 pl-1">
            {groups.length > 0 ? groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slot.overlayGroupIds?.includes(g.id) ?? false}
                  onChange={(e) => toggleOverlayGroup(g.id, e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                />
                <span className="text-[11px] text-gray-600">{g.name || g.id.slice(-6)}</span>
              </label>
            )) : (
              <p className="text-[10px] text-gray-400">Aucun groupe dans le template.</p>
            )}
          </div>
        )}
      </div>


      {/* Durée max */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Durée max</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0.5}
            step={0.5}
            placeholder="auto"
            value={slot.maxDuration ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ maxDuration: raw === "" ? undefined : Math.max(0.5, Number(raw) || 0.5) });
            }}
            className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <span className="text-[10px] text-gray-400">s (vide = durée du clip)</span>
        </div>
      </div>

      {/* Strategy summary (for library mode) */}
      {sourceMode === "library" && slot.libraryId && (
        <div className="text-[9px] text-indigo-500 bg-indigo-50 rounded px-2 py-1">
          Mode : <strong>{strategy === "theme_sequence" ? "Auto" : "Manuelle"}</strong>
        </div>
      )}
    </div>
  );
}

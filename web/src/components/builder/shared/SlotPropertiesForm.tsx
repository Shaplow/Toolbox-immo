"use client";
import { useState } from "react";
import { SelectionRuleEditor } from "@/components/builder/shared/SelectionRuleEditor";
import { normalizeSelectionRule } from "@/components/builder/shared/SelectionRuleEditor";
import { GroupSelectList } from "@/components/builder/shared/GroupSelectList";
import type { VideoSequenceSlot } from "@/types/template";
import { buildGroupTree } from "@/lib/groupLayout";
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
  { value: "theme_sequence", label: "Tirage par dossier" },
  { value: "least_used",     label: "Moins utilisée" },
  { value: "oldest_used",    label: "La plus ancienne" },
  { value: "random",         label: "Aléatoire" },
  { value: "manual",         label: "Manuelle (choix à la génération)" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export interface SlotAudioOverride {
  musicTrackVolumeDb?: number;
  musicTrackFadeIn?: number;
  musicTrackFadeOut?: number;
}

export interface SlotPropertiesFormProps {
  slot: VideoSequenceSlot;
  index: number;
  schema: { key: string; label?: string; type: string }[];
  groups: { id: string; name: string; parentGroupId?: string }[];
  videoLibraries: { id: string; name: string }[];
  /** All VideoBlocks in the template, used for the positioning picker. */
  videoBlocks?: { id: string; label?: string }[];
  onChange: (changes: Partial<VideoSequenceSlot>) => void;
  /** Current per-slot music track overrides (from MusicBlock.slotAudio[slot.id]). */
  slotAudioOverride?: SlotAudioOverride;
  /** Called when the user changes per-slot music track volume or fade. */
  onAudioChange?: (changes: SlotAudioOverride) => void;
  /** Whether the template has a MusicBlock (controls whether the music section is shown). */
  hasMusicBlock?: boolean;
}

export function SlotPropertiesForm({
  slot,
  index,
  schema,
  groups,
  videoLibraries,
  videoBlocks = [],
  onChange,
  slotAudioOverride,
  onAudioChange,
  hasMusicBlock = false,
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
      // Pré-cocher un groupe TOP-LEVEL : `groups[0]` suit l'ordre de création et
      // peut tomber sur un sous-groupe, qui serait alors sélectionné sans son parent.
      const firstTopLevel = buildGroupTree(groups)[0]?.group.id;
      onChange({
        overlayGroupIds: slot.overlayGroupIds?.length
          ? slot.overlayGroupIds
          : firstTopLevel ? [firstTopLevel] : [],
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
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Nom</span>
        <input
          type="text"
          value={slot.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          placeholder={`Clip ${index + 1}`}
          className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>

      {/* Source vidéo */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Source vidéo</span>
        <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5">
          D’où vient la vidéo pour ce clip ?
        </p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={switchToForm}
            className={`flex items-start gap-2 text-left px-2.5 py-2.5 rounded-lg border transition-colors ${
              sourceMode === "form"
                ? "bg-indigo-50 border-indigo-300"
                : "bg-white border-border hover:border-border"
            }`}
          >
            <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
              sourceMode === "form" ? "border-indigo-500" : "border-border"
            }`}>
              {sourceMode === "form" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />}
            </span>
            <span>
              <span className={`block text-[11px] font-medium ${
                sourceMode === "form" ? "text-indigo-800" : "text-foreground"
              }`}>Saisie à la génération</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
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
                : "bg-white border-border hover:border-border"
            }`}
          >
            <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
              sourceMode === "library" ? "border-indigo-500" : "border-border"
            }`}>
              {sourceMode === "library" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />}
            </span>
            <span>
              <span className={`block text-[11px] font-medium ${
                sourceMode === "library" ? "text-indigo-800" : "text-foreground"
              }`}>Bibliothèque (auto-sélection)</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
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
                className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
              className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">— Choisir une bibliothèque —</option>
              {videoLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
            {videoLibraries.length === 0 && (
              <p className="text-[10px] text-muted-foreground">Aucune bibliothèque vidéo disponible.</p>
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
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Bloc vidéo</span>
          <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5">
            Position et dimensions utilisées pour cadrer ce clip dans le template.
          </p>
          <select
            value={slot.videoBlockId ?? ""}
            onChange={(e) => onChange({ videoBlockId: e.target.value || undefined })}
            className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quoi afficher sur le clip ?</span>
        <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5">
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
                  : "bg-white border-border text-muted-foreground hover:border-border"
              }`}
            >
              <span className={`mt-0.5 w-3 h-3 shrink-0 rounded-full border-2 flex items-center justify-center ${
                overlayMode === opt.value ? "border-indigo-500" : "border-border"
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
          <div className="mt-0.5 pl-1">
            <GroupSelectList
              groups={groups}
              selectedIds={slot.overlayGroupIds ?? []}
              onToggle={toggleOverlayGroup}
            />
          </div>
        )}
      </div>


      {/* Durée max */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Durée max</span>
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
            className="w-24 border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <span className="text-[10px] text-muted-foreground">s (vide = durée du clip)</span>
        </div>
      </div>

      {/* Strategy summary (for library mode) */}
      {sourceMode === "library" && slot.libraryId && (
        <div className="text-[9px] text-indigo-500 bg-indigo-50 rounded px-2 py-1">
          Mode : <strong>{strategy === "theme_sequence" ? "Tirage par dossier" : "Manuelle"}</strong>
        </div>
      )}

      {/* ── Volume musique sur ce clip ───────────────────────────────────── */}
      {hasMusicBlock && onAudioChange && (
        <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">🎵 Volume musique</span>
            {(slotAudioOverride?.musicTrackVolumeDb !== undefined || slotAudioOverride?.musicTrackFadeIn !== undefined || slotAudioOverride?.musicTrackFadeOut !== undefined) && (
              <button
                type="button"
                onClick={() => onAudioChange({ musicTrackVolumeDb: undefined, musicTrackFadeIn: undefined, musicTrackFadeOut: undefined })}
                className="text-[9px] text-muted-foreground hover:text-red-500 transition-colors"
                title="Revenir au volume global"
              >
                réinitialiser
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5">
            Niveau cible de la musique pendant ce clip. Laissez vide pour utiliser le volume global.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-muted-foreground uppercase">Volume (dB)</span>
              <input
                type="number"
                min={-60}
                max={0}
                step={1}
                placeholder="global"
                value={slotAudioOverride?.musicTrackVolumeDb ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  onAudioChange({
                    ...slotAudioOverride,
                    musicTrackVolumeDb: raw === "" ? undefined : Math.min(0, Number(raw)),
                  });
                }}
                className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-muted-foreground uppercase">Fade ↑ (s)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="0"
                value={slotAudioOverride?.musicTrackFadeIn ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  onAudioChange({
                    ...slotAudioOverride,
                    musicTrackFadeIn: raw === "" ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-muted-foreground uppercase">Fade ↓ (s)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="0"
                value={slotAudioOverride?.musicTrackFadeOut ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  onAudioChange({
                    ...slotAudioOverride,
                    musicTrackFadeOut: raw === "" ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                className="border border-border rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
              />
            </label>
          </div>
          {slotAudioOverride?.musicTrackVolumeDb !== undefined && (
            <p className="text-[9px] text-indigo-500 bg-indigo-50 rounded px-2 py-1">
              {slotAudioOverride.musicTrackVolumeDb} dB
              {slotAudioOverride.musicTrackFadeIn ? ` · ↑${slotAudioOverride.musicTrackFadeIn}s` : ""}
              {slotAudioOverride.musicTrackFadeOut ? ` · ↓${slotAudioOverride.musicTrackFadeOut}s` : ""}
              {!slotAudioOverride.musicTrackFadeIn && !slotAudioOverride.musicTrackFadeOut ? " · instantané" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

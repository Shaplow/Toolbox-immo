"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { VideoSequenceSlot, MusicBlock, VideoBlock, AnyBlock } from "@/types/template";
import { getSlotSourceSummary, getOverlaySummary } from "@/lib/videoSequenceUtils";
import { SlotPropertiesForm } from "@/components/builder/shared/SlotPropertiesForm";
import { SelectionRuleEditor } from "@/components/builder/shared/SelectionRuleEditor";

function makeId() {
  return Math.random().toString(36).slice(2, 8);
}


// ─── Main component ────────────────────────────────────────────────────────────

export function VideoSequencePanel({
  videoLibraries,
  setVideoLibraries,
}: {
  videoLibraries: { id: string; name: string }[];
  setVideoLibraries: (libs: { id: string; name: string }[]) => void;
}) {
  const { template, updateVideoSequence, updateBlock, selectedSlotId, selectSlot } = useBuilderStore();
  const slots = template.videoSequence ?? [];
  const isActive = slots.length > 0;
  const schema = template.schema ?? [];

  // Blocks that live at the template level (not per-slot)
  const musicBlock = template.blocks.find((b): b is MusicBlock => b.type === "music");
  // Single-video source: only relevant when NOT in sequence mode
  const singleVideoBlock = !isActive ? template.blocks.find((b): b is VideoBlock => b.type === "video") : undefined;

  const [audioLibraries, setAudioLibraries] = useState<{ id: string; name: string }[]>([]);
  const [musicOpen, setMusicOpen] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  useEffect(() => {
    fetch("/api/admin/libraries/media?type=video")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then(setVideoLibraries)
      .catch(() => {});
    fetch("/api/admin/libraries/media?type=audio")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then(setAudioLibraries)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L5 — scroll au slot sélectionné quand l'ouverture est déclenchée
  // depuis VideoBlockPropertiesPanel (le panneau vient juste de monter
  // avec un selectedSlotId pré-positionné). Petit délai pour laisser
  // le panel s'afficher avant de scroller.
  useEffect(() => {
    if (!selectedSlotId) return;
    const t = setTimeout(() => {
      document
        .getElementById(`seq-slot-${selectedSlotId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(t);
  }, [selectedSlotId]);

  function addSlot() {
    const id = makeId();
    const videoBlocks = template.blocks.filter((b): b is VideoBlock => b.type === "video");
    const autoVideoBlockId = videoBlocks.length === 1 ? videoBlocks[0].id : undefined;
    const next: VideoSequenceSlot[] = [
      ...slots,
      { id, label: `Clip ${slots.length + 1}`, overlayGroupIds: undefined, videoBlockId: autoVideoBlockId },
    ];
    updateVideoSequence(next);
    selectSlot(id);
  }

  function removeSlot(id: string) {
    const next = slots.filter((s) => s.id !== id);
    updateVideoSequence(next.length === 0 ? undefined : next);
    if (selectedSlotId === id) selectSlot(null);
  }

  function moveSlot(id: string, dir: -1 | 1) {
    const idx = slots.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const next = [...slots];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    updateVideoSequence(next);
  }

  function disableSequence() {
    updateVideoSequence(undefined);
    selectSlot(null);
    setConfirmDisable(false);
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="px-3 py-3 border-b border-gray-100 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-gray-700">
            Vidéo & Musique
            {isActive && (
              <span className="ml-1.5 text-[9px] font-normal text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5">
                {slots.length} clip{slots.length > 1 ? "s" : ""}
              </span>
            )}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
            {isActive
              ? "Cliquez sur un clip pour configurer sa source et ses overlays."
              : "Sources vidéo et musique pour le rendu. Activez la séquence pour assembler plusieurs clips."}
          </p>
        </div>
        {isActive && (
          <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
            {confirmDisable ? (
              <>
                <span className="text-[9px] text-red-500">{slots.length} clip{slots.length > 1 ? "s" : ""} supprimé{slots.length > 1 ? "s" : ""} —</span>
                <button
                  type="button"
                  onClick={disableSequence}
                  className="text-[10px] px-2 py-1 rounded border border-red-400 text-white bg-red-500 hover:bg-red-600 transition-colors"
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisable(false)}
                  className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => slots.length > 1 ? setConfirmDisable(true) : disableSequence()}
                className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
              >
                Désactiver
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Single video source (no sequence mode) ─────────────────────────── */}
      {!isActive && singleVideoBlock && (
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2">📼 Source vidéo</p>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Bibliothèque</span>
            <select
              value={singleVideoBlock.libraryId ?? ""}
              onChange={(e) =>
                updateBlock(singleVideoBlock.id, { libraryId: e.target.value || undefined } as Partial<AnyBlock>)
              }
              className="border border-gray-200 rounded px-2 py-1 text-[11px]"
            >
              <option value="">— Formulaire (upload à la génération) —</option>
              {videoLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </label>
          {singleVideoBlock.libraryId && (
            <div className="mt-2">
              <span className="text-[10px] text-gray-500 block mb-1">À la génération</span>
              <SelectionRuleEditor
                rule={singleVideoBlock.selectionRule}
                onChange={(r) =>
                  updateBlock(singleVideoBlock.id, { selectionRule: r } as Partial<AnyBlock>)
                }
                strategies={[
                  { value: "theme_sequence", label: "Auto" },
                  { value: "least_used",     label: "Moins utilisée" },
                  { value: "oldest_used",    label: "La plus ancienne" },
                  { value: "random",         label: "Aléatoire" },
                  { value: "manual",         label: "Manuelle (choix à la génération)" },
                ]}
                schema={schema}
              />
            </div>
          )}
          <p className="text-[9px] text-gray-400 mt-2 leading-relaxed">
            Pour assembler plusieurs clips en un seul MP4, créez une séquence ci-dessous.
          </p>
        </div>
      )}

      {/* ── Create sequence CTA ─────────────────────────────────────────────── */}
      {!isActive && (
        <div className={`flex flex-col gap-3 p-4 ${singleVideoBlock ? "border-b border-gray-100" : ""}`}>
          {!singleVideoBlock && (
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wide">Comment ça marche</p>
              <ol className="flex flex-col gap-1.5">
                <li className="flex items-start gap-2 text-[10px] text-indigo-800 leading-relaxed">
                  <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-[8px]">1</span>
                  Crée tes clips (ex. : Intro • Bien • Outro)
                </li>
                <li className="flex items-start gap-2 text-[10px] text-indigo-800 leading-relaxed">
                  <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-[8px]">2</span>
                  Clique sur un clip → choisis la source vidéo (formulaire ou bibliothèque)
                </li>
                <li className="flex items-start gap-2 text-[10px] text-indigo-800 leading-relaxed">
                  <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-[8px]">3</span>
                  Décide quels textes/blocs s&apos;affichent sur ce clip
                </li>
              </ol>
            </div>
          )}
          <button
            type="button"
            onClick={addSlot}
            className="w-full px-3 py-2 bg-indigo-600 text-white text-[11px] font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Séquence multi-clips
          </button>
        </div>
      )}

      {/* Slot list */}
      {isActive && (
        <div className="flex flex-col">
          {slots.map((slot, i) => {
            const isSelected = selectedSlotId === slot.id;
            const sourceSummary = getSlotSourceSummary(slot, schema, videoLibraries);
            const overlaySummary = getOverlaySummary(slot);
            const label = slot.label || `Clip ${i + 1}`;
            // P4: detect if slot's libraryId is also used as an optionsSource on a schema field
            const sharedLibraryField = slot.libraryId
              ? schema.find(
                  (f) =>
                    (f as { optionsSource?: { libraryId?: string } }).optionsSource?.libraryId === slot.libraryId,
                )
              : undefined;
            return (
              <div key={slot.id} id={`seq-slot-${slot.id}`} className="border-b border-gray-100 last:border-b-0">
                {/* Slot row */}
                <div
                  className={`flex items-center gap-1.5 px-2 py-2 cursor-pointer transition-colors ${
                    isSelected ? "bg-indigo-50 border-l-2 border-l-indigo-400" : "hover:bg-gray-50/70"
                  }`}
                  onClick={() => selectSlot(isSelected ? null : slot.id)}
                >
                  {/* Index badge */}
                  <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-semibold ${
                    isSelected ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500"
                  }`}>
                    {i + 1}
                  </span>

                  {/* Label + badges */}
                  <div className="flex-1 min-w-0">
                    <span className={`block font-medium text-[11px] truncate ${isSelected ? "text-indigo-800" : "text-gray-800"}`}>
                      {label}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full truncate max-w-[110px] ${
                        slot.libraryId
                          ? "bg-violet-100 text-violet-600"
                          : slot.binding
                          ? "bg-blue-50 text-blue-500"
                          : "bg-amber-50 text-amber-500"
                      }`}>
                        {sourceSummary}
                      </span>
                      <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 truncate max-w-[80px]">
                        {overlaySummary}
                      </span>
                      {slot.maxDuration && (
                        <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">
                          {slot.maxDuration}s
                        </span>
                      )}
                      {sharedLibraryField && (
                        <span
                          className="inline-block px-1 rounded text-[7px] font-medium bg-violet-100 text-violet-600"
                          title={`Même bibliothèque que le champ "${sharedLibraryField.label ?? sharedLibraryField.key}"`}
                        >
                          🔗
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expand indicator */}
                  <ChevronRight
                    size={11}
                    className={`shrink-0 mr-0.5 transition-transform ${isSelected ? "rotate-90 text-indigo-500" : "text-gray-300"}`}
                  />

                  {/* Reorder + remove */}
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => moveSlot(slot.id, -1)}
                      disabled={i === 0}
                      title="Monter"
                      className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-0 transition-colors"
                    >
                      <ChevronRight size={11} className="-rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlot(slot.id, 1)}
                      disabled={i === slots.length - 1}
                      title="Descendre"
                      className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-0 transition-colors"
                    >
                      <ChevronRight size={11} className="rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      title="Supprimer ce clip"
                      className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Inline slot config expander */}
                {isSelected && (
                  <div className="border-t border-indigo-100 bg-indigo-50/30 px-3 py-3 overflow-y-auto">
                    <SlotPropertiesForm
                      key={slot.id}
                      slot={slot}
                      index={i}
                      schema={schema as { key: string; label?: string; type: string }[]}
                      groups={template.groups ?? []}
                      videoLibraries={videoLibraries}
                      videoBlocks={template.blocks
                        .filter((b): b is VideoBlock => b.type === "video")
                        .map((b) => ({ id: b.id, label: b.name }))}
                      onChange={(changes) => {
                        const next = slots.map((s) =>
                          s.id === slot.id ? { ...s, ...changes } : s,
                        );
                        updateVideoSequence(next);
                      }}
                      hasMusicBlock={!!musicBlock}
                      slotAudioOverride={musicBlock?.slotAudio?.[slot.id]}
                      onAudioChange={(audioChanges) => {
                        if (!musicBlock) return;
                        const prevSlotAudio = musicBlock.slotAudio ?? {};
                        const prevEntry = prevSlotAudio[slot.id] ?? {};
                        const nextEntry = { ...prevEntry, ...audioChanges };
                        // Remove keys that are explicitly set to undefined
                        if (nextEntry.musicTrackVolumeDb === undefined) delete nextEntry.musicTrackVolumeDb;
                        if (nextEntry.musicTrackFadeIn === undefined) delete nextEntry.musicTrackFadeIn;
                        const nextSlotAudio = { ...prevSlotAudio, [slot.id]: nextEntry };
                        // Clean up empty entries
                        if (Object.keys(nextEntry).length === 0) delete nextSlotAudio[slot.id];
                        updateBlock(musicBlock.id, { slotAudio: nextSlotAudio } as Partial<AnyBlock>);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          <div className="px-3 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={addSlot}
              className="w-full text-[11px] py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
            >
              + Ajouter un clip
            </button>
          </div>
        </div>
      )}

      {/* ── Music section — always visible when a MusicBlock exists ─────────── */}
      {musicBlock && (
        <div className="border-t border-gray-100">
          {/* Compact header — always visible */}
          <button
            type="button"
            onClick={() => setMusicOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50/70 transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 shrink-0">🎵 Musique</span>
              <div className="flex items-center gap-1 flex-wrap min-w-0">
                <span className="text-[9px] text-gray-500 truncate max-w-[90px]">
                  {musicBlock.libraryId
                    ? (audioLibraries.find((l) => l.id === musicBlock.libraryId)?.name ?? "Biblio.")
                    : "Formulaire"}
                </span>
                <span className="text-[9px] text-gray-400">·</span>
                <span className="text-[9px] text-gray-500">{Math.round((musicBlock.volume ?? 0.3) * 100)}%</span>
                {(musicBlock.loop) && (
                  <span className="text-[8px] px-1 py-0 rounded bg-gray-100 text-gray-400">loop</span>
                )}
                {((musicBlock.fadeIn ?? 0) > 0 || (musicBlock.fadeOut ?? 0) > 0) && (
                  <span className="text-[8px] px-1 py-0 rounded bg-gray-100 text-gray-400">fade</span>
                )}
              </div>
            </div>
            {musicOpen
              ? <ChevronDown size={12} className="shrink-0 text-gray-400" />
              : <ChevronRight size={12} className="shrink-0 text-gray-400" />}
          </button>

          {/* Expanded controls */}
          {musicOpen && (
            <div className="px-3 pb-3 flex flex-col gap-2 border-t border-gray-100 bg-gray-50/40">

              {/* Library */}
              <div className="flex flex-col gap-0.5 pt-2">
                <span className="text-[9px] text-gray-400 uppercase tracking-wide">Bibliothèque audio</span>
                <select
                  value={musicBlock.libraryId ?? ""}
                  onChange={(e) =>
                    updateBlock(musicBlock.id, { libraryId: e.target.value || undefined } as Partial<AnyBlock>)
                  }
                  className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] bg-white"
                >
                  <option value="">— Formulaire (upload à la génération) —</option>
                  {audioLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
              </div>

              {/* Selection rule */}
              {musicBlock.libraryId && (
                <div>
                  <span className="text-[9px] text-gray-400 uppercase tracking-wide block mb-1">À la génération</span>
                  <SelectionRuleEditor
                    rule={musicBlock.audioSelectionRule}
                    onChange={(r) =>
                      updateBlock(musicBlock.id, { audioSelectionRule: r } as Partial<AnyBlock>)
                    }
                    strategies={[
                      { value: "oldest_used", label: "La plus ancienne" },
                      { value: "least_used", label: "Moins utilisée" },
                      { value: "random", label: "Aléatoire" },
                      { value: "manual", label: "Manuelle" },
                    ]}
                    schema={schema}
                  />
                </div>
              )}

              {/* Volume + loop on one row */}
              <div className="flex items-center gap-3">
                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="flex justify-between text-[9px] text-gray-400">
                    <span>Volume</span>
                    <span>{Math.round((musicBlock.volume ?? 0.3) * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={musicBlock.volume ?? 0.3}
                    onChange={(e) =>
                      updateBlock(musicBlock.id, { volume: Number(e.target.value) } as Partial<AnyBlock>)
                    }
                    className="w-full"
                  />
                </div>
                <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={musicBlock.loop ?? false}
                    onChange={(e) =>
                      updateBlock(musicBlock.id, { loop: e.target.checked } as Partial<AnyBlock>)
                    }
                    className="rounded"
                  />
                  <span className="text-[10px] text-gray-500">Loop</span>
                </label>
              </div>

              {/* Fade in/out on one row */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-gray-400 uppercase">Fade in (s)</span>
                  <input
                    type="number" min={0} step={0.5}
                    value={musicBlock.fadeIn ?? 0}
                    onChange={(e) =>
                      updateBlock(musicBlock.id, { fadeIn: Number(e.target.value) } as Partial<AnyBlock>)
                    }
                    className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-gray-400 uppercase">Fade out (s)</span>
                  <input
                    type="number" min={0} step={0.5}
                    value={musicBlock.fadeOut ?? 0}
                    onChange={(e) =>
                      updateBlock(musicBlock.id, { fadeOut: Number(e.target.value) } as Partial<AnyBlock>)
                    }
                    className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

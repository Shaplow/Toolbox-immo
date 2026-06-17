"use client";

import { useEffect } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { VideoSequenceSlot, VideoBlock, MusicBlock, AnyBlock } from "@/types/template";
import {
  getSlotSourceSummary,
  getOverlaySummary,
  buildDefaultSlotFromVideoBlock,
} from "@/lib/videoSequenceUtils";
import { SlotPropertiesForm } from "@/components/builder/shared/SlotPropertiesForm";

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
  const schema = template.schema ?? [];

  // MusicBlock conservé pour les overrides audio par-slot (slotAudio).
  // La config musique principale est gérée dans le panneau Musique dédié.
  const musicBlock = template.blocks.find((b): b is MusicBlock => b.type === "music");

  // VideoBlock principal : utilisé pour amorcer le 1er clip si aucun slot
  // n'existe encore (cas template tout neuf qui n'a pas été normalisé).
  const primaryVideoBlock = template.blocks.find((b): b is VideoBlock => b.type === "video");

  useEffect(() => {
    fetch("/api/admin/libraries/media?type=video")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then(setVideoLibraries)
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

  // Amorce un premier slot depuis le VideoBlock principal (utile pour
  // un template fraîchement créé qui n'a pas encore traversé la
  // normalisation, ou si l'utilisateur a tout supprimé).
  function seedFirstSlot() {
    if (!primaryVideoBlock) return;
    const slot = buildDefaultSlotFromVideoBlock(primaryVideoBlock, { id: makeId() });
    updateVideoSequence([slot]);
    selectSlot(slot.id);
  }

  function removeSlot(id: string) {
    // C1 — On garde toujours au moins 1 slot tant qu'un VideoBlock existe :
    // un template avec VideoBlock mais sans slot ne rend pas. Si l'utilisateur
    // veut "désactiver la vidéo", il doit retirer le VideoBlock du canvas.
    if (slots.length === 1 && primaryVideoBlock) return;
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

  const hasSlots = slots.length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[11px] font-semibold text-foreground">
          Séquence vidéo
          {hasSlots && (
            <span className="ml-1.5 text-[9px] font-normal text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5">
              {slots.length} clip{slots.length > 1 ? "s" : ""}
            </span>
          )}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
          Ordonne les clips assemblés dans le rendu vidéo final. Clique sur un clip pour configurer source et overlays.
        </p>
      </div>

      {/* Empty state : pas de VideoBlock dans le template */}
      {!hasSlots && !primaryVideoBlock && (
        <div className="px-3 py-6 text-[11px] text-muted-foreground italic text-center">
          Ajoute un bloc vidéo depuis le panneau Calques pour amorcer
          la séquence.
        </div>
      )}

      {/* Empty state : VideoBlock présent mais pas encore de slot
          (template tout neuf ou tous slots supprimés). */}
      {!hasSlots && primaryVideoBlock && (
        <div className="px-3 py-4 flex flex-col gap-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Le canvas a un bloc vidéo mais aucun clip n&apos;est encore
            défini dans la séquence.
          </p>
          <button
            type="button"
            onClick={seedFirstSlot}
            className="w-full px-3 py-2 bg-indigo-600 text-white text-[11px] font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Créer le premier clip
          </button>
        </div>
      )}

      {/* Slot list */}
      {hasSlots && (
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
            const canDelete = !(slots.length === 1 && primaryVideoBlock);
            return (
              <div key={slot.id} id={`seq-slot-${slot.id}`} className="border-b border-border last:border-b-0">
                {/* Slot row */}
                <div
                  className={`flex items-center gap-1.5 px-2 py-2 cursor-pointer transition-colors ${
                    isSelected ? "bg-indigo-50 border-l-2 border-l-indigo-400" : "hover:bg-muted/70"
                  }`}
                  onClick={() => selectSlot(isSelected ? null : slot.id)}
                >
                  {/* Index badge */}
                  <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-semibold ${
                    isSelected ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground"
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
                      <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground truncate max-w-[80px]">
                        {overlaySummary}
                      </span>
                      {slot.maxDuration && (
                        <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
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
                    className={`shrink-0 mr-0.5 transition-transform ${isSelected ? "rotate-90 text-indigo-500" : "text-muted-foreground/60"}`}
                  />

                  {/* Reorder + remove */}
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => moveSlot(slot.id, -1)}
                      disabled={i === 0}
                      title="Monter"
                      className="p-1 text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-0 transition-colors"
                    >
                      <ChevronRight size={11} className="-rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlot(slot.id, 1)}
                      disabled={i === slots.length - 1}
                      title="Descendre"
                      className="p-1 text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-0 transition-colors"
                    >
                      <ChevronRight size={11} className="rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      disabled={!canDelete}
                      title={canDelete ? "Supprimer ce clip" : "Au moins 1 clip est requis quand un bloc vidéo existe"}
                      className="p-1 text-muted-foreground/60 hover:text-red-500 disabled:opacity-30 disabled:hover:text-muted-foreground/60 transition-colors"
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

          <div className="px-3 py-3 border-t border-border">
            <button
              type="button"
              onClick={addSlot}
              className="w-full text-[11px] py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-indigo-400 hover:text-indigo-600 transition-colors"
            >
              + Ajouter un clip
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

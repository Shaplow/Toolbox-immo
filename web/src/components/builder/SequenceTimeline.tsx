"use client";

import { useMemo } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import {
  isBlockVisibleInSlot as visibleInSlot,
  resolveBlockTimingInSlot as effectiveTiming,
} from "@/lib/videoSequenceUtils";
import type { AnyBlock, MusicBlock, VideoSequenceSlot } from "@/types/template";

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_DURATION = 10;

const SLOT_COLORS = [
  { colBg: "bg-muted",       bar: "bg-indigo-400",  headerActive: "bg-indigo-600 text-white",  headerIdle: "bg-white hover:bg-indigo-50 text-foreground"   },
  { colBg: "bg-emerald-50/60", bar: "bg-emerald-400", headerActive: "bg-emerald-600 text-white", headerIdle: "bg-white hover:bg-emerald-50 text-foreground"  },
  { colBg: "bg-amber-50/60",   bar: "bg-amber-400",   headerActive: "bg-amber-600 text-white",   headerIdle: "bg-white hover:bg-amber-50 text-foreground"    },
  { colBg: "bg-purple-50/60",  bar: "bg-purple-400",  headerActive: "bg-purple-600 text-white",  headerIdle: "bg-white hover:bg-purple-50 text-foreground"   },
  { colBg: "bg-danger-50/60",    bar: "bg-danger-200",    headerActive: "bg-danger-600 text-white",    headerIdle: "bg-white hover:bg-danger-50 text-foreground"     },
] as const;

type SlotColor = (typeof SLOT_COLORS)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotLayout {
  slot: VideoSequenceSlot;
  index: number;
  startSec: number;
  duration: number;
  color: SlotColor;
}

interface TrackSpan {
  slotIndex: number;
  appearAt: number;
  hideAt: number;
}

interface BlockTrack {
  blockId: string;
  label: string;
  spans: TrackSpan[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SequenceTimeline() {
  const videoSequence = useBuilderStore((s) => s.template.videoSequence);
  const blocks = useBuilderStore((s) => s.template.blocks);
  const groups = useBuilderStore((s) => s.template.groups);
  const selectedBlockId = useBuilderStore((s) => s.selectedBlockId);
  const selectedSlotId = useBuilderStore((s) => s.selectedSlotId);
  const selectBlock = useBuilderStore((s) => s.selectBlock);
  const selectSlot = useBuilderStore((s) => s.selectSlot);
  const selectBoth = useBuilderStore((s) => s.selectBoth);
  const updateBlock = useBuilderStore((s) => s.updateBlock);

  const slotLayouts = useMemo<SlotLayout[]>(() => {
    const slots = videoSequence ?? [];
    return slots.reduce<SlotLayout[]>((acc, slot, i) => {
      const duration = slot.maxDuration ?? AUTO_DURATION;
      const startSec = acc.length > 0 ? acc[acc.length - 1].startSec + acc[acc.length - 1].duration : 0;
      return [...acc, { slot, index: i, startSec, duration, color: SLOT_COLORS[i % SLOT_COLORS.length] }];
    }, []);
  }, [videoSequence]);

  const totalSec = useMemo(() => slotLayouts.reduce((s, l) => s + l.duration, 0), [slotLayouts]);

  // Show ALL non-hidden blocks that are visible in at least one slot
  const blockTracks = useMemo<BlockTrack[]>(() => {
    const tracks: BlockTrack[] = [];
    for (const block of blocks) {
      if (block.hidden) continue;
      if (block.type === "music") continue; // music has its own row
      const spans: TrackSpan[] = [];
      for (const layout of slotLayouts) {
        if (!visibleInSlot(block, layout.slot, groups)) continue;
        const { appearAt, hideAt } = effectiveTiming(block, layout.slot.id, layout.duration);
        spans.push({ slotIndex: layout.index, appearAt, hideAt });
      }
      if (spans.length === 0) continue;
      tracks.push({ blockId: block.id, label: block.binding ?? block.name ?? block.type, spans });
    }
    return tracks;
  }, [blocks, groups, slotLayouts]);

  const musicBlocks = useMemo(
    () => blocks.filter((b): b is MusicBlock => b.type === "music" && !b.hidden),
    [blocks],
  );

  function setMusicSlotAudio(
    blockId: string,
    slotId: string,
    changes: Partial<NonNullable<MusicBlock["slotAudio"]>[string]>,
  ) {
    const block = blocks.find((b) => b.id === blockId) as MusicBlock | undefined;
    if (!block) return;
    const prev = block.slotAudio ?? {};
    const prevSlot = prev[slotId] ?? {};
    const merged = { ...prevSlot, ...changes };
    // Remove keys that are explicitly undefined
    const clean = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined),
    );
    updateBlock(blockId, {
      slotAudio: {
        ...prev,
        [slotId]: Object.keys(clean).length > 0 ? clean : undefined,
      },
    } as Partial<AnyBlock>);
  }

  if ((videoSequence?.length ?? 0) === 0) return null;

  const hasAutoSlots = (videoSequence ?? []).some((s) => !s.maxDuration);

  return (
    <div className="bg-white border-t border-border shrink-0 overflow-x-auto overflow-y-auto max-h-52">
      <table
        className="w-full border-collapse table-fixed text-xs"
        style={{ minWidth: `${Math.max(400, slotLayouts.length * 120)}px` }}
      >
        <colgroup>
          {/* Label column */}
          <col style={{ width: "7rem" }} />
          {/* Slot columns — proportional to duration */}
          {slotLayouts.map((layout) => (
            <col
              key={layout.slot.id}
              style={{ width: `${(layout.duration / Math.max(totalSec, 1)) * 100}%` }}
            />
          ))}
        </colgroup>

        {/* ── Slot header row ─────────────────────────────────────────────── */}
        <thead>
          <tr className="h-10">
            {/* Corner: legend */}
            <th className="sticky top-0 z-10 border-r border-b border-border bg-white px-2 text-left align-middle">
              <div className="flex flex-col gap-0.5">
                <span className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground leading-none">
                  {hasAutoSlots ? "durées auto" : `~${totalSec}s`}
                </span>
                <span className="text-[7px] text-muted-foreground/60 leading-none">cliquer clip ou bloc → timing</span>
              </div>
            </th>

            {slotLayouts.map((layout) => {
              const isSelected = selectedSlotId === layout.slot.id;
              const isAuto = !layout.slot.maxDuration;
              return (
                <th
                  key={layout.slot.id}
                  className={`sticky top-0 z-10 border-r last:border-r-0 border-b border-border px-2 cursor-pointer select-none transition-colors align-middle ${
                    isSelected ? layout.color.headerActive : layout.color.headerIdle
                  }`}
                  onClick={() => {
                    if (isSelected) {
                      // Deselect slot; preserve block if any
                      selectSlot(null);
                    } else if (selectedBlockId) {
                      // A block is active → enter two-axis edit mode for this slot
                      selectBoth(selectedBlockId, layout.slot.id);
                    } else {
                      selectSlot(layout.slot.id);
                    }
                  }}
                  title={`Clip ${layout.index + 1} — cliquer pour configurer`}
                >
                  <div className="flex flex-col items-start gap-px">
                    <span className="text-[9px] font-semibold truncate w-full leading-none">
                      {layout.slot.label ?? `Clip ${layout.index + 1}`}
                    </span>
                    <span className={`text-[7px] leading-none ${
                      isSelected ? "opacity-60" : isAuto ? "text-amber-400" : "opacity-60"
                    }`}>
                      {isAuto ? "~auto" : `${layout.slot.maxDuration}s`}{isSelected ? " · conf. →" : ""}
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        {/* ── Block track rows ─────────────────────────────────────────────── */}
        <tbody>
          {/* ── Video source row — la couche fond de chaque clip ───────────── */}
          <tr className="h-[22px] border-b-2 border-border">
            <td className="border-r border-border px-2 align-middle bg-muted">
              <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">Vidéo</span>
            </td>
            {slotLayouts.map((layout) => {
              const isSlotActive = selectedSlotId === layout.slot.id;
              const configured = !!(layout.slot.libraryId || layout.slot.binding);
              const src = layout.slot.libraryId
                ? "Biblio. auto"
                : layout.slot.binding
                ? `Champ: ${layout.slot.binding}`
                : "Non configuré";
              return (
                <td
                  key={layout.slot.id}
                  className={`border-r last:border-r-0 border-border relative align-middle cursor-pointer ${
                    isSlotActive ? "bg-indigo-50/40" : layout.color.colBg
                  }`}
                  onClick={() => {
                    if (selectedSlotId === layout.slot.id) {
                      selectSlot(null);
                    } else if (selectedBlockId) {
                      selectBoth(selectedBlockId, layout.slot.id);
                    } else {
                      selectSlot(layout.slot.id);
                    }
                  }}
                  title={`Clip ${layout.index + 1} · Vidéo : ${src} — cliquer pour configurer`}
                >
                  <div
                    className={`absolute inset-y-[2px] inset-x-[1px] rounded flex items-center px-1.5 ${
                      configured ? `${layout.color.bar} opacity-90` : "bg-gray-200"
                    }`}
                  >
                    <span className="text-[7px] text-white truncate font-medium leading-none">
                      {configured ? src : "—"}
                    </span>
                  </div>
                </td>
              );
            })}
          </tr>

          {/* ── Music rows ─────────────────────────────────────────────────── */}
          {musicBlocks.map((musicBlock) => {
            const isSelectedBlock = selectedBlockId === musicBlock.id;
            return (
              <tr
                key={musicBlock.id}
                className={`h-[22px] border-b border-danger-100 group ${
                  isSelectedBlock ? "bg-danger-50" : "hover:bg-danger-50/30"
                }`}
              >
                <td className="border-r border-border px-2 align-middle bg-danger-50/60">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectBlock(isSelectedBlock ? null : musicBlock.id)}
                      className={`text-left text-[8px] font-semibold uppercase tracking-wider truncate ${
                        isSelectedBlock ? "text-danger-700" : "text-danger-200 group-hover:text-danger-600"
                      }`}
                      title={`Bloc musique « ${musicBlock.name ?? musicBlock.binding ?? "music"} » — sélectionner, puis cliquer un clip pour régler le volume`}
                    >
                      ♪ {musicBlock.name ?? "Musique"}
                    </button>
                    {/* Summary badge: how many slots have a slotAudio override */}
                    {(() => {
                      const overrideCount = slotLayouts.filter(
                        (l) => musicBlock.slotAudio?.[l.slot.id] !== undefined,
                      ).length;
                      return overrideCount > 0 ? (
                        <span
                          className="shrink-0 text-[7px] px-1 rounded-full bg-danger-100 text-danger-600 font-medium"
                          title={`${overrideCount} clip${overrideCount > 1 ? "s" : ""} avec override audio`}
                        >
                          {overrideCount}×
                        </span>
                      ) : null;
                    })()}
                  </div>
                </td>
                {slotLayouts.map((layout) => {
                  const override = musicBlock.slotAudio?.[layout.slot.id];
                  const isMuted = override?.mute === true;
                  const hasOverride = override !== undefined;
                  const isSlotActive = selectedSlotId === layout.slot.id;
                  const isEditMode = isSelectedBlock && isSlotActive;

                  return (
                    <td
                      key={layout.slot.id}
                      className={`border-r last:border-r-0 border-danger-100 relative align-middle ${
                        isEditMode ? "bg-danger-50" : isSlotActive ? "bg-danger-50/30" : "bg-white"
                      }`}
                    >
                      {isEditMode ? (
                        <div className="flex items-center gap-0.5 px-1 h-full py-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMusicSlotAudio(musicBlock.id, layout.slot.id, { mute: isMuted ? undefined : true });
                            }}
                            className={`shrink-0 w-5 h-[14px] rounded border text-[7px] leading-none ${
                              isMuted
                                ? "bg-red-100 border-red-300 text-red-700"
                                : "bg-white border-border text-muted-foreground hover:border-danger-200"
                            }`}
                            title={isMuted ? "Réactiver" : "Mettre en sourdine"}
                          >
                            {isMuted ? "🔇" : "🔊"}
                          </button>
                          {!isMuted && (
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.1}
                              placeholder={String(musicBlock.volume ?? 1)}
                              value={override?.volume ?? ""}
                              onChange={(e) =>
                                setMusicSlotAudio(musicBlock.id, layout.slot.id, {
                                  volume: e.target.value === "" ? undefined : Math.min(1, Math.max(0, Number(e.target.value))),
                                })
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="w-[30px] border border-danger-200 rounded px-1 py-0 text-[8px] focus:outline-none focus:ring-1 focus:ring-danger-200 bg-white text-center"
                              title="Volume pour ce clip (0–1)"
                            />
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditMode) {
                              // Already in edit mode → click deselects the block
                              selectBlock(null);
                            } else {
                              // Enter edit mode: select both block and slot simultaneously
                              selectBoth(musicBlock.id, layout.slot.id);
                            }
                          }}
                          title={`${musicBlock.name ?? "Musique"} · ${
                            layout.slot.label ?? `Clip ${layout.index + 1}`
                          }${isMuted ? " · muet" : override?.volume !== undefined ? ` · vol. ${override.volume}` : ""}${
                            hasOverride ? " · override actif" : ""
                          } — cliquer pour configurer`}
                          className={`absolute inset-y-[2px] inset-x-[1px] rounded flex items-center px-1.5 cursor-pointer transition-opacity ${
                            isMuted ? "bg-gray-200" : hasOverride ? "bg-danger-200 opacity-90" : "bg-danger-200/60"
                          } ${isSelectedBlock ? "opacity-100" : "opacity-50 group-hover:opacity-80"}`}
                        >
                          <span className="text-[7px] text-white truncate font-medium leading-none">
                            {isMuted ? "mute" : override?.volume !== undefined ? `vol ${override.volume}` : "♪"}
                          </span>
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* ── Section separator: Textes & blocs ───────────────────────── */}
          {blockTracks.length > 0 && (
            <tr className="h-[13px] bg-muted/60">
              <td
                colSpan={slotLayouts.length + 1}
                className="px-2 align-middle border-b border-border"
              >
                <span className="text-[7px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  textes &amp; blocs
                </span>
              </td>
            </tr>
          )}

          {blockTracks.length === 0 ? (
            <tr>
              <td
                colSpan={slotLayouts.length + 1}
                className="px-3 py-2.5 text-[10px] text-muted-foreground leading-relaxed"
              >
                Aucun bloc visible.
              </td>
            </tr>
          ) : (
            blockTracks.map((track) => {
              const isSelected = selectedBlockId === track.blockId;
              const isEditRow = isSelected && selectedSlotId !== null && track.spans.some((sp) => slotLayouts[sp.slotIndex]?.slot.id === selectedSlotId);
              const spanBySlot = new Map(track.spans.map((sp) => [sp.slotIndex, sp]));
              return (
                <tr
                  key={track.blockId}
                  className={`border-b border-gray-50 last:border-b-0 transition-colors group ${
                    isEditRow ? "h-[26px]" : "h-[16px]"
                  } ${
                    isSelected ? "bg-indigo-50" : "hover:bg-muted/80"
                  }`}
                >
                  {/* Block label — click to select/deselect block, preserve slot if active */}
                  <td className="border-r border-border px-2 align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          selectBlock(null);
                        } else if (selectedSlotId) {
                          // Slot is active → enter two-axis edit mode
                          selectBoth(track.blockId, selectedSlotId);
                        } else {
                          selectBlock(track.blockId);
                        }
                      }}
                      className={`w-full text-left text-[9px] font-mono truncate transition-colors ${
                        isSelected ? "text-indigo-700" : "text-muted-foreground group-hover:text-foreground"
                      }`}
                      title={`Sélectionner le bloc "${track.label}"${
                        selectedSlotId && !isSelected ? " (+ timing pour ce clip)" : ""
                      }`}
                    >
                      {track.label}
                    </button>
                  </td>

                  {/* Per-slot cells */}
                  {slotLayouts.map((layout) => {
                    const span = spanBySlot.get(layout.index);
                    const isSlotActive = selectedSlotId === layout.slot.id;
                    const isEditMode = isSelected && isSlotActive;

                    // Helper: update slotTimings for this block+slot
                    function setSlotTiming(field: "appearAt" | "hideAt", raw: string) {
                      const block = blocks.find((b) => b.id === track.blockId);
                      if (!block) return;
                      const current = block.slotTimings ?? {};
                      updateBlock(track.blockId, {
                        slotTimings: {
                          ...current,
                          [layout.slot.id]: {
                            ...current[layout.slot.id],
                            [field]: raw === "" ? undefined : Math.max(0, Number(raw)),
                          },
                        },
                      } as Partial<AnyBlock>);
                    }

                    return (
                      <td
                        key={layout.slot.id}
                        className={`border-r last:border-r-0 border-border relative align-middle cursor-pointer ${
                          isEditMode ? "bg-indigo-50" : isSlotActive ? "bg-indigo-50/40" : layout.color.colBg
                        }`}
                        onClick={() => {
                          if (isEditMode) {
                            // Exit timing edit mode by deselecting slot
                            selectSlot(null);
                          } else if (isSelected) {
                            // Block selected, slot not active → enter edit mode
                            selectBoth(track.blockId, layout.slot.id);
                          } else {
                            // Nothing selected → just select the slot
                            selectSlot(layout.slot.id);
                          }
                        }}
                        title={!span ? undefined : isEditMode ? `Timing actif — cliquer pour quitter` : isSelected ? `Configurer le timing pour ce clip` : `Clip ${layout.index + 1}`}
                      >
                        {isEditMode ? (
                          /* Inline timing editor */
                          <div className="flex items-center gap-0.5 px-1 h-full">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              placeholder="0"
                              value={(blocks.find((b) => b.id === track.blockId)?.slotTimings?.[layout.slot.id]?.appearAt) ?? ""}
                              onChange={(e) => setSlotTiming("appearAt", e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-[34px] border border-indigo-300 rounded px-1 py-0 text-[8px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white text-center"
                              title="Apparaît à (s)"
                            />
                            <span className="text-[7px] text-muted-foreground shrink-0">→</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              placeholder="fin"
                              value={(blocks.find((b) => b.id === track.blockId)?.slotTimings?.[layout.slot.id]?.hideAt) ?? ""}
                              onChange={(e) => setSlotTiming("hideAt", e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-[34px] border border-indigo-300 rounded px-1 py-0 text-[8px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white text-center"
                              title="Disparaît à (s)"
                            />
                          </div>
                        ) : span ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectBoth(track.blockId, layout.slot.id);
                            }}
                            title={`${track.label} · ${layout.slot.label ?? `Clip ${layout.index + 1}`} · ${span.appearAt}s → ${span.hideAt}s — cliquer pour éditer`}
                            className="absolute inset-y-[3px] rounded cursor-pointer"
                            style={{
                              left: `calc(${(span.appearAt / layout.duration) * 100}% + 1px)`,
                              right: `calc(${((layout.duration - span.hideAt) / layout.duration) * 100}% + 1px)`,
                              minWidth: "3px",
                            }}
                          >
                            <div
                              className={`h-full w-full rounded ${layout.color.bar} transition-opacity ${
                                isSelected ? "opacity-100" : "opacity-50 group-hover:opacity-80"
                              }`}
                            />
                            {/* Dot when per-slot timing overrides block defaults */}
                            {(() => {
                              const block = blocks.find((b) => b.id === track.blockId);
                              const hasOverride = !!(block?.slotTimings?.[layout.slot.id]);
                              return hasOverride ? (
                                <span
                                  className="absolute top-[1px] right-[1px] w-[5px] h-[5px] rounded-full bg-white border border-indigo-400"
                                  title="Timing personnalisé pour ce clip"
                                />
                              ) : null;
                            })()}
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

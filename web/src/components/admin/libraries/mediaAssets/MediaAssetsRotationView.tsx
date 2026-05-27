"use client";

/**
 * MediaAssetsRotationView — vue "rotation" du MediaAssetsPanel.
 *
 * Phase D6 du split C1-v2 (plan §19). Cette vue affiche la rotation auto/perso
 * sous forme de flat list ordonnée par `autoRank`, colorée par catégorie.
 *
 * Le composant reçoit `groupedBySetTag` (data préparée dans le panel), le
 * `seqState` (séquence personnalisée), les handlers de sequence et le
 * callback `renderCompactCard` du panel parent. Aucune logique de fetch ou
 * de tri ici — pur rendu.
 *
 * Le `groupSentinelRef` est passé pour le scroll-load infini (IntersectionObserver
 * monté dans le panel parent).
 */

import type { RefObject } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  FolderOpen,
  Layers,
  ListOrdered,
  Lock,
  MinusCircle,
  PlusCircle,
  RotateCcw,
} from "lucide-react";
import type { MediaAsset, SetGroup } from "./types";
import { formatDate } from "./helpers";

interface Props {
  groupedBySetTag: SetGroup[];
  seqState: string[];
  accountFilter: string | null;
  visibleGroupCount: number;
  groupSentinelRef: RefObject<HTMLDivElement | null>;
  saveSequence: (newSeq: string[]) => Promise<void>;
  moveSetTag: (tag: string, direction: -1 | 1) => void;
  addToSequence: (tag: string) => void;
  removeFromSequence: (tag: string) => void;
  renderCompactCard: (asset: MediaAsset, opts?: { hideCategory?: boolean }) => React.ReactNode;
}

const PALETTE = ["violet", "blue", "amber", "emerald", "rose", "cyan", "orange", "teal"] as const;

const COLOR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  violet:  { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200" },
  blue:    { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200" },
  cyan:    { bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200" },
  orange:  { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200" },
  teal:    { bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200" },
};

export function MediaAssetsRotationView({
  groupedBySetTag,
  seqState,
  accountFilter,
  visibleGroupCount,
  groupSentinelRef,
  saveSequence,
  moveSetTag,
  addToSequence,
  removeFromSequence,
  renderCompactCard,
}: Props) {
  // ── Header : rotation auto vs perso, nb groupes, cycle, prochain ─────────
  const allNamed = groupedBySetTag.filter((g) => g.setTag || g.category);
  const inaccessibleCount = accountFilter ? allNamed.filter((g) => !g.isAccessible).length : 0;
  const cycleSize = seqState.length === 0
    ? (allNamed.find((g) => g.cycleSize != null)?.cycleSize ?? null)
    : null;
  const nextGroup = seqState.length === 0
    ? (allNamed.find((g) => g.isAccessible && g.autoRank === 1) ?? allNamed.find((g) => g.autoRank === 1))
    : groupedBySetTag.find((g) => g.setTag === seqState[0]);
  const nextLabel = nextGroup
    ? [nextGroup.category, nextGroup.setTag].filter(Boolean).join(" › ") || null
    : null;

  // ── Palette catégorie → couleur ──────────────────────────────────────────
  const categories = Array.from(new Set(groupedBySetTag.map((g) => g.category).filter(Boolean))) as string[];
  const catColor: Record<string, string> = {};
  categories.forEach((c, i) => { catColor[c] = PALETTE[i % PALETTE.length]!; });

  const namedGroups = groupedBySetTag.filter((g) => g.setTag || g.category);
  const unnamedGroups = groupedBySetTag.filter((g) => !g.setTag && !g.category);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border bg-gray-50 border-gray-200 mb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {seqState.length === 0 ? (
              <>
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <RotateCcw size={12} className="text-emerald-500" /> Rotation auto
                </span>
                <span className="text-gray-300 text-xs">·</span>
                <span className="text-xs text-gray-500">{allNamed.length} groupe{allNamed.length !== 1 ? "s" : ""}</span>
                {cycleSize != null && cycleSize > 0 && (
                  <>
                    <span className="text-gray-300 text-xs">·</span>
                    <span className="text-xs text-gray-500">Cycle : <span className="font-medium text-gray-700">{cycleSize} gén.</span></span>
                  </>
                )}
                {nextLabel && (
                  <>
                    <span className="text-gray-300 text-xs">·</span>
                    <span className="text-xs text-gray-500">Prochain : <span className="font-semibold text-gray-700">{nextLabel}</span></span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 text-xs font-semibold text-indigo-700">
                  <ListOrdered size={12} className="text-indigo-500" /> Ordre personnalisé
                </span>
                <span className="text-gray-300 text-xs">·</span>
                <span className="text-xs text-gray-500">{seqState.length} set{seqState.length !== 1 ? "s" : ""} fixés</span>
                {nextLabel && (
                  <>
                    <span className="text-gray-300 text-xs">·</span>
                    <span className="text-xs text-gray-500">Prochain : <span className="font-semibold text-gray-700">{nextLabel}</span></span>
                  </>
                )}
              </>
            )}
          </div>
          {seqState.length > 0 && (
            <button
              onClick={() => { void saveSequence([]); }}
              className="text-[11px] text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-2 py-0.5 transition-colors"
            >
              Passer en auto
            </button>
          )}
        </div>
        {inaccessibleCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-amber-600">
            <AlertTriangle size={10} className="shrink-0" />
            {inaccessibleCount} groupe{inaccessibleCount !== 1 ? "s" : ""} hors accès pour ce compte
          </span>
        )}
      </div>

      {namedGroups.slice(0, visibleGroupCount).map((g) => {
        const color = g.category ? (catColor[g.category] ?? "violet") : "";
        const cls = color ? COLOR_CLASSES[color] : null;
        const dimmed = !g.isAccessible && !!accountFilter;
        return (
          <div
            key={g.key}
            className={`flex items-start gap-3 p-2.5 rounded-xl border transition-opacity ${
              dimmed
                ? "opacity-50 border-dashed border-gray-300 bg-gray-50"
                : cls ? `${cls.bg} ${cls.border}` : "bg-gray-50 border-gray-200"
            }`}
          >
            {/* Rank badge */}
            <div className="shrink-0 flex flex-col items-center gap-0.5 min-w-[60px]">
              {dimmed ? (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 bg-gray-100 text-gray-400 border-gray-300">
                  <Lock size={10} />
                </div>
              ) : g.autoRank === 1 ? (
                <span className="px-2 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold whitespace-nowrap">
                  Prochain
                </span>
              ) : g.autoRank != null ? (
                <>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
                    cls ? `bg-white ${cls.text} ${cls.border}` : "bg-white text-gray-500 border-gray-300"
                  }`}>
                    {g.autoRank}
                  </div>
                  <span className="text-[9px] text-gray-400 whitespace-nowrap leading-none">
                    {seqState.length === 0 ? `Dans ${g.autoRank - 1} gén.` : `#${g.autoRank}`}
                  </span>
                </>
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 bg-white text-gray-300 border-gray-200">
                  –
                </div>
              )}
            </div>
            {/* Set + category info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                {g.category && cls && !dimmed && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls.bg} ${cls.text} ${cls.border}`}>
                    <FolderOpen size={9} />{g.category}
                  </span>
                )}
                {dimmed ? (
                  <span className="text-[9px] text-gray-400 border border-dashed border-gray-300 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                    <Lock size={8} /> Hors accès
                  </span>
                ) : null}
                {g.setTag ? (
                  <>
                    <span className="text-[10px] text-gray-300">›</span>
                    <span className="flex items-center gap-0.5 text-[10px] font-semibold bg-pink-50 text-pink-700 border border-pink-100 px-1.5 py-0.5 rounded">
                      <Layers size={9} />{g.setTag}
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-gray-400 italic">pool</span>
                )}
                <span className="text-[10px] text-gray-400 ml-1">{g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}</span>
                {g.lastUsed && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-1">
                    <Clock size={9} />{formatDate(g.lastUsed)}
                  </span>
                )}
              </div>
              {/* Compact cards */}
              <div className="flex flex-col gap-1">
                {(accountFilter
                  ? g.groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter)))
                  : g.groupAssets
                ).map((a) => renderCompactCard(a, { hideCategory: true }))}
              </div>
            </div>
            {/* Sequence controls */}
            {seqState.length > 0 && g.setTag && (() => {
              const idx = seqState.indexOf(g.setTag);
              return (
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  {idx !== -1 ? (
                    <>
                      <button
                        onClick={() => moveSetTag(g.setTag!, -1)}
                        disabled={idx === 0}
                        className="p-0.5 rounded hover:bg-white disabled:opacity-30"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => moveSetTag(g.setTag!, 1)}
                        disabled={idx === seqState.length - 1}
                        className="p-0.5 rounded hover:bg-white disabled:opacity-30"
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        onClick={() => removeFromSequence(g.setTag!)}
                        className="p-0.5 text-red-400 hover:text-red-600"
                        title="Retirer"
                      >
                        <MinusCircle size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => addToSequence(g.setTag!)}
                      className="p-0.5 text-indigo-400 hover:text-indigo-600"
                      title="Fixer"
                    >
                      <PlusCircle size={12} />
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}

      {unnamedGroups.map((g) => (
        <div
          key={g.key || "__unset__"}
          className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400"
        >
          <span className="font-medium">Sans set</span>
          <span>— {g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}</span>
        </div>
      ))}

      {visibleGroupCount < namedGroups.length && (
        <div ref={groupSentinelRef} className="h-4" />
      )}
    </div>
  );
}

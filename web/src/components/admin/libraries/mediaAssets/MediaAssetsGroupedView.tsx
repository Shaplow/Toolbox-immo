"use client";

/**
 * MediaAssetsGroupedView — vue "grouped" du MediaAssetsPanel.
 *
 * Phase D5 du split C1-v2 (plan §19). Cette vue affiche les groupes par
 * setTag organisés en sections (catégorie quand présente) ou en grille
 * simple (fallback sans sections). Contrairement à la vue rotation qui
 * met l'accent sur l'ordre, la vue grouped met l'accent sur le contenu
 * de chaque pool.
 *
 * Le rendu d'une colonne (header pack + cards) est délégué à `renderColumn`
 * passé en prop callback — le panel parent garde le contrôle des handlers
 * (edit setTag, edit category, etc.) qui dépendent de state interne.
 */

import { Clock, FolderOpen, Layers, ListOrdered, Lock, RotateCcw } from "lucide-react";
import type { MediaAsset, SetGroup } from "./types";
import { formatDate } from "./helpers";
import { MediaAssetsSetStack } from "./MediaAssetsSetStack";

interface SectionsByGroup {
  hasGroups: boolean;
  sections: Array<{ name: string; groups: SetGroup[] }>;
  unassigned: SetGroup[];
}

interface Props {
  groupedBySetTag: SetGroup[];
  sectionsByGroup: SectionsByGroup;
  seqState: string[];
  accountFilter: string | null;
  assets: MediaAsset[];
  saveSequence: (newSeq: string[]) => Promise<void>;
  renderColumn: (group: SetGroup & { fluid?: boolean; inSection?: boolean }) => React.ReactNode;
  renderCompactCard: (asset: MediaAsset, opts?: { hideCategory?: boolean }) => React.ReactNode;
  /** Mode avancé : grille classique avec sub-cards par pack. Mode noob : stacks visuelles par set. */
  isAdvanced: boolean;
  /** Callback ouverture détail d'un set (mode noob seulement, ouvre le 1er asset). */
  onOpenSet?: (group: SetGroup) => void;
}

export function MediaAssetsGroupedView({
  groupedBySetTag,
  sectionsByGroup,
  seqState,
  accountFilter,
  assets,
  saveSequence,
  renderColumn,
  renderCompactCard,
  isAdvanced,
  onOpenSet,
}: Props) {
  return (
    <div className="space-y-5">
      {/* Rotation mode banner */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted border-border">
        {seqState.length === 0 ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <RotateCcw size={12} className="text-success-600" />
            <span className="font-medium text-success-700">Rotation auto</span>
            <span className="text-muted-foreground">— les groupes les moins récemment utilisés passent en premier</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ListOrdered size={12} className="text-info-700" />
            <span className="font-medium text-info-700">Ordre personnalisé</span>
            <span className="text-muted-foreground">— {seqState.length} groupe{seqState.length !== 1 ? "s" : ""} dans la rotation</span>
          </span>
        )}
        {seqState.length > 0 && (
          <button
            onClick={() => { void saveSequence([]); }}
            className="text-[11px] text-muted-foreground hover:text-red-500 border border-border hover:border-red-200 rounded px-2 py-0.5 transition-colors"
            title="Revenir à la rotation automatique"
          >
            Passer en auto
          </button>
        )}
      </div>

      {groupedBySetTag.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Aucun résultat.</p>
      ) : (
        <div>
          <datalist id="group-list">
            {Array.from(new Set(assets.map((a) => a.category).filter(Boolean))).map((t) => (
              <option key={t!} value={t!} />
            ))}
          </datalist>

          {sectionsByGroup.hasGroups ? (
            <div className="space-y-8">
              {sectionsByGroup.sections.map(({ name, groups }) => (
                <div key={name} className="rounded-2xl border border-danger-100 bg-danger-50/30 p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <FolderOpen size={14} className="text-danger-600 shrink-0" />
                    <span className="text-sm font-semibold text-danger-700">{name}</span>
                    <span className="text-xs text-danger-200 font-medium">
                      {groups.reduce((n, g) => n + g.groupAssets.length, 0)}
                      {" "}rush{groups.reduce((n, g) => n + g.groupAssets.length, 0) !== 1 ? "es" : ""}
                    </span>
                  </div>
                  {isAdvanced ? (
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                      {groups.map((g) => (
                        <div key={g.key} className={`${!g.isAccessible && accountFilter ? "opacity-50" : ""}`}>
                          {/* Pack column header (mode avancé uniquement) */}
                          <div
                            className={`mb-2 px-2.5 py-2 rounded-xl border flex flex-col gap-1 ${
                              !g.isAccessible && accountFilter
                                ? "bg-muted border-dashed border-border"
                                : "bg-white border-danger-100"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Layers size={11} className="text-danger-200 shrink-0" />
                              <span className="text-xs font-semibold text-gray-800 truncate">{g.setTag}</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 flex-wrap">
                              {!g.isAccessible && accountFilter ? (
                                <span className="text-[9px] text-muted-foreground border border-dashed border-border rounded px-1.5 py-0.5 flex items-center gap-0.5">
                                  <Lock size={8} /> Hors accès
                                </span>
                              ) : seqState.length === 0 ? (
                                g.autoRank === 1 ? (
                                  <span className="text-[9px] font-medium bg-success-50 text-success-700 border border-success-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                    <RotateCcw size={8} /> Prochain
                                  </span>
                                ) : g.autoRank ? (
                                  <span className="text-[9px] text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                    <RotateCcw size={8} /> Dans {g.autoRank - 1} gén.
                                  </span>
                                ) : null
                              ) : null}
                              {g.lastUsed && (
                                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                  <Clock size={8} />{formatDate(g.lastUsed)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {(accountFilter
                              ? g.groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter)))
                              : g.groupAssets
                            ).map((a) => renderCompactCard(a, { hideCategory: true }))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Mode noob : 1 stack visuelle par set (au lieu de cards aplaties).
                        Click sur la stack → onOpenSet (parent ouvre le 1er asset du set). */
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                      {groups.map((g) => (
                        <MediaAssetsSetStack
                          key={g.key}
                          group={g}
                          accountFilter={accountFilter}
                          onClick={() => onOpenSet?.(g)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {sectionsByGroup.unassigned.filter((g) => g.key !== "").length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-muted-foreground font-medium">Sets sans catégorie</span>
                    <div className="flex-1 h-px bg-muted" />
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                    {sectionsByGroup.unassigned
                      .filter((g) => g.key !== "")
                      .map((g) => renderColumn({ ...g, fluid: true }))}
                  </div>
                </div>
              )}

              {sectionsByGroup.unassigned
                .filter((g) => g.key === "")
                .map((g) => renderColumn({ ...g, fluid: true }))}
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              {groupedBySetTag.map((g) => renderColumn({ ...g, fluid: true }))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

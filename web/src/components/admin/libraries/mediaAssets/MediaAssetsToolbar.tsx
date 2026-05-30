"use client";

/**
 * MediaAssetsToolbar — actions + filters bar du MediaAssetsPanel.
 *
 * Refonte MID Glass : header retiré (déjà porté par Control Center de la
 * page wrapper). Actions Upload + Analyse auto à droite. FilterBar glass
 * avec Input/Combobox/Chip primitives. Toolbar "dumb" — tout via props.
 */

import {
  CheckSquare,
  Columns3,
  LayoutGrid,
  RotateCcw,
  Search,
  Settings2,
  Tag,
  Upload,
  Wand2,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Chip } from "@/components/ui/Chip";
import type { InstagramAccount, MediaLibrary, SortKey } from "./types";

interface Props {
  library: MediaLibrary;
  isVideo: boolean;
  loading: boolean;
  assetsCount: number;
  accounts: InstagramAccount[];
  allTags: string[];
  onOpenUpload: () => void;
  onOpenAtelier: () => void;
  autocutPendingCount?: number;
  resetError: string | null;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  sort: SortKey;
  setSort: Dispatch<SetStateAction<SortKey>>;
  tagFilter: string;
  setTagFilter: Dispatch<SetStateAction<string>>;
  accountFilter: string | null;
  setAccountFilter: Dispatch<SetStateAction<string | null>>;
  viewMode: "grid" | "grouped" | "rotation";
  setViewMode: Dispatch<SetStateAction<"grid" | "grouped" | "rotation">>;
  selectMode: boolean;
  setSelectMode: Dispatch<SetStateAction<boolean>>;
  exitSelectMode: () => void;
  /** Phase 2 — mode avancé opt-in (default OFF = noob mode). */
  isAdvanced: boolean;
  onToggleAdvanced: () => void;
}

const SORT_OPTIONS = [
  { value: "date_desc", label: "Plus récents" },
  { value: "date_asc", label: "Plus anciens" },
  { value: "usage_desc", label: "Plus utilisés" },
  { value: "usage_asc", label: "Moins utilisés" },
  { value: "name_asc", label: "Nom (A-Z)" },
];

export function MediaAssetsToolbar({
  library: _library,
  isVideo,
  loading,
  assetsCount,
  accounts,
  allTags,
  onOpenUpload,
  onOpenAtelier,
  autocutPendingCount = 0,
  resetError,
  search,
  setSearch,
  sort,
  setSort,
  tagFilter,
  setTagFilter,
  accountFilter,
  setAccountFilter,
  viewMode,
  setViewMode,
  selectMode,
  setSelectMode,
  exitSelectMode,
  isAdvanced,
  onToggleAdvanced,
}: Props) {
  void _library;

  const accountOptions = [
    { value: "", label: "Tous les comptes" },
    ...accounts.map((a) => ({
      value: a.id,
      label: `@${a.handle} — ${a.name}`,
      keywords: [a.handle, a.name],
    })),
  ];

  return (
    <div className="space-y-3">
      {/* Actions principales — toggle Avancé à gauche, actions Upload à droite */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Chip
          variant={isAdvanced ? "sky" : "default"}
          selected={isAdvanced}
          onClick={onToggleAdvanced}
          icon={Settings2}
          size="sm"
        >
          {isAdvanced ? "Avancé activé" : "Avancé"}
        </Chip>
        <div className="flex items-center gap-2 flex-wrap">
        {isVideo && isAdvanced && (
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              icon={Wand2}
              onClick={onOpenAtelier}
            >
              Analyse auto
            </Button>
            {autocutPendingCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-gradient-to-b from-peach-500 to-peach-600 text-white text-[10px] font-semibold leading-none shadow-[0_0_0_2px_rgba(255,255,255,1),0_2px_4px_rgba(245,158,107,0.4)]"
                title={`${autocutPendingCount} analyse${autocutPendingCount > 1 ? "s" : ""} à valider`}
              >
                {autocutPendingCount > 99 ? "99+" : autocutPendingCount}
              </span>
            )}
          </div>
        )}
        <Button variant="primary" size="sm" icon={Upload} onClick={onOpenUpload}>
          {isVideo ? "Ajouter des vidéos" : "Ajouter des musiques"}
        </Button>
        </div>
      </div>

      {/* Reset error */}
      {resetError && (
        <div className="rounded-2xl bg-gradient-to-b from-rose-50/85 via-rose-50/55 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(201,113,133,0.22),0_2px_8px_-4px_rgba(244,114,128,0.16)]">
          <p className="text-[12.5px] text-rose-800">{resetError}</p>
        </div>
      )}

      {/* Filter bar glass — 1 ligne ramassée + filtres actifs en dessous */}
      {!loading && assetsCount > 0 && (
        <div className="p-2.5 rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)] space-y-2">
          {/* Une seule ligne : search + sort + compte + view + select + (tags pop avancé) */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px] max-w-[280px]">
              <Input
                value={search}
                onChange={setSearch}
                placeholder="Rechercher…"
                icon={Search}
              />
            </div>
            <div className="w-[140px]">
              <Combobox
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                options={SORT_OPTIONS}
              />
            </div>
            {isVideo && accounts.length > 0 && (
              <div className="w-[180px]">
                <Combobox
                  value={accountFilter ?? ""}
                  onChange={(v) => setAccountFilter(v || null)}
                  options={accountOptions}
                  placeholder="Tous les comptes"
                  emptyMessage="Aucun compte"
                />
              </div>
            )}
            {isVideo && isAdvanced && (
              <div className="inline-flex items-center gap-1 ml-auto">
                <Chip
                  variant={viewMode === "grid" ? "sky" : "default"}
                  selected={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  icon={LayoutGrid}
                  size="sm"
                >
                  Grille
                </Chip>
                <Chip
                  variant={viewMode === "grouped" ? "sky" : "default"}
                  selected={viewMode === "grouped"}
                  onClick={() => setViewMode("grouped")}
                  icon={Columns3}
                  size="sm"
                >
                  Catégories
                </Chip>
                <Chip
                  variant={viewMode === "rotation" ? "sky" : "default"}
                  selected={viewMode === "rotation"}
                  onClick={() => setViewMode("rotation")}
                  icon={RotateCcw}
                  size="sm"
                >
                  Rotation
                </Chip>
              </div>
            )}
            {isVideo && (
              <Chip
                variant={selectMode ? "sky" : "default"}
                selected={selectMode}
                onClick={() => {
                  if (selectMode) exitSelectMode();
                  else setSelectMode(true);
                }}
                icon={CheckSquare}
                size="sm"
              >
                {selectMode ? `${selectMode ? "✓" : ""} Sélection` : "Sélectionner"}
              </Chip>
            )}
          </div>

          {/* Tags filter en mode avancé — collapsible discret */}
          {allTags.length > 0 && isAdvanced && (
            <details className="group">
              <summary className="cursor-pointer flex items-center gap-1.5 text-[10.5px] text-gray-500 hover:text-gray-700 select-none w-fit pl-1 py-1">
                <Tag size={10} />
                <span>Filtrer par tag</span>
                {tagFilter && (
                  <Chip variant="sky" size="sm" onRemove={() => setTagFilter("")}>
                    {tagFilter}
                  </Chip>
                )}
              </summary>
              <div className="flex items-center gap-1 flex-wrap pt-1.5 pl-1">
                {allTags.map((t) => (
                  <Chip
                    key={t}
                    variant={tagFilter === t ? "sky" : "default"}
                    selected={tagFilter === t}
                    onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                    size="sm"
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

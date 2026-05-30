"use client";

/**
 * MediaAssetsCategoriesSidebar — sidebar sticky left listant les catégories
 * pour navigation rapide en mode noob.
 *
 * Phase B médiathèque (2026-05-30). Items :
 *  - "Tous" (default, count = total)
 *  - "À ranger" (orphelins category=null, en peach si > 0)
 *  - "Désactivés" (disabled, en gray)
 *  - Séparateur
 *  - Liste des catégories avec count
 *
 * Visible uniquement en mode noob (le mode avancé garde la vue plein écran).
 * Sticky top pour rester visible en scroll de longue grille.
 */

import { useMemo } from "react";
import { FolderOpen, Layers, EyeOff } from "lucide-react";
import type { MediaAsset } from "./types";

export type CategoryFilter = "all" | "orphans" | "disabled" | { category: string };

interface Props {
  assets: MediaAsset[];
  selected: CategoryFilter;
  onSelect: (filter: CategoryFilter) => void;
}

function isCategoryEq(a: CategoryFilter, b: CategoryFilter): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "object" && typeof b === "object" && "category" in a && "category" in b) {
    return a.category === b.category;
  }
  return false;
}

export function MediaAssetsCategoriesSidebar({ assets, selected, onSelect }: Props) {
  const { categoriesWithCount, orphansCount, disabledCount } = useMemo(() => {
    const map = new Map<string, number>();
    let orphans = 0;
    let disabled = 0;
    for (const a of assets) {
      if (a.disabled) disabled++;
      if (!a.category) orphans++;
      else map.set(a.category, (map.get(a.category) ?? 0) + 1);
    }
    return {
      categoriesWithCount: Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)),
      orphansCount: orphans,
      disabledCount: disabled,
    };
  }, [assets]);

  return (
    <aside className="sticky top-4 self-start rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] p-2 max-h-[calc(100vh-2rem)] overflow-y-auto [scrollbar-width:thin]">
      <SidebarItem
        label="Tous"
        count={assets.length}
        icon={Layers}
        tint="sky"
        active={isCategoryEq(selected, "all")}
        onClick={() => onSelect("all")}
      />
      {orphansCount > 0 && (
        <SidebarItem
          label="Sans catégorie"
          count={orphansCount}
          icon={FolderOpen}
          tint="gray"
          active={isCategoryEq(selected, "orphans")}
          onClick={() => onSelect("orphans")}
        />
      )}
      {disabledCount > 0 && (
        <SidebarItem
          label="Désactivés"
          count={disabledCount}
          icon={EyeOff}
          tint="gray"
          active={isCategoryEq(selected, "disabled")}
          onClick={() => onSelect("disabled")}
        />
      )}

      {categoriesWithCount.length > 0 && (
        <>
          <div className="my-2 mx-2 border-t border-white/40" />
          <p className="px-3 py-1 text-[9px] uppercase tracking-widest font-semibold text-gray-400">
            Catégories
          </p>
          {categoriesWithCount.map(([cat, count]) => (
            <SidebarItem
              key={cat}
              label={cat}
              count={count}
              icon={FolderOpen}
              tint="violet"
              active={isCategoryEq(selected, { category: cat })}
              onClick={() => onSelect({ category: cat })}
            />
          ))}
        </>
      )}
    </aside>
  );
}

type Tint = "sky" | "sage" | "peach" | "gray" | "violet";

const TINT_CFG: Record<Tint, { iconActive: string; bgActive: string; textActive: string; iconRest: string }> = {
  sky:    { iconActive: "text-sky-700",    bgActive: "bg-sky-50/80",    textActive: "text-sky-900",    iconRest: "text-gray-400" },
  sage:   { iconActive: "text-sage-700",   bgActive: "bg-sage-50/80",   textActive: "text-sage-900",   iconRest: "text-gray-400" },
  peach:  { iconActive: "text-peach-700",  bgActive: "bg-peach-50/80",  textActive: "text-peach-900",  iconRest: "text-peach-600" },
  gray:   { iconActive: "text-gray-700",   bgActive: "bg-gray-100/80",  textActive: "text-gray-900",   iconRest: "text-gray-400" },
  violet: { iconActive: "text-violet-700", bgActive: "bg-violet-50/80", textActive: "text-violet-900", iconRest: "text-gray-400" },
};

function SidebarItem({
  label,
  count,
  icon: Icon,
  tint,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: typeof FolderOpen;
  tint: Tint;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = TINT_CFG[tint];
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all",
        active
          ? `${cfg.bgActive} ${cfg.textActive} font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]`
          : "text-gray-700 hover:bg-white/60 hover:backdrop-blur-[6px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
      ].join(" ")}
    >
      <Icon size={12} className={`shrink-0 ${active ? cfg.iconActive : cfg.iconRest}`} />
      <span className="flex-1 min-w-0 truncate text-[12px]">{label}</span>
      <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{count}</span>
    </button>
  );
}

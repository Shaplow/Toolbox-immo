"use client";

/**
 * FilterBar — toolbar de filtres sticky.
 *
 * Wrapper unifié pour les barres de filtre qu'on retrouve dans :
 * - CalendarFilters
 * - MediaAssetsPanel (filtres par tag, status, set)
 * - ListingForm (filtres recherche)
 * - admin tables divers
 *
 * Doctrine Liquid Glass v2 :
 * - Container surface-glass-soft + ring inset signature.
 * - Sticky top-N (default 16 — sous header app).
 * - Scroll horizontal sur mobile si overflow.
 * - Compteur "X filtres actifs" + bouton Reset à droite.
 *
 * API :
 *
 *   <FilterBar activeCount={3} onReset={() => {}}>
 *     <Input value={search} onChange={setSearch} icon={Search} />
 *     <Combobox value={status} onChange={...} options={...} />
 *     <Chip variant="sky" selected onClick={...}>Programmé</Chip>
 *   </FilterBar>
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../Button";

interface FilterBarProps {
  children: ReactNode;
  /** Nombre de filtres actifs (affiché à droite, pour info user). */
  activeCount?: number;
  /** Callback bouton "Réinitialiser". Si absent, bouton non affiché. */
  onReset?: () => void;
  /** Sticky top du wrapper. Default true. */
  sticky?: boolean;
  /** Offset top (px) si sticky. Default 0 (use case : header parent gère
   *  l'espace au-dessus). */
  stickyTop?: number;
  /** Style "page" ou "panel". Default "page" (rounded-xl + ring inset). */
  variant?: "page" | "panel" | "transparent";
  className?: string;
}

const VARIANT_CLS: Record<NonNullable<FilterBarProps["variant"]>, string> = {
  page:
    "rounded-xl bg-[var(--surface-glass-soft)] backdrop-blur-[16px] backdrop-saturate-150 shadow-[var(--ring-glass-edge),inset_0_1px_0_rgba(255,255,255,0.7)]",
  panel:
    "rounded-lg bg-white/45 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04)]",
  transparent: "",
};

export function FilterBar({
  children,
  activeCount,
  onReset,
  sticky = true,
  stickyTop = 0,
  variant = "page",
  className,
}: FilterBarProps) {
  return (
    <div
      className={[
        "flex items-center gap-3 px-3 py-2.5",
        sticky ? "sticky z-10" : "",
        VARIANT_CLS[variant],
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={sticky ? { top: stickyTop } : undefined}
    >
      {/* Scroll horizontal sur mobile, wrap sur desktop. */}
      <div className="flex-1 flex items-center gap-2 overflow-x-auto md:flex-wrap [scrollbar-width:thin]">
        {children}
      </div>

      {(activeCount !== undefined && activeCount > 0) || onReset ? (
        <div className="shrink-0 flex items-center gap-2">
          {activeCount !== undefined && activeCount > 0 && (
            <span className="text-[11px] text-gray-500 font-medium tabular-nums whitespace-nowrap">
              {activeCount} {activeCount > 1 ? "filtres" : "filtre"}
            </span>
          )}
          {onReset && activeCount !== undefined && activeCount > 0 && (
            <Button variant="ghost" size="sm" icon={X} onClick={onReset}>
              Réinitialiser
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

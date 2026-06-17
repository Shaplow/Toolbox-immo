"use client";

/**
 * FilterBar — toolbar de filtres sticky.
 *
 * Wrapper unifié pour les barres de filtre (CalendarFilters, MediaAssetsPanel,
 * ListingForm, admin tables).
 *
 * Flat shadcn :
 * - Container bg-card border-border (variant page) ou bg-muted (variant panel)
 *   ou transparent.
 * - Sticky top-N optionnel.
 * - Compteur "X filtres actifs" + bouton Reset.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../Button";

interface FilterBarProps {
  children: ReactNode;
  activeCount?: number;
  onReset?: () => void;
  sticky?: boolean;
  stickyTop?: number;
  variant?: "page" | "panel" | "transparent";
  className?: string;
}

const VARIANT_CLS: Record<NonNullable<FilterBarProps["variant"]>, string> = {
  page:        "rounded-md bg-card border border-border",
  panel:       "rounded-md bg-muted border border-border",
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
      <div className="flex-1 flex items-center gap-2 overflow-x-auto md:flex-wrap [scrollbar-width:thin]">
        {children}
      </div>

      {(activeCount !== undefined && activeCount > 0) || onReset ? (
        <div className="shrink-0 flex items-center gap-2">
          {activeCount !== undefined && activeCount > 0 && (
            <span className="text-[11px] text-muted-foreground font-medium tabular-nums whitespace-nowrap">
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

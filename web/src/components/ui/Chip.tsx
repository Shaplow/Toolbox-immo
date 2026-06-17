"use client";

/**
 * Chip — tag pill compact ACTIONNABLE (cliquable, removable).
 *
 * À distinguer de Badge (purement informatif). Use cases : filtres actifs,
 * tags sélectionnés dans Combobox, catégories.
 *
 * Variants Coastal Studio (peach/sage/sky/rose) du v2 mappés vers `default`
 * en DA v3. Sizes : sm (h-5) | md (h-6, default).
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

type Variant = "default" | "peach" | "sage" | "sky" | "rose";
type Size = "sm" | "md";

interface ChipProps {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  onRemove?: () => void;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  testId?: string;
}

export function Chip({
  children,
  variant: _variant = "default",
  size = "md",
  icon: Icon,
  onRemove,
  onClick,
  selected = false,
  className,
  testId,
}: ChipProps) {
  void _variant;
  const sizeCls = size === "sm" ? "h-5 text-[11px]" : "h-6 text-[12px]";
  const iconSize = size === "sm" ? 10 : 12;
  const padX = onRemove ? "pl-2 pr-0.5" : "px-2";

  const interactive = !!onClick;

  const baseCls = selected
    ? "bg-primary/10 text-primary border border-primary/30"
    : "bg-muted text-foreground border border-border";

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full transition-colors leading-none",
        sizeCls,
        padX,
        baseCls,
        interactive ? "cursor-pointer hover:bg-accent" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      data-testid={testId}
    >
      {Icon && <Icon size={iconSize} className="shrink-0" />}
      <span className="font-medium">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors focus-ring hover:bg-zinc-300 hover:text-foreground"
          aria-label="Retirer"
        >
          <X size={iconSize - 2} />
        </button>
      )}
    </span>
  );
}

"use client";

/**
 * OverrideControl — pattern "hériter du parent" vs "override custom".
 *
 * Factorise les 3 variantes dupliquées (boolean, enum, preset) dans SlotDetailPanel.
 *
 * Flat shadcn :
 * - Container : bg-card border-border (default) ou bg-primary/5 border-primary/30 (override actif).
 * - Header : label + description + switch d'override.
 * - Body : valeur héritée (muted) ou éditeur custom (children).
 */

import type { ReactNode } from "react";
import { Switch } from "../Switch";

interface OverrideControlProps {
  label: ReactNode;
  description?: ReactNode;
  inheritedValue: ReactNode;
  isOverriden: boolean;
  onToggleOverride: (value: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function OverrideControl({
  label,
  description,
  inheritedValue,
  isOverriden,
  onToggleOverride,
  children,
  disabled = false,
  className,
}: OverrideControlProps) {
  return (
    <div
      className={[
        "rounded-md px-4 py-3.5 border transition-colors",
        isOverriden ? "bg-primary/5 border-primary/30" : "bg-card border-border",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex items-start justify-between gap-4 mb-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground leading-tight">{label}</p>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        <Switch
          checked={isOverriden}
          onChange={onToggleOverride}
          disabled={disabled}
          size="sm"
        />
      </div>

      {isOverriden ? (
        <div className="pt-2 border-t border-primary/20">
          <p className="text-[10px] uppercase tracking-widest font-medium text-primary mb-2">
            Override actif
          </p>
          {children}
        </div>
      ) : (
        <div className="pt-2 border-t border-border">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-1">
            Hérité
          </p>
          <p className="text-[13px] text-foreground leading-relaxed">{inheritedValue}</p>
        </div>
      )}
    </div>
  );
}

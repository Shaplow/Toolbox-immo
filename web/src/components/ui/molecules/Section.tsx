"use client";

/**
 * Section — wrapper unifié pour les sections de fiche.
 *
 * Flat shadcn :
 * - Container : bg-card border-border rounded-2xl.
 * - Header : icône + titre + description + actions.
 * - Collapsible optionnel : pill bg-muted au repos.
 *
 * Variants legacy (frosted/glass/tinted) mappés vers default.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Variant = "default" | "glass" | "frosted" | "tinted";
type Tint = "peach" | "sage" | "sky" | "rose";

interface SectionProps {
  title: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: Variant;
  tint?: Tint;
  collapsible?: boolean;
  defaultOpen?: boolean;
  storageKey?: string;
  sectionId?: string;
  padded?: boolean;
  children: ReactNode;
  className?: string;
}

export function Section({
  title,
  icon: Icon,
  description,
  actions,
  variant: _variant = "default",
  tint: _tint,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  sectionId,
  padded = true,
  children,
  className,
}: SectionProps) {
  void _variant;
  void _tint;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "open") setOpen(true);
      else if (stored === "closed") setOpen(false);
    } catch {
      // localStorage indispo → ignore.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }, [open, storageKey]);

  useEffect(() => {
    if (!sectionId || typeof window === "undefined") return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ sectionId?: string }>).detail;
      if (detail?.sectionId === sectionId) setOpen(true);
    }
    window.addEventListener("pub:open-section", handler);
    return () => window.removeEventListener("pub:open-section", handler);
  }, [sectionId]);

  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "w-full flex items-center justify-between px-5 py-3 rounded-lg text-left transition-colors focus-ring bg-card border border-border hover:bg-muted",
          className ?? "",
        ].join(" ")}
        aria-expanded={false}
        aria-controls={sectionId}
      >
        <span className="inline-flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-md bg-muted border border-border text-muted-foreground">
              <Icon size={12} />
            </span>
          )}
          <span className="text-[13px] font-semibold text-foreground truncate">{title}</span>
        </span>
        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <section
      id={sectionId}
      className={[
        "relative rounded-2xl overflow-hidden bg-card text-card-foreground border border-border",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {Icon && (
            <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted border border-border text-muted-foreground">
              <Icon size={14} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-foreground leading-tight">
              {title}
            </h2>
            {description && (
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Réduire"
              title="Réduire"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-ring"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>

      <div className={padded ? "px-5 pb-5" : ""}>{children}</div>
    </section>
  );
}

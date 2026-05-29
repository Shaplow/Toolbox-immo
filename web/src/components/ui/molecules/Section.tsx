"use client";

/**
 * Section — wrapper unifié pour les sections de fiche (publications, admin,
 * builder, etc.).
 *
 * Factorise le pattern dupliqué dans les 9 sections de PublicationFiche
 * (`bg-white border rounded-2xl p-8`) + le pattern CollapsibleSection.
 *
 * Doctrine Liquid Glass v2 :
 * - Variant `default` (solid Card) ou `glass` (surface-glass-strong) ou
 *   `tinted` (Coastal pastel via tint prop).
 * - Header sticky optionnel (sticky-on-scroll prévu Phase 6 — pour l'instant
 *   non-sticky).
 * - Collapsible optionnel : pill fermé glass-faint au repos + chevron.
 * - Slot icon (Lucide leading), title (semibold), description (gray body),
 *   actions (right side).
 *
 * API minimale :
 *   <Section title="Brief client">…</Section>
 *
 * API riche :
 *   <Section
 *     icon={FileText}
 *     title="Brief client"
 *     description="Visite guidée du 3 pièces"
 *     actions={<Button size="sm" icon={Edit}>Éditer</Button>}
 *     variant="glass"
 *     collapsible
 *     defaultOpen
 *     storageKey="pub-brief"
 *   >
 *     …
 *   </Section>
 */

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Variant = "default" | "glass" | "tinted";
type Tint = "peach" | "sage" | "sky" | "rose";

interface SectionProps {
  /** Titre obligatoire — affiché en pill fermé ET en header ouvert. */
  title: ReactNode;
  /** Icône Lucide leading dans le header. */
  icon?: LucideIcon;
  /** Description sous le titre (text-[12px] gray). */
  description?: ReactNode;
  /** Actions à droite du header (Button, Switch, etc.). */
  actions?: ReactNode;
  /** Variant visuel. Default "default" (solid Card). */
  variant?: Variant;
  /** Si variant="tinted", choisir la teinte. */
  tint?: Tint;
  /** Permet de plier/déplier. Default false (toujours ouvert). */
  collapsible?: boolean;
  /** État ouvert initial si collapsible. Default true. */
  defaultOpen?: boolean;
  /** Persiste l'état entre les visites de la page. */
  storageKey?: string;
  /** Permet à un autre composant (ProductionChain, header) d'ouvrir via
   *  `window.dispatchEvent(new CustomEvent("pub:open-section", { detail: { sectionId } }))`. */
  sectionId?: string;
  /** Body padded. Default true. */
  padded?: boolean;
  children: ReactNode;
  className?: string;
}

const VARIANT_CONTAINER: Record<Variant, string> = {
  default:
    "bg-gradient-to-b from-white to-white/85 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
  glass:
    "bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150 shadow-[var(--ring-glass-inset),inset_0_0_0_1px_rgba(255,255,255,0.45),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
  tinted: "", // résolu par tint ci-dessous
};

const TINT_CONTAINER: Record<Tint, string> = {
  peach: "bg-peach-50/70 border border-peach-100/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
  sage:  "bg-sage-50/70 border border-sage-100/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
  sky:   "bg-sky-50/70 border border-sky-100/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
  rose:  "bg-rose-50/70 border border-rose-100/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
};

export function Section({
  title,
  icon: Icon,
  description,
  actions,
  variant = "default",
  tint,
  collapsible = false,
  defaultOpen = true,
  storageKey,
  sectionId,
  padded = true,
  children,
  className,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Restore from localStorage.
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

  // Persist to localStorage.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }, [open, storageKey]);

  // Listen for pub:open-section event.
  useEffect(() => {
    if (!sectionId || typeof window === "undefined") return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ sectionId?: string }>).detail;
      if (detail?.sectionId === sectionId) setOpen(true);
    }
    window.addEventListener("pub:open-section", handler);
    return () => window.removeEventListener("pub:open-section", handler);
  }, [sectionId]);

  const containerCls =
    variant === "tinted" && tint
      ? TINT_CONTAINER[tint]
      : VARIANT_CONTAINER[variant];

  // Si collapsible fermé : rendre uniquement le pill compact.
  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "w-full flex items-center justify-between px-5 py-3 rounded-2xl text-left transition-colors focus-ring",
          "bg-[var(--surface-glass-faint)] backdrop-blur-[8px] backdrop-saturate-150",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(15,23,42,0.04)]",
          "hover:bg-[var(--surface-glass-medium)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]",
          className ?? "",
        ].join(" ")}
        aria-expanded={false}
        aria-controls={sectionId}
      >
        <span className="inline-flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/70 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-gray-700">
              <Icon size={12} />
            </span>
          )}
          <span className="text-[13px] font-semibold text-gray-700 truncate">{title}</span>
        </span>
        <ChevronRight size={14} className="text-gray-400 shrink-0" />
      </button>
    );
  }

  return (
    <section
      id={sectionId}
      className={[
        "relative rounded-2xl overflow-hidden",
        containerCls,
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {Icon && (
            <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/70 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-gray-700">
              <Icon size={14} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-gray-950 leading-tight">
              {title}
            </h2>
            {description && (
              <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{description}</p>
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
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-white/60 transition-colors focus-ring"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className={padded ? "px-5 pb-5" : ""}>{children}</div>
    </section>
  );
}

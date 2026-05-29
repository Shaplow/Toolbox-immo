"use client";

/**
 * Banner — bannière sticky top pour signaux système.
 *
 * Use cases :
 * - Impersonation / Vue-rôle admin
 * - Annonces de maintenance ("Le service sera interrompu de 22h à 23h")
 * - Alertes globales ("Quota Claude API dépassé")
 * - Confirmations persistantes ("Modifications enregistrées")
 *
 * Doctrine Liquid Glass v2 :
 * - Surface : surface-glass-soft + accent gauche pastel prononcé (3px).
 * - Variants : info (sky) / success (sage) / warning (peach) / danger
 *   (rose) / neutral (gray). Pas de couleurs Tailwind hardcodées (plus
 *   d'amber/fuchsia hors palette).
 * - Density Linear : py-2, text-[13px], icône 14px.
 * - Action optionnelle (Button ghost ou text-button) à droite.
 *
 * À distinguer de :
 * - Alert (inline dans une page, card avec border + actions multiples)
 * - Toast (overlay transient bottom-right, auto-dismiss)
 * - Badge / Chip (inline tag dans une autre composition)
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Variant = "info" | "success" | "warning" | "danger" | "neutral";

interface BannerProps {
  variant?: Variant;
  icon?: LucideIcon;
  /** Texte principal de la bannière. */
  children: ReactNode;
  /** Action à droite (ex: bouton "Quitter"). Si string, rendu en button text. */
  action?: { label: string; onClick: () => void } | ReactNode;
  className?: string;
}

const VARIANT_STYLES: Record<Variant, {
  container: string;
  accent: string;
  text: string;
  icon: string;
  button: string;
}> = {
  info: {
    container: "bg-sky-50/55 backdrop-blur-[12px] backdrop-saturate-150",
    accent:    "shadow-[inset_4px_0_0_0_rgba(77,150,191,1),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(15,23,42,0.04)]",
    text:      "text-sky-700",
    icon:      "text-sky-700",
    button:    "text-sky-700 hover:text-sky-700",
  },
  success: {
    container: "bg-sage-50/55 backdrop-blur-[12px] backdrop-saturate-150",
    accent:    "shadow-[inset_4px_0_0_0_rgba(111,162,128,1),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(15,23,42,0.04)]",
    text:      "text-sage-700",
    icon:      "text-sage-700",
    button:    "text-sage-700 hover:text-sage-700",
  },
  warning: {
    container: "bg-peach-50/55 backdrop-blur-[12px] backdrop-saturate-150",
    accent:    "shadow-[inset_4px_0_0_0_rgba(245,158,107,1),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(15,23,42,0.04)]",
    text:      "text-peach-700",
    icon:      "text-peach-700",
    button:    "text-peach-700 hover:text-peach-700",
  },
  danger: {
    container: "bg-rose-50/55 backdrop-blur-[12px] backdrop-saturate-150",
    accent:    "shadow-[inset_4px_0_0_0_rgba(201,113,133,1),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(15,23,42,0.04)]",
    text:      "text-rose-700",
    icon:      "text-rose-700",
    button:    "text-rose-700 hover:text-rose-700",
  },
  neutral: {
    container: "bg-white/50 backdrop-blur-[12px] backdrop-saturate-150",
    accent:    "shadow-[inset_4px_0_0_0_rgba(107,114,128,0.6),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(15,23,42,0.04)]",
    text:      "text-gray-700",
    icon:      "text-gray-500",
    button:    "text-gray-700 hover:text-gray-950",
  },
};

function isActionObject(
  action: BannerProps["action"],
): action is { label: string; onClick: () => void } {
  return (
    !!action &&
    typeof action === "object" &&
    !Array.isArray(action) &&
    "label" in action &&
    "onClick" in action
  );
}

export function Banner({
  variant = "info",
  icon: Icon,
  children,
  action,
  className,
}: BannerProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <div
      role="status"
      className={[
        "flex items-center justify-between gap-4 px-4 py-2 text-[13px]",
        styles.container,
        styles.accent,
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className={`flex items-center gap-2 min-w-0 ${styles.text}`}>
        {Icon && <Icon size={14} className={`${styles.icon} shrink-0`} />}
        <span className="truncate">{children}</span>
      </div>
      {action && (
        <div className="shrink-0">
          {isActionObject(action) ? (
            <button
              type="button"
              onClick={action.onClick}
              className={`text-[12px] font-medium underline-offset-2 hover:underline transition-colors focus-ring rounded-sm ${styles.button}`}
            >
              {action.label}
            </button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}

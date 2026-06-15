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
  text: string;
  icon: string;
  button: string;
}> = {
  // v3 big bang DA — flat shadcn : zinc-50 background + border zinc-200 +
  // accent gauche border-l-4 par variant. Plus de backdrop-blur, plus de
  // gradient pastel Coastal Studio.
  info: {
    container: "bg-info-50 border border-info-200 border-l-4 border-l-info-600",
    text:      "text-info-700",
    icon:      "text-info-600",
    button:    "text-info-700 hover:text-info-600",
  },
  success: {
    container: "bg-success-50 border border-success-200 border-l-4 border-l-success-600",
    text:      "text-success-700",
    icon:      "text-success-600",
    button:    "text-success-700 hover:text-success-600",
  },
  warning: {
    container: "bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500",
    text:      "text-amber-700",
    icon:      "text-amber-600",
    button:    "text-amber-700 hover:text-amber-600",
  },
  danger: {
    container: "bg-danger-50 border border-danger-200 border-l-4 border-l-danger-600",
    text:      "text-danger-700",
    icon:      "text-danger-600",
    button:    "text-danger-700 hover:text-danger-600",
  },
  neutral: {
    container: "bg-muted border border-border border-l-4 border-l-zinc-400",
    text:      "text-foreground",
    icon:      "text-muted-foreground",
    button:    "text-foreground hover:text-primary",
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
        "flex items-center justify-between gap-4 px-4 py-2 text-[13px] rounded-md",
        styles.container,
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

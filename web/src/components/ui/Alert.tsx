"use client";

/**
 * Alert — message inline informatif, succès, avertissement, erreur.
 *
 * Doctrine Liquid Glass v2 :
 * - 4 variants sémantiques (info/success/warning/danger) + 1 neutre (glass).
 * - Background tinté très léger (50/40α) + backdrop-blur + ring inset
 *   spéculaire signature + accent gauche prononcé pour signaler le type.
 * - Icône à gauche dans wrapper glass dédié.
 * - Optional `onDismiss` ajoute un bouton X.
 *
 * À distinguer de Toast : Alert est inline dans la page (statique), Toast
 * apparaît en overlay transient.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  X,
} from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";

type Variant = "info" | "success" | "warning" | "danger" | "glass";

interface AlertProps {
  variant?: Variant;
  /** Icône Lucide. Si absente, l'icône par défaut du variant est utilisée. */
  icon?: LucideIcon | null;
  title?: ReactNode;
  children?: ReactNode;
  /** Actions inline (ex: Button "Voir détails"). */
  actions?: ReactNode;
  /** Callback bouton X (sinon pas de dismiss). */
  onDismiss?: () => void;
  className?: string;
}

const DEFAULT_ICON: Record<Variant, LucideIcon> = {
  info:    Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger:  XCircle,
  glass:   Sparkles,
};

const VARIANT_STYLES: Record<Variant, { container: string; accent: string; icon: string; title: string }> = {
  info: {
    container: "bg-sky-50/55 border-l-sky-500",
    accent:    "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(77,150,191,0.12)]",
    icon:      "text-sky-700",
    title:     "text-sky-700",
  },
  success: {
    container: "bg-sage-50/55 border-l-sage-500",
    accent:    "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(111,162,128,0.14)]",
    icon:      "text-sage-700",
    title:     "text-sage-700",
  },
  warning: {
    container: "bg-peach-50/55 border-l-peach-500",
    accent:    "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(245,158,107,0.14)]",
    icon:      "text-peach-700",
    title:     "text-peach-700",
  },
  danger: {
    container: "bg-rose-50/55 border-l-rose-500",
    accent:    "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.14)]",
    icon:      "text-rose-700",
    title:     "text-rose-700",
  },
  glass: {
    container: "bg-white/40 border-l-gray-300",
    accent:    "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]",
    icon:      "text-gray-700",
    title:     "text-gray-950",
  },
};

export function Alert({
  variant = "info",
  icon: IconProp,
  title,
  children,
  actions,
  onDismiss,
  className,
}: AlertProps) {
  const styles = VARIANT_STYLES[variant];
  const Icon = IconProp === null ? null : IconProp ?? DEFAULT_ICON[variant];

  return (
    <div
      role="alert"
      className={[
        "relative flex items-start gap-3 rounded-lg border-l-2 px-4 py-3",
        "backdrop-blur-[12px] backdrop-saturate-150",
        styles.container,
        styles.accent,
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {Icon && (
        <span
          className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/70 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.04)] ${styles.icon}`}
        >
          <Icon size={14} />
        </span>
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        {title && (
          <p className={`text-[13px] font-semibold leading-tight ${styles.title}`}>
            {title}
          </p>
        )}
        {children && (
          <div className="text-[12px] text-gray-700 leading-relaxed">{children}</div>
        )}
        {actions && <div className="pt-1 flex items-center gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <ButtonIcon
          icon={X}
          label="Fermer"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="shrink-0 -mr-1"
        />
      )}
    </div>
  );
}

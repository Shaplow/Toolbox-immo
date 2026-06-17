"use client";

/**
 * Alert — message inline informatif, succès, avertissement, erreur.
 *
 * 4 variants sémantiques (info/success/warning/danger) + 1 neutre.
 * Fond zinc-50 + accent gauche coloré par variant. Pas de glass, pas de pastel.
 *
 * À distinguer de Toast : Alert est inline statique, Toast est overlay transient.
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

const VARIANT_STYLES: Record<Variant, { accent: string; icon: string; title: string }> = {
  info:    { accent: "border-l-primary",      icon: "text-primary",      title: "text-foreground" },
  success: { accent: "border-l-success-600",  icon: "text-success-600",  title: "text-foreground" },
  warning: { accent: "border-l-warning-600",  icon: "text-warning-600",  title: "text-foreground" },
  danger:  { accent: "border-l-danger-600",   icon: "text-danger-600",   title: "text-foreground" },
  glass:   { accent: "border-l-border",       icon: "text-muted-foreground", title: "text-foreground" },
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
        "relative flex items-start gap-3 rounded-md border border-border border-l-4 px-4 py-3",
        "bg-muted",
        styles.accent,
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {Icon && (
        <span
          className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md bg-card border border-border ${styles.icon}`}
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
          <div className="text-[12px] text-muted-foreground leading-relaxed">{children}</div>
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

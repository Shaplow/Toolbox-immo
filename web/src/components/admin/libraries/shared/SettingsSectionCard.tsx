"use client";

/**
 * SettingsSectionCard — shell commun aux sections d'un drawer de réglages
 * bibliothèque (titre uppercase + icône optionnelle + carte bg-card).
 *
 * Extrait de MediaLibrarySettingsDrawer / DataLibrarySettingsDrawer, où le
 * même wrapper `rounded-2xl bg-card border border-border p-4` + `<h3>` était
 * dupliqué à l'identique sur chaque tab.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface SettingsSectionCardProps {
  title: string;
  icon?: LucideIcon;
  /** Action alignée à droite du titre (ex: bouton refresh). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSectionCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: SettingsSectionCardProps) {
  return (
    <section
      className={[
        "rounded-2xl bg-card border border-border p-4 space-y-3",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground inline-flex items-center gap-1.5">
          {Icon && <Icon size={11} />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

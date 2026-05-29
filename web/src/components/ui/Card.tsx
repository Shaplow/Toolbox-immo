"use client";

import type { ReactNode } from "react";

/**
 * Conteneur Card — pattern Linear · Vercel.
 *
 * - `as`        : balise rendue (div par défaut, a/article/section).
 * - `interactive` : ajoute hover lift + cursor-pointer (pour cards
 *                    cliquables). Pour les Links, préférer un wrapper
 *                    <Link><Card interactive>...</Card></Link>.
 * - `padded`    : applique p-5 (default true). Mettre false pour les
 *                  cards qui contiennent leurs propres sections
 *                  (Header / Body / Footer custom).
 * - `border`    : montre la border gray-200 (default true).
 *
 * Pas de variant — la Card est sobre par essence. La hiérarchie passe
 * par le contenu et le contexte, pas par une couleur de fond.
 */

interface CardProps {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
  border?: boolean;
  className?: string;
}

export function Card({
  children,
  interactive = false,
  padded = true,
  border = true,
  className,
}: CardProps) {
  const base = "bg-white rounded-lg overflow-hidden";
  const borderCls = border ? "border border-gray-200" : "";
  const paddedCls = padded ? "p-5" : "";
  const interactiveCls = interactive
    ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
    : "";

  return (
    <div
      className={[base, borderCls, paddedCls, interactiveCls, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/**
 * Header de Card — eyebrow uppercase + actions à droite.
 * À placer en début de Card padded=false.
 */
export function CardHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between border-b border-gray-200 bg-gray-50/40 px-4 py-2.5",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
        {title}
      </p>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";

/**
 * Card — conteneur flat shadcn-style (v3 big bang DA 2026-06-15).
 *
 * Variants vivants :
 * - `default` (recommandé) : white + border zinc-200 + shadow-sm rounded-lg.
 * - `outline` : white + border zinc-200, pas de shadow (plus discret).
 *
 * Backward compat : les anciens variants `solid`/`glass`/`frosted`/`tinted`
 * et la prop `tint` sont conservés en TYPE mais mappés vers `default` —
 * aucun call site n'est à mettre à jour en urgence, le visual sera
 * neutralisé proprement. Le sweep Phase D du big bang supprimera les
 * aliases morts au fur et à mesure.
 */

type CardVariant = "default" | "outline" | "solid" | "glass" | "frosted" | "tinted";
type CardTint = "peach" | "sage" | "sky" | "rose";

interface CardProps {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
  border?: boolean;
  variant?: CardVariant;
  /** @deprecated v3 — ignoré, conservé pour compat call sites V2. */
  tint?: CardTint;
  className?: string;
}

function resolveVariant(v: CardVariant): "default" | "outline" {
  return v === "outline" ? "outline" : "default";
}

export function Card({
  children,
  interactive = false,
  padded = true,
  border = true,
  variant = "default",
  className,
}: CardProps) {
  const v = resolveVariant(variant);

  const base = [
    "bg-card text-card-foreground rounded-lg overflow-hidden",
    border ? "border border-border" : "",
    v === "default" ? "shadow-sm" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const paddedCls = padded ? "p-5" : "";

  const interactiveCls = interactive
    ? "cursor-pointer transition-shadow hover:shadow-md"
    : "";

  return (
    <div
      className={[base, paddedCls, interactiveCls, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/**
 * Header de Card — eyebrow uppercase + actions à droite.
 *
 * Option `borderless` : retire la border-b et le fond muted pour cards
 * qui composent leur propre chrome interne.
 */
export function CardHeader({
  title,
  actions,
  borderless = false,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  borderless?: boolean;
  className?: string;
}) {
  const chrome = borderless
    ? "bg-transparent"
    : "border-b border-border bg-muted/40";

  return (
    <div
      className={[
        "flex items-center justify-between px-4 py-2.5",
        chrome,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
        {title}
      </p>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

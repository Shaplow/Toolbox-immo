"use client";

/**
 * EmptyHero — empty state grand format pour pages vides.
 *
 * À distinguer d'<EmptyState> (inline dans une carte/section).
 * Pour /listings sans listings, /tools vide, /admin/libraries sans library, etc.
 *
 * Flat shadcn : icône dans cercle bg-muted, titre semibold, description sobre.
 */

import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyHeroProps {
  icon: LucideIcon | ReactElement;
  title: string;
  description?: ReactNode;
  cta?: ReactNode;
  secondaryActions?: ReactNode;
  padding?: "md" | "lg" | "xl";
  className?: string;
}

const PADDING_CLS = {
  md: "py-12",
  lg: "py-20",
  xl: "py-28",
};

export function EmptyHero({
  icon,
  title,
  description,
  cta,
  secondaryActions,
  padding = "lg",
  className,
}: EmptyHeroProps) {
  const iconNode = isValidElement(icon)
    ? icon
    : (() => {
        const Icon = icon as LucideIcon;
        return <Icon size={32} className="text-muted-foreground" strokeWidth={1.5} />;
      })();

  return (
    <div
      className={[
        "flex flex-col items-center text-center px-6",
        PADDING_CLS[padding],
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div
        className="inline-flex h-20 w-20 items-center justify-center rounded-lg mb-6 bg-muted border border-border"
        aria-hidden
      >
        {iconNode}
      </div>

      <h2 className="text-2xl font-semibold text-foreground leading-tight tracking-tight">
        {title}
      </h2>

      {description && (
        <p className="text-[13px] text-muted-foreground max-w-md mt-3 leading-relaxed">
          {description}
        </p>
      )}

      {(cta || secondaryActions) && (
        <div className="mt-6 flex flex-col sm:flex-row items-center gap-2">
          {cta}
          {secondaryActions}
        </div>
      )}
    </div>
  );
}

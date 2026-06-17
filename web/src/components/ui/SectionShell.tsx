/**
 * SectionShell — surface standard pour les sections de fiche.
 *
 * Flat shadcn : bg-card + border-border + rounded + padding.
 * Remplace le pattern `bg-white border border-gray-100 rounded-2xl p-8` partout.
 *
 * Pas de "use client" — composant pur de présentation.
 */

import type { ReactNode } from "react";

type Padding = "sm" | "md" | "lg";
type Rounded = "lg" | "xl" | "2xl";

interface SectionShellProps {
  id?: string;
  children: ReactNode;
  padding?: Padding;
  rounded?: Rounded;
  className?: string;
}

const PADDING_CLS: Record<Padding, string> = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const ROUNDED_CLS: Record<Rounded, string> = {
  lg:    "rounded-lg",
  xl:    "rounded-xl",
  "2xl": "rounded-2xl",
};

export function SectionShell({
  id,
  children,
  padding = "lg",
  rounded = "2xl",
  className,
}: SectionShellProps) {
  return (
    <section
      id={id}
      className={[
        "bg-card text-card-foreground border border-border",
        ROUNDED_CLS[rounded],
        PADDING_CLS[padding],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}

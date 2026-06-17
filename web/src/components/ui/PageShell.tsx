/**
 * PageShell — wrapper standard de page outil/admin.
 *
 * Flat shadcn — pas de gradient, pas de rounded-3xl signature, juste un
 * container max-width centré avec padding.
 *
 * Variants :
 * - default : pages outil standard (max-w-7xl).
 * - wide : pages admin denses (max-w-[1400px]).
 * - narrow : pages focus / hub (max-w-4xl).
 */

import type { ReactNode } from "react";

export type PageShellVariant = "default" | "wide" | "narrow";

interface PageShellProps {
  children: ReactNode;
  variant?: PageShellVariant;
  className?: string;
}

const VARIANT_WIDTH: Record<PageShellVariant, string> = {
  default: "max-w-7xl",
  wide:    "max-w-[1400px]",
  narrow:  "max-w-4xl",
};

export function PageShell({
  children,
  variant = "default",
  className,
}: PageShellProps) {
  return (
    <div className="min-h-screen">
      <div
        className={[
          "mx-auto px-6 py-8",
          VARIANT_WIDTH[variant],
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

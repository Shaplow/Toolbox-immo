/**
 * PageShell — wrapper standard de page outil/admin.
 *
 * Use cases :
 * 1. Pages outil (/captions, /transcriptions, /descriptions, /listings,
 *    /generate) — variant "default".
 * 2. Pages admin denses (/admin/clients, /admin/accounts, /admin/patterns,
 *    /admin/users, /admin/jobs) — variant "wide".
 * 3. Pages focus narrow (/admin/libraries hub) — variant "narrow".
 *
 * Doctrine : margin uniforme avec gradient page-shell, rounded-3xl,
 * inset shadow signature. Avant V2 : copié inline 6+ fois avec des
 * ml/mr variants (60/100px) divergents par page.
 *
 * `min-h-screen` est posé sur le wrapper extérieur pour que le gradient
 * pastel ne soit pas coupé sur les pages courtes (cover, empty states).
 */

import type { ReactNode } from "react";

export type PageShellVariant = "default" | "wide" | "narrow";

interface PageShellProps {
  children: ReactNode;
  variant?: PageShellVariant;
  className?: string;
}

const VARIANT_INSET: Record<PageShellVariant, string> = {
  // default = pages outil standard, marges latérales équilibrées.
  default: "ml-[100px] mr-[100px]",
  // wide = pages admin avec tables/grilles denses, marges réduites.
  wide: "ml-[60px] mr-[60px]",
  // narrow = pages focus (hub, landing config), marges larges.
  narrow: "ml-[160px] mr-[160px]",
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
          "my-11 rounded-3xl",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.04)]",
          VARIANT_INSET[variant],
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ background: "var(--gradient-page-shell)" }}
      >
        {children}
      </div>
    </div>
  );
}

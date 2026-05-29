"use client";

/**
 * Breadcrumb — chemin de navigation hiérarchique.
 *
 * Doctrine Liquid Glass v2 :
 * - Density Linear : text-[12px] tracking neutre, items espacés par
 *   separator (chevron par défaut, slash optionnel).
 * - Item courant (dernier) : text-gray-950 font-medium, non cliquable.
 * - Items précédents : text-gray-500, hover gray-950 + underline subtle.
 * - Truncate gracieux en mobile via `…` au milieu (optionnel).
 *
 * À utiliser dans les fiches profondes (admin/clients/[id], publications/[id]).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  /** Lien optionnel — sans href, l'item est rendu non cliquable. */
  href?: string;
  label: ReactNode;
  /** Icône optionnelle à gauche du label. */
  icon?: React.ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Separator entre items. Default : ChevronRight. */
  separator?: ReactNode;
  /** Tronque au milieu si plus que N items (affiche … en milieu). */
  truncateAfter?: number;
  className?: string;
}

export function Breadcrumb({ items, separator, truncateAfter, className }: BreadcrumbProps) {
  const sep = separator ?? <ChevronRight size={12} className="text-gray-400 shrink-0" />;

  // Truncation : si items.length > truncateAfter, garder le premier + … + 2 derniers.
  let display: Array<BreadcrumbItem | "ellipsis"> = items;
  if (truncateAfter && items.length > truncateAfter) {
    display = [items[0], "ellipsis", ...items.slice(-2)];
  }

  return (
    <nav aria-label="Fil d'Ariane" className={["flex items-center gap-1.5 text-[12px] min-w-0", className ?? ""].filter(Boolean).join(" ")}>
      {display.map((item, i) => {
        const isLast = i === display.length - 1;
        if (item === "ellipsis") {
          return (
            <span key={`ellipsis-${i}`} className="inline-flex items-center gap-1.5">
              <span className="text-gray-400">…</span>
              {!isLast && sep}
            </span>
          );
        }
        return (
          <span key={`${i}-${typeof item.label === "string" ? item.label : ""}`} className="inline-flex items-center gap-1.5 min-w-0">
            <BreadcrumbCrumb item={item} isLast={isLast} />
            {!isLast && sep}
          </span>
        );
      })}
    </nav>
  );
}

function BreadcrumbCrumb({ item, isLast }: { item: BreadcrumbItem; isLast: boolean }) {
  const inner = (
    <>
      {item.icon}
      <span className="truncate">{item.label}</span>
    </>
  );

  if (isLast || !item.href) {
    return (
      <span
        className={[
          "inline-flex items-center gap-1 min-w-0",
          isLast ? "text-gray-950 font-medium" : "text-gray-500",
        ].join(" ")}
        aria-current={isLast ? "page" : undefined}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className="inline-flex items-center gap-1 min-w-0 text-gray-500 hover:text-gray-950 hover:underline underline-offset-2 transition-colors"
    >
      {inner}
    </Link>
  );
}

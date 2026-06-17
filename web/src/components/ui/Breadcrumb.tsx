"use client";

/**
 * Breadcrumb — chemin de navigation hiérarchique.
 *
 * Density Linear : text-[12px] tracking neutre, items espacés par separator.
 * Item courant (dernier) : foreground font-medium, non cliquable.
 * Items précédents : muted-foreground, hover foreground + underline subtle.
 * Truncate gracieux via `…` au milieu (truncateAfter).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  href?: string;
  label: ReactNode;
  icon?: React.ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  separator?: ReactNode;
  truncateAfter?: number;
  className?: string;
}

export function Breadcrumb({ items, separator, truncateAfter, className }: BreadcrumbProps) {
  const sep = separator ?? <ChevronRight size={12} className="text-muted-foreground shrink-0" />;

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
              <span className="text-muted-foreground">…</span>
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
          isLast ? "text-foreground font-medium" : "text-muted-foreground",
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
      className="inline-flex items-center gap-1 min-w-0 text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
    >
      {inner}
    </Link>
  );
}

"use client";

/**
 * Pagination — navigation entre pages d'une liste/table.
 *
 * Doctrine Liquid Glass v2 :
 * - Boutons : First / Prev / [pages] / Next / Last
 * - Pages courantes en mini-card glass tinted sky pour la page active.
 * - Ellipsis entre pages très éloignées de la courante.
 * - Density Linear : h-7 buttons, text-[12px].
 *
 * Algorithme d'affichage des pages :
 * - Toujours montrer la première et la dernière.
 * - Toujours montrer la courante ± 1.
 * - Combler avec "…" si trous.
 *
 * Optionnel : afficher le résumé "X-Y sur Z" à gauche (via `showRange`).
 */

import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";

interface PaginationProps {
  /** Page courante (1-indexed). */
  page: number;
  /** Nombre total d'items. */
  total: number;
  /** Items par page. */
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Affiche le résumé "X-Y sur Z" à gauche. */
  showRange?: boolean;
  /** Nombre de pages voisines visibles autour de la courante. Default 1. */
  siblingCount?: number;
  className?: string;
}

function buildPages(page: number, totalPages: number, siblingCount = 1): Array<number | "ellipsis"> {
  const result: Array<number | "ellipsis"> = [];
  const startPage = Math.max(1, page - siblingCount);
  const endPage = Math.min(totalPages, page + siblingCount);

  if (startPage > 1) {
    result.push(1);
    if (startPage > 2) result.push("ellipsis");
  }
  for (let p = startPage; p <= endPage; p += 1) result.push(p);
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) result.push("ellipsis");
    result.push(totalPages);
  }
  return result;
}

export function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
  showRange = false,
  siblingCount = 1,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pages = buildPages(safePage, totalPages, siblingCount);

  const isFirst = safePage <= 1;
  const isLast = safePage >= totalPages;

  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, safePage * pageSize);

  return (
    <div className={["flex items-center justify-between gap-3", className ?? ""].filter(Boolean).join(" ")}>
      {showRange && (
        <p className="text-[11px] text-gray-500 tabular-nums">
          {total === 0 ? "Aucun résultat" : `${rangeStart}–${rangeEnd} sur ${total}`}
        </p>
      )}
      <div className={["flex items-center gap-1", showRange ? "ml-auto" : ""].filter(Boolean).join(" ")}>
        <ButtonIcon icon={ChevronFirst} label="Première page" variant="ghost" size="sm" disabled={isFirst} onClick={() => onPageChange(1)} />
        <ButtonIcon icon={ChevronLeft} label="Page précédente" variant="ghost" size="sm" disabled={isFirst} onClick={() => onPageChange(safePage - 1)} />
        <ol className="flex items-center gap-0.5 mx-1">
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <li key={`ellipsis-${i}`} className="px-1 text-[12px] text-gray-400 select-none">
                …
              </li>
            ) : (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-current={p === safePage ? "page" : undefined}
                  className={[
                    "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md text-[12px] font-medium tabular-nums transition-all focus-ring",
                    p === safePage
                      ? "bg-sky-50/65 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)]"
                      : "text-gray-600 hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
                  ].join(" ")}
                >
                  {p}
                </button>
              </li>
            )
          )}
        </ol>
        <ButtonIcon icon={ChevronRight} label="Page suivante" variant="ghost" size="sm" disabled={isLast} onClick={() => onPageChange(safePage + 1)} />
        <ButtonIcon icon={ChevronLast} label="Dernière page" variant="ghost" size="sm" disabled={isLast} onClick={() => onPageChange(totalPages)} />
      </div>
    </div>
  );
}

"use client";

/**
 * Pagination — pill glass flottante signature macOS Sonoma.
 *
 * Doctrine Liquid Glass v2 :
 * - Container rounded-full glass-strong + ring inset signature + halo
 *   extérieur diffus (le pill flotte au-dessus du contenu).
 * - Boutons ronds (h-7 w-7) sans border, inline dans le pill.
 * - Page active : bulle blanche pressée — gradient + ring inset spéculaire
 *   + ombre proche (effet "enfoncée dans le verre").
 * - Pages voisines : transparent, hover white/50 + ring inset subtle.
 * - First / Prev / Next / Last : chevrons compacts en début/fin du pill.
 * - Ellipsis stylisée centrée verticalement.
 *
 * showRange : affiche "X–Y sur Z" en dehors du pill (gauche), pour pied
 * de table.
 */

import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast } from "lucide-react";

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  showRange?: boolean;
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

      {/* Pill flottante glass-strong */}
      <div
        className={[
          "inline-flex items-center gap-0.5 rounded-full p-1",
          "bg-gradient-to-b from-white/80 to-white/55 backdrop-blur-[20px] backdrop-saturate-150",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.05),0_2px_6px_-1px_rgba(15,23,42,0.08),0_12px_28px_-8px_rgba(15,23,42,0.18)]",
          showRange ? "ml-auto" : "",
        ].filter(Boolean).join(" ")}
        role="navigation"
        aria-label="Pagination"
      >
        <PillNavButton
          icon={ChevronFirst}
          label="Première page"
          disabled={isFirst}
          onClick={() => onPageChange(1)}
        />
        <PillNavButton
          icon={ChevronLeft}
          label="Page précédente"
          disabled={isFirst}
          onClick={() => onPageChange(safePage - 1)}
        />

        <ol className="flex items-center gap-0.5 mx-0.5">
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <li
                key={`ellipsis-${i}`}
                className="inline-flex items-center justify-center h-7 w-5 text-[12px] text-gray-400 select-none"
                aria-hidden
              >
                …
              </li>
            ) : (
              <li key={p}>
                <PillPageButton
                  page={p}
                  active={p === safePage}
                  onClick={() => onPageChange(p)}
                />
              </li>
            )
          )}
        </ol>

        <PillNavButton
          icon={ChevronRight}
          label="Page suivante"
          disabled={isLast}
          onClick={() => onPageChange(safePage + 1)}
        />
        <PillNavButton
          icon={ChevronLast}
          label="Dernière page"
          disabled={isLast}
          onClick={() => onPageChange(totalPages)}
        />
      </div>
    </div>
  );
}

// ─── Boutons internes ──────────────────────────────────────────────────────

function PillNavButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof ChevronFirst;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        "inline-flex items-center justify-center h-7 w-7 rounded-full text-gray-500 transition-all focus-ring",
        "hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:hover:shadow-none",
      ].join(" ")}
    >
      <Icon size={14} />
    </button>
  );
}

function PillPageButton({ page, active, onClick }: { page: number; active: boolean; onClick: () => void }) {
  if (active) {
    return (
      <button
        type="button"
        aria-current="page"
        className={[
          "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full text-[12px] font-semibold tabular-nums text-gray-950 transition-all focus-ring",
          // Bulle blanche "enfoncée" : gradient blanc + ring inset spéculaire + ombre proche.
          "bg-gradient-to-b from-white to-white/85",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(15,23,42,0.1),0_2px_4px_rgba(15,23,42,0.08)]",
        ].join(" ")}
      >
        {page}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full text-[12px] font-medium tabular-nums text-gray-600 transition-all focus-ring",
        "hover:bg-white/55 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
      ].join(" ")}
    >
      {page}
    </button>
  );
}

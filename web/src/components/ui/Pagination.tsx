"use client";

/**
 * Pagination — row de boutons plats (shadcn-style).
 *
 * - Navigation : First / Prev / Next / Last + pages numérotées + ellipsis.
 * - Page active : bg-primary text-primary-foreground.
 * - Page voisine : bg-card border-border hover:bg-muted.
 * - showRange : affiche "X-Y sur Z" à gauche, pour pied de table.
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
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {total === 0 ? "Aucun résultat" : `${rangeStart}-${rangeEnd} sur ${total}`}
        </p>
      )}

      <div
        className={[
          "inline-flex items-center gap-1",
          showRange ? "ml-auto" : "",
        ].filter(Boolean).join(" ")}
        role="navigation"
        aria-label="Pagination"
      >
        <NavButton
          icon={ChevronFirst}
          label="Première page"
          disabled={isFirst}
          onClick={() => onPageChange(1)}
        />
        <NavButton
          icon={ChevronLeft}
          label="Page précédente"
          disabled={isFirst}
          onClick={() => onPageChange(safePage - 1)}
        />

        <ol className="flex items-center gap-1 mx-0.5">
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <li
                key={`ellipsis-${i}`}
                className="inline-flex items-center justify-center h-7 w-5 text-[12px] text-muted-foreground select-none"
                aria-hidden
              >
                …
              </li>
            ) : (
              <li key={p}>
                <PageButton
                  page={p}
                  active={p === safePage}
                  onClick={() => onPageChange(p)}
                />
              </li>
            )
          )}
        </ol>

        <NavButton
          icon={ChevronRight}
          label="Page suivante"
          disabled={isLast}
          onClick={() => onPageChange(safePage + 1)}
        />
        <NavButton
          icon={ChevronLast}
          label="Dernière page"
          disabled={isLast}
          onClick={() => onPageChange(totalPages)}
        />
      </div>
    </div>
  );
}

function NavButton({
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
        "inline-flex items-center justify-center h-7 w-7 rounded-md bg-card text-muted-foreground border border-border transition-colors focus-ring",
        "hover:bg-muted hover:text-foreground",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-muted-foreground",
      ].join(" ")}
    >
      <Icon size={14} />
    </button>
  );
}

function PageButton({ page, active, onClick }: { page: number; active: boolean; onClick: () => void }) {
  if (active) {
    return (
      <button
        type="button"
        aria-current="page"
        className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md text-[12px] font-semibold tabular-nums bg-primary text-primary-foreground transition-colors focus-ring"
      >
        {page}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md text-[12px] font-medium tabular-nums text-foreground bg-card border border-border hover:bg-muted transition-colors focus-ring"
    >
      {page}
    </button>
  );
}

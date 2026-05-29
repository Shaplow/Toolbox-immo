"use client";

/**
 * Table — table minimaliste density Linear, glass header sticky.
 *
 * Doctrine Liquid Glass v2 :
 * - Wrapper rounded-lg + ring inset signature + overflow hidden.
 * - Header surface-glass-soft sticky avec backdrop-blur.
 * - Rows : hover white/40 backdrop-blur, séparateurs border subtle.
 * - Density : padding-y serré (px-3 py-2.5) + text-[13px].
 *
 * Features :
 * - Sortable : click sur header pour cycle asc → desc → null.
 * - Selectable : checkbox header (toggle all) + checkbox par row.
 * - Empty state : message custom quand rows vide.
 * - Custom cell rendering via `cell?` per column.
 * - sticky header indépendant du parent scroll si `stickyHeader`.
 */

import { useState, useMemo, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "./Checkbox";

type SortDir = "asc" | "desc" | null;

export interface TableColumn<Row> {
  /** Clé d'identification + nom du champ par défaut. */
  id: string;
  /** Texte du header. */
  label: ReactNode;
  /** Sortable ? Default false. */
  sortable?: boolean;
  /** Largeur fixe (CSS value, ex: "120px", "20%"). */
  width?: string;
  /** Alignment text. Default left. */
  align?: "left" | "center" | "right";
  /** Custom cell render. Si absent, on essaye row[id] direct. */
  cell?: (row: Row) => ReactNode;
  /** Custom comparator pour le sort. */
  sortFn?: (a: Row, b: Row) => number;
}

interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  /** Clé unique par row pour key React. Default JSON.stringify (lent). */
  rowKey?: (row: Row) => string;
  /** Active la sélection (checkbox col leading). */
  selectable?: boolean;
  /** Selected row keys (controlled). */
  selectedKeys?: Set<string>;
  /** Callback selection change. */
  onSelectionChange?: (keys: Set<string>) => void;
  /** Message empty state. */
  empty?: ReactNode;
  /** Sticky header au scroll de la table. Default true. */
  stickyHeader?: boolean;
  /** Click sur row (intra-row, hors checkbox). */
  onRowClick?: (row: Row) => void;
  className?: string;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  empty = "Aucune donnée.",
  stickyHeader = true,
  onRowClick,
  className,
}: TableProps<Row>) {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const getKey = rowKey ?? ((r: Row) => JSON.stringify(r));

  // Sort logic.
  const sortedRows = useMemo(() => {
    if (!sortBy || !sortDir) return rows;
    const col = columns.find((c) => c.id === sortBy);
    if (!col) return rows;
    const sorted = [...rows].sort((a, b) => {
      if (col.sortFn) return col.sortFn(a, b);
      const av = (a as Record<string, unknown>)[col.id];
      const bv = (b as Record<string, unknown>)[col.id];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av < bv ? -1 : 1;
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [rows, columns, sortBy, sortDir]);

  function handleSort(colId: string) {
    if (sortBy !== colId) {
      setSortBy(colId);
      setSortDir("asc");
      return;
    }
    // Cycle asc → desc → null.
    setSortDir(sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc");
    if (sortDir === "desc") setSortBy(null);
  }

  const allSelected =
    selectable && selectedKeys && rows.length > 0 && rows.every((r) => selectedKeys.has(getKey(r)));
  const someSelected =
    selectable && selectedKeys && !allSelected && rows.some((r) => selectedKeys.has(getKey(r)));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) onSelectionChange(new Set());
    else onSelectionChange(new Set(rows.map(getKey)));
  }

  function toggleRow(key: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedKeys ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  return (
    <div
      className={[
        "overflow-hidden rounded-lg",
        "bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[10px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.04)]",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className={stickyHeader ? "sticky top-0 z-10" : ""}>
            <tr className="surface-glass-soft border-b border-white/40">
              {selectable && (
                <th className="w-9 px-3 py-2.5 text-left">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onChange={toggleAll}
                    size="sm"
                    label="Tout sélectionner"
                  />
                </th>
              )}
              {columns.map((col) => {
                const isActive = sortBy === col.id;
                const dir = isActive ? sortDir : null;
                const alignCls = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
                return (
                  <th
                    key={col.id}
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-3 py-2.5 ${alignCls} text-[10px] uppercase tracking-widest font-medium text-gray-500`}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.id)}
                        className="inline-flex items-center gap-1 hover:text-gray-950 transition-colors focus-ring rounded-sm"
                      >
                        {col.label}
                        {dir === "asc" ? (
                          <ChevronUp size={11} className="text-gray-950" />
                        ) : dir === "desc" ? (
                          <ChevronDown size={11} className="text-gray-950" />
                        ) : (
                          <ChevronsUpDown size={11} className="opacity-50" />
                        )}
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-3 py-10 text-center text-[12px] text-gray-500"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => {
                const key = getKey(row);
                const isSelected = selectedKeys?.has(key) ?? false;
                const interactive = !!onRowClick;
                return (
                  <tr
                    key={key}
                    onClick={interactive ? () => onRowClick?.(row) : undefined}
                    className={[
                      "transition-colors",
                      i !== 0 ? "border-t border-white/30" : "",
                      isSelected ? "bg-sky-50/45 backdrop-blur-[8px]" : "",
                      interactive ? "cursor-pointer hover:bg-white/50 hover:backdrop-blur-[8px]" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {selectable && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          size="sm"
                          label="Sélectionner"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const alignCls = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
                      const value = col.cell
                        ? col.cell(row)
                        : ((row as Record<string, unknown>)[col.id] as ReactNode);
                      return (
                        <td key={col.id} className={`px-3 py-2.5 ${alignCls} text-gray-800`}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

/**
 * Table — table minimaliste density Linear flat shadcn.
 *
 * - Wrapper rounded-md + border + overflow hidden.
 * - Header bg-muted sticky avec border-bottom.
 * - Rows : hover bg-muted/50, séparateurs border-border subtle.
 * - Density Linear : px-3 py-2.5 + text-[13px].
 *
 * Features : sortable, selectable (checkbox), empty state, custom cells,
 * sticky header, click row callback.
 */

import { useState, useMemo, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "./Checkbox";

type SortDir = "asc" | "desc" | null;

export interface TableColumn<Row> {
  id: string;
  label: ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
  cell?: (row: Row) => ReactNode;
  sortFn?: (a: Row, b: Row) => number;
}

interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey?: (row: Row) => string;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  empty?: ReactNode;
  stickyHeader?: boolean;
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
        "overflow-hidden rounded-md bg-card border border-border",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className={stickyHeader ? "sticky top-0 z-10" : ""}>
            <tr className="bg-muted border-b border-border">
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
                    className={`px-3 py-2.5 ${alignCls} text-[10px] uppercase tracking-widest font-medium text-muted-foreground`}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.id)}
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors focus-ring rounded-sm"
                      >
                        {col.label}
                        {dir === "asc" ? (
                          <ChevronUp size={11} className="text-foreground" />
                        ) : dir === "desc" ? (
                          <ChevronDown size={11} className="text-foreground" />
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
                  className="px-3 py-10 text-center text-[12px] text-muted-foreground"
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
                      i !== 0 ? "border-t border-border" : "",
                      isSelected ? "bg-primary/5" : "",
                      interactive ? "cursor-pointer hover:bg-muted" : "",
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
                        <td key={col.id} className={`px-3 py-2.5 ${alignCls} text-foreground`}>
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

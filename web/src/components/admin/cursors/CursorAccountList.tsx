"use client";

/**
 * CursorAccountList — table des curseurs par compte pour une bibliothèque.
 *
 * Colonnes : Compte · Cursor (Media seulement) · Last setTag · Last catégorie
 *            · Dernière avance · Actions (⬆ ⬇ Reset Jump)
 *
 * Actions :
 * - ⬆ / ⬇  : +1 / -1 sur cursor (Media uniquement).
 * - Reset   : cursor → 0, lastUsedSetTag/Category → null.
 * - Jump to : ouvre CursorAdjustModal.
 */

import { useState } from "react";
import { ArrowUp, ArrowDown, RotateCcw, SlidersHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { CursorAdjustModal, type CursorRow } from "./CursorAdjustModal";

interface Props {
  type: "media" | "data";
  libraryId: string;
  rows: CursorRow[];
  loading: boolean;
  sequenceLength: number;
  onRowsChange: (rows: CursorRow[]) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function CursorAccountList({
  type,
  libraryId,
  rows,
  loading,
  sequenceLength,
  onRowsChange,
}: Props) {
  const [jumpRow, setJumpRow] = useState<CursorRow | null>(null);
  const [mutating, setMutating] = useState<string | null>(null); // accountId en cours

  async function patchCursor(
    accountId: string,
    body: { cursor?: number; lastUsedSetTag?: string | null; lastUsedCategory?: string | null }
  ) {
    setMutating(accountId);
    try {
      const res = await fetch(`/api/admin/cursors/${type}/${libraryId}/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la mise à jour");
        return null;
      }
      const data = (await res.json()) as { cursor: CursorRow };
      return data.cursor;
    } finally {
      setMutating(null);
    }
  }

  function updateRow(accountId: string, updated: CursorRow) {
    onRowsChange(rows.map((r) => (r.accountId === accountId ? updated : r)));
  }

  async function handleIncrement(row: CursorRow) {
    if (type !== "media") return;
    const newCursor = (row.cursor ?? 0) + 1;
    const result = await patchCursor(row.accountId, { cursor: newCursor });
    if (result) {
      updateRow(row.accountId, { ...row, cursor: result.cursor, lastAdvancedAt: result.lastAdvancedAt });
      toast.success(`Curseur → ${result.cursor ?? newCursor}`);
    }
  }

  async function handleDecrement(row: CursorRow) {
    if (type !== "media") return;
    const newCursor = Math.max(0, (row.cursor ?? 0) - 1);
    const result = await patchCursor(row.accountId, { cursor: newCursor });
    if (result) {
      updateRow(row.accountId, { ...row, cursor: result.cursor, lastAdvancedAt: result.lastAdvancedAt });
      toast.success(`Curseur → ${result.cursor ?? newCursor}`);
    }
  }

  async function handleReset(row: CursorRow) {
    const body: { cursor?: number; lastUsedSetTag: null; lastUsedCategory: null } = {
      lastUsedSetTag: null,
      lastUsedCategory: null,
    };
    if (type === "media") body.cursor = 0;
    const result = await patchCursor(row.accountId, body);
    if (result) {
      updateRow(row.accountId, {
        ...row,
        cursor: result.cursor ?? 0,
        lastUsedSetTag: null,
        lastUsedCategory: null,
        lastAdvancedAt: result.lastAdvancedAt,
      });
      toast.success("Curseur réinitialisé");
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aucun curseur"
        description="Cette bibliothèque n'a pas encore de curseur enregistré. Les curseurs sont créés automatiquement à la première génération."
      />
    );
  }

  return (
    <>
      {/* Table wrapper */}
      <div className="overflow-x-auto rounded-xl border border-white/50 bg-white/40 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-gray-100/80">
              <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Compte
              </th>
              {type === "media" && (
                <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Cursor
                </th>
              )}
              <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Last setTag
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Last catégorie
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Dernière avance
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMutating = mutating === row.accountId;
              return (
                <tr
                  key={row.accountId}
                  className="border-b border-gray-100/60 last:border-0 hover:bg-white/30 transition-colors"
                >
                  {/* Compte */}
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                      {row.handle ?? (
                        <span className="text-gray-500 font-normal italic">{row.accountId.slice(0, 12)}…</span>
                      )}
                      {row.isShared && (
                        <Badge size="sm" variant="default">PARTAGÉ</Badge>
                      )}
                    </span>
                  </td>

                  {/* Cursor (Media seulement) */}
                  {type === "media" && (
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[12px] text-gray-700">
                        {row.cursor ?? 0}
                        {sequenceLength > 0 && (
                          <span className="text-gray-400">/{sequenceLength}</span>
                        )}
                      </span>
                    </td>
                  )}

                  {/* Last setTag */}
                  <td className="px-4 py-2.5">
                    {row.lastUsedSetTag ? (
                      <span className="font-mono text-[12px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                        {row.lastUsedSetTag}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Last catégorie */}
                  <td className="px-4 py-2.5">
                    {row.lastUsedCategory ? (
                      <span className="font-mono text-[12px] text-sage-700 bg-sage-50 px-1.5 py-0.5 rounded">
                        {row.lastUsedCategory}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Dernière avance */}
                  <td className="px-4 py-2.5 text-[12px] text-gray-500">
                    {formatDate(row.lastAdvancedAt)}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {type === "media" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={ArrowUp}
                            disabled={isMutating}
                            onClick={() => void handleIncrement(row)}
                            title="+1"
                          >
                            +1
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={ArrowDown}
                            disabled={isMutating || (row.cursor ?? 0) === 0}
                            onClick={() => void handleDecrement(row)}
                            title="-1"
                          >
                            -1
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={RotateCcw}
                        disabled={isMutating}
                        onClick={() => void handleReset(row)}
                        title="Reset curseur"
                      >
                        Reset
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={SlidersHorizontal}
                        disabled={isMutating}
                        onClick={() => setJumpRow(row)}
                        title="Ajustement précis"
                      >
                        Jump to…
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {jumpRow && (
        <CursorAdjustModal
          open={true}
          onClose={() => setJumpRow(null)}
          type={type}
          libraryId={libraryId}
          row={jumpRow}
          sequenceLength={sequenceLength}
          onUpdated={(updated) => {
            updateRow(updated.accountId, updated);
            setJumpRow(null);
          }}
        />
      )}
    </>
  );
}

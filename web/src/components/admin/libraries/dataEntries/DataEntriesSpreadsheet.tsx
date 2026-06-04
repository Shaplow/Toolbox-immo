"use client";

/**
 * DataEntriesSpreadsheet — table dense type Airtable pour éditer les fiches data.
 *
 * Phase 1.x design — remplace DataEntriesGrid (cards) qui ne donnait rien à voir
 * pour des fiches structurées. La spreadsheet rend chaque fiche en row, toutes
 * les colonnes du schéma scrollables horizontalement, édition inline cell-by-cell.
 *
 * Sticky :
 *  - thead `top-0` pendant le scroll vertical
 *  - col 0 (checkbox), col 1 (Set), col 2 (Catégorie) `left-X` pendant scroll horizontal
 *  - dernière col (actions Trash) `right-0`
 *
 * Édition inline :
 *  - Click cell → input `autoFocus`
 *  - blur ou Enter → commit (save optimiste via PATCH avec fields complet mergé)
 *  - Escape → cancel
 *  - Tab/Shift+Tab → comportement natif (focus next button cell — l'utilisateur ré-entre en édition au prochain click)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Globe2 } from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip } from "@/components/ui/Chip";
import { AvatarGroup } from "@/components/ui/Avatar";
import { useConfirm } from "@/components/ui/useConfirm";
import { toast } from "@/components/ui/Toast";
import type { DataEntry, InstagramAccount } from "@/components/admin/libraries/DataEntriesPanel";

export type FieldType = "text" | "number" | "url" | "textarea";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  primary?: boolean;
}

interface Props {
  campaignId: string;
  entries: DataEntry[];
  /** Setter exposé par le panel pour optimistic update + rollback. */
  onEntriesChange: (next: DataEntry[]) => void;
  schema: FieldDef[];
  selectedKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  /** Quand le panel crée une row vide, il bump ce numéro → on focus la cellule Set de la dernière row. */
  focusBottomSignal: number;
  /** Liste des comptes IG du client — sert à résoudre les ids dans accessAccountIds. */
  accounts: InstagramAccount[];
}

// Widths fixes des cols sticky + schema. table-layout: fixed + colgroup garantit
// que le browser respecte ces largeurs (sinon le calcul auto compresse les cols
// sans contenu à 0px et la table ne déborde pas → pas de scroll horizontal).
const WIDTH_CHECKBOX = 44;
const WIDTH_STICKY_CHIP = 140;   // Set & Catégorie
const WIDTH_FIELD = 180;
const WIDTH_ACCESS = 110;        // Avatar group (3 max + "+N") OU icône Global
const WIDTH_ACTIONS = 44;

const OFFSET_CHECKBOX = 0;
const OFFSET_SET = WIDTH_CHECKBOX;
const OFFSET_CATEGORY = WIDTH_CHECKBOX + WIDTH_STICKY_CHIP;
/** Sticky-right offsets (cumulés depuis la droite). */
const RIGHT_ACTIONS = 0;
const RIGHT_ACCESS = WIDTH_ACTIONS;

function safeParse(json: string): Record<string, string> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function DataEntriesSpreadsheet({
  campaignId,
  entries,
  onEntriesChange,
  schema,
  selectedKeys,
  onSelectionChange,
  focusBottomSignal,
  accounts,
}: Props) {
  // Map id → account pour résoudre rapidement les accessAccountIds.
  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Parsing JSON une seule fois par entry (recalculé quand entries change).
  const rows = useMemo(
    () => entries.map((e) => ({ ...e, _fields: safeParse(e.fields) })),
    [entries],
  );

  // Réagit au signal "row ajoutée" → scroll bottom + focus la cellule Set de la dernière row.
  useEffect(() => {
    if (focusBottomSignal === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      requestAnimationFrame(() => {
        const lastRowId = entries[entries.length - 1]?.id;
        if (!lastRowId) return;
        const btn = tableRef.current?.querySelector<HTMLButtonElement>(
          `[data-cell="${lastRowId}::set"]`,
        );
        btn?.click();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBottomSignal]);

  /** Commit value d'une cellule : optimistic update + PATCH avec fields mergés. */
  async function commitCell(
    entryId: string,
    target: "setTag" | "category" | { fieldKey: string },
    newValue: string,
  ) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const oldFields = safeParse(entry.fields);

    // Snapshot pour rollback.
    const snapshot = entries;

    // Build le patch body + le state optimistic.
    let optimisticEntry: DataEntry;
    let patchBody: Record<string, unknown>;

    if (target === "setTag") {
      const trimmed = newValue.trim() || null;
      if (trimmed === entry.setTag) return; // no-op
      optimisticEntry = { ...entry, setTag: trimmed };
      patchBody = { setTag: trimmed };
    } else if (target === "category") {
      const trimmed = newValue.trim() || null;
      if (trimmed === entry.category) return;
      optimisticEntry = { ...entry, category: trimmed };
      patchBody = { category: trimmed };
    } else {
      const oldVal = oldFields[target.fieldKey] ?? "";
      if (newValue === oldVal) return;
      const nextFields = { ...oldFields, [target.fieldKey]: newValue };
      optimisticEntry = { ...entry, fields: JSON.stringify(nextFields) };
      // L'endpoint PATCH attend l'objet fields COMPLET (cf. route.ts:49 qui fait JSON.stringify replace).
      patchBody = { fields: nextFields };
    }

    onEntriesChange(entries.map((e) => (e.id === entryId ? optimisticEntry : e)));

    try {
      const res = await fetch(
        `/api/admin/libraries/data/campaigns/${campaignId}/entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        },
      );
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Erreur lors de la sauvegarde");
        onEntriesChange(snapshot);
      }
    } catch {
      toast.error("Erreur réseau — modification annulée");
      onEntriesChange(snapshot);
    }
  }

  async function handleDelete(entryId: string) {
    const ok = await confirm({
      title: "Supprimer cette fiche ?",
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(
      `/api/admin/libraries/data/campaigns/${campaignId}/entries/${entryId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Erreur lors de la suppression");
      return;
    }
    onEntriesChange(entries.filter((e) => e.id !== entryId));
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedKeys);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  function toggleSelectAll() {
    if (selectedKeys.size === entries.length) onSelectionChange(new Set());
    else onSelectionChange(new Set(entries.map((e) => e.id)));
  }

  const allSelected = entries.length > 0 && selectedKeys.size === entries.length;
  const someSelected = !allSelected && selectedKeys.size > 0;

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] py-10 px-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
        <p className="text-[13px] text-gray-500">
          Aucune fiche — utilise « Nouvelle fiche » ou « Importer CSV/Excel ».
        </p>
        {confirmDialog}
      </div>
    );
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="w-full rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]"
      >
        <table
          ref={tableRef}
          className="text-[12.5px] text-gray-950"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
            // Largeur totale explicite : avec table-layout fixed + colgroup, le browser
            // ne calcule pas automatiquement la somme des col widths quand le parent
            // est en w-full. Sans cette ligne, la table reste collée à la largeur du
            // parent et les colonnes du schéma sont compressées / invisibles.
            width:
              WIDTH_CHECKBOX +
              WIDTH_STICKY_CHIP * 2 +
              WIDTH_FIELD * schema.length +
              WIDTH_ACCESS +
              WIDTH_ACTIONS,
          }}
        >
          {/* colgroup force les largeurs en table-layout: fixed. Sans ça, les colonnes
              sans contenu sont compressées à 0px et la table ne déborde jamais. */}
          <colgroup>
            <col style={{ width: WIDTH_CHECKBOX }} />
            <col style={{ width: WIDTH_STICKY_CHIP }} />
            <col style={{ width: WIDTH_STICKY_CHIP }} />
            {schema.map((f) => (
              <col key={f.key} style={{ width: WIDTH_FIELD }} />
            ))}
            <col style={{ width: WIDTH_ACCESS }} />
            <col style={{ width: WIDTH_ACTIONS }} />
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr>
              <th
                style={{ left: OFFSET_CHECKBOX }}
                className="sticky z-40 bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-r border-gray-200/60 px-2.5 py-2"
              >
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onChange={toggleSelectAll}
                  size="sm"
                  label="Tout sélectionner"
                />
              </th>
              <th
                style={{ left: OFFSET_SET }}
                className="sticky z-40 bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-r border-gray-200/60 px-2.5 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-gray-600"
              >
                Set
              </th>
              <th
                style={{ left: OFFSET_CATEGORY }}
                className="sticky z-40 bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-r border-gray-200/60 px-2.5 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-gray-600"
              >
                Catégorie
              </th>
              {schema.map((f) => (
                <th
                  key={f.key}
                  className="bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-r border-gray-200/60 px-2.5 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-gray-600 truncate"
                  title={f.label}
                >
                  {f.label}
                  {f.required && <span className="text-rose-600 ml-0.5">*</span>}
                </th>
              ))}
              <th
                style={{ right: RIGHT_ACCESS }}
                className="sticky z-40 bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-l border-gray-200/60 px-2.5 py-2 text-left text-[10px] uppercase tracking-widest font-semibold text-gray-600"
                title="Comptes IG ayant accès à cette fiche (vide = accessible à tous)"
              >
                Accès
              </th>
              <th
                style={{ right: RIGHT_ACTIONS }}
                className="sticky z-40 bg-gray-50/95 backdrop-blur-[10px] backdrop-saturate-150 border-b border-l border-gray-200/60 px-2 py-2"
                aria-label="Actions"
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selectedKeys.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={[
                    "group/row transition-colors",
                    isSelected ? "bg-sky-50/45" : "hover:bg-white/55",
                  ].join(" ")}
                >
                  <td
                    style={{ left: OFFSET_CHECKBOX }}
                    className={[
                      "sticky z-20 border-b border-r border-gray-200/40 px-2.5 py-1",
                      isSelected ? "bg-sky-50/95" : "bg-white/90 group-hover/row:bg-white/95",
                    ].join(" ")}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggleSelect(r.id)}
                      size="sm"
                      label="Sélectionner"
                    />
                  </td>
                  <td
                    style={{ left: OFFSET_SET }}
                    className={[
                      "sticky z-20 border-b border-r border-gray-200/40 p-0",
                      isSelected ? "bg-sky-50/95" : "bg-white/90 group-hover/row:bg-white/95",
                    ].join(" ")}
                    data-cell={`${r.id}::set`}
                  >
                    <SpreadsheetCell
                      value={r.setTag ?? ""}
                      placeholder="set"
                      chipVariant="sky"
                      onCommit={(v) => void commitCell(r.id, "setTag", v)}
                    />
                  </td>
                  <td
                    style={{ left: OFFSET_CATEGORY }}
                    className={[
                      "sticky z-20 border-b border-r border-gray-200/40 p-0",
                      isSelected ? "bg-sky-50/95" : "bg-white/90 group-hover/row:bg-white/95",
                    ].join(" ")}
                  >
                    <SpreadsheetCell
                      value={r.category ?? ""}
                      placeholder="catégorie"
                      chipVariant="sage"
                      onCommit={(v) => void commitCell(r.id, "category", v)}
                    />
                  </td>
                  {schema.map((f) => (
                    <td key={f.key} className="border-b border-r border-gray-200/40 p-0">
                      <SpreadsheetCell
                        value={r._fields[f.key] ?? ""}
                        type={f.type}
                        onCommit={(v) => void commitCell(r.id, { fieldKey: f.key }, v)}
                      />
                    </td>
                  ))}
                  <td
                    style={{ right: RIGHT_ACCESS }}
                    className={[
                      "sticky z-20 border-b border-l border-gray-200/40 px-2 py-1",
                      isSelected ? "bg-sky-50/95" : "bg-white/90 group-hover/row:bg-white/95",
                    ].join(" ")}
                  >
                    {r.accessAccountIds.length === 0 ? (
                      <div
                        className="inline-flex items-center gap-1 text-gray-400"
                        title="Accessible à tous les comptes IG"
                      >
                        <Globe2 size={12} />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Global</span>
                      </div>
                    ) : (
                      <div
                        title={r.accessAccountIds
                          .map((id) => {
                            const acc = accountsById.get(id);
                            return acc ? `@${acc.handle}` : id;
                          })
                          .join(" · ")}
                      >
                        <AvatarGroup
                          avatars={r.accessAccountIds.map((id) => {
                            const acc = accountsById.get(id);
                            return { id, name: acc?.name ?? acc?.handle ?? id };
                          })}
                          max={3}
                          size="xs"
                        />
                      </div>
                    )}
                  </td>
                  <td
                    style={{ right: RIGHT_ACTIONS }}
                    className={[
                      "sticky z-20 border-b border-l border-gray-200/40 px-1 py-1 text-center",
                      isSelected ? "bg-sky-50/95" : "bg-white/90 group-hover/row:bg-white/95",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => void handleDelete(r.id)}
                      className="p-1 text-gray-300 hover:text-rose-600 transition-colors rounded opacity-0 group-hover/row:opacity-100"
                      title="Supprimer"
                      aria-label="Supprimer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </>
  );
}

// ─── Cell éditable ──────────────────────────────────────────────────────────

interface CellProps {
  value: string;
  onCommit: (v: string) => void;
  type?: FieldType;
  placeholder?: string;
  /** Si défini, la vue lecture affiche la valeur dans un Chip de cette variant. */
  chipVariant?: "sky" | "sage";
}

function SpreadsheetCell({ value, onCommit, type = "text", placeholder, chipVariant }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(false);

  // Re-sync draft quand la value change de l'extérieur (optimistic update parent).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    if (committed) return; // évite double-commit blur + Enter
    setCommitted(true);
    if (draft !== value) onCommit(draft);
    setEditing(false);
    // Reset committed après un tick pour la prochaine édition.
    setTimeout(() => setCommitted(false), 0);
  }

  function cancel() {
    setCommitted(true);
    setDraft(value);
    setEditing(false);
    setTimeout(() => setCommitted(false), 0);
  }

  if (editing) {
    if (type === "textarea") {
      return (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            // Ctrl/Cmd + Enter = commit pour textarea
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commit();
            }
          }}
          autoFocus
          rows={3}
          className="w-full h-full min-h-[72px] px-2.5 py-1.5 bg-white text-[12.5px] text-gray-950 outline-none ring-2 ring-sky-300/60 resize-none"
        />
      );
    }
    return (
      <input
        type={type === "number" ? "number" : type === "url" ? "url" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        autoFocus
        className="w-full h-9 px-2.5 bg-white text-[12.5px] text-gray-950 outline-none ring-2 ring-sky-300/60"
      />
    );
  }

  const isEmpty = value === "";
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="w-full h-9 px-2.5 text-left text-[12.5px] truncate flex items-center hover:bg-sky-50/40 focus-visible:bg-sky-50/40 outline-none"
      title={value || undefined}
    >
      {isEmpty ? (
        <span className="text-gray-300 italic">{placeholder ?? "—"}</span>
      ) : chipVariant ? (
        <Chip variant={chipVariant} size="sm">
          {value}
        </Chip>
      ) : (
        <span className="text-gray-950 truncate">{value}</span>
      )}
    </button>
  );
}

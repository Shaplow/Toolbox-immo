"use client";

/**
 * DataEntriesViews — vues FlatTable, GroupedView et helper CycleBadge
 * extraits de DataEntriesPanel.
 *
 * Phase F (split DataEntriesPanel 874 LOC). Les 3 sous-composants étaient
 * inline. Extraits pour réduire la masse du composant orchestrateur. La
 * logique de filtering / fetch / state reste dans DataEntriesPanel ; les
 * vues sont des composants purs qui consomment les props et délèguent les
 * actions via callbacks.
 */

import React, { useState } from "react";
import { BarChart2, Check, ChevronDown, ChevronRight, Clock, Globe, Lock, Pencil, Trash2, X } from "lucide-react";
import type { DataEntry, InstagramAccount, SetGroup } from "@/components/admin/libraries/DataEntriesPanel";

function formatDate(d: string | null): string {
  if (!d) return "Jamais";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Cycle badge ──────────────────────────────────────────────────────────────

export function CycleBadge({ entry, usagePolicy, accountFilter }: { entry: DataEntry; usagePolicy: string; accountFilter: string | null }) {
  if (usagePolicy === "unlimited") {
    return <span className="text-xs text-gray-300">—</span>;
  }
  if (usagePolicy === "cycle_per_account" || usagePolicy === "once_per_account") {
    if (!accountFilter) {
      return <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">Par compte</span>;
    }
    // accountFilter active → usageCount comes from DataEntryUsage for this account
    return entry.usageCount > 0
      ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Utilisée</span>
      : <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Disponible</span>;
  }
  // "cycle" | "once_global" → global usedInCycle flag
  return entry.usedInCycle
    ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Utilisée</span>
    : <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Disponible</span>;
}

// ─── Flat table ───────────────────────────────────────────────────────────────

export function FlatTable({
  entries,
  columns,
  accountFilter,
  usagePolicy,
  isAccessible,
  accounts,
  onToggleAccess,
  onEditEntry,
  onDeleteEntry,
}: {
  entries: DataEntry[];
  columns: string[];
  accountFilter: string | null;
  usagePolicy: string;
  isAccessible: (e: DataEntry) => boolean;
  accounts: InstagramAccount[];
  onToggleAccess: (entry: DataEntry, accountId: string, addAccess: boolean) => Promise<void>;
  onEditEntry?: (entryId: string, fields: Record<string, string>, setTag: string | null, category: string | null) => Promise<void>;
  onDeleteEntry?: (entryId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ fields: Record<string, string>; setTag: string; category: string }>({ fields: {}, setTag: "", category: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasSetTag = entries.some((e) => e.setTag);
  const hasCategory = entries.some((e) => e.category);
  const totalCols = columns.length + (hasSetTag ? 1 : 0) + (hasCategory ? 1 : 0) + 5 + 1; // +1 Actions

  const startEdit = (entry: DataEntry) => {
    setSaveError(null);
    setEditingId(entry.id);
    setEditDraft({
      fields: JSON.parse(entry.fields) as Record<string, string>,
      setTag: entry.setTag ?? "",
      category: entry.category ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editingId || !onEditEntry) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onEditEntry(
        editingId,
        editDraft.fields,
        editDraft.setTag.trim() || null,
        editDraft.category.trim() || null,
      );
      setEditingId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    }
    setSaving(false);
  };

  const handleDelete = async (entryId: string) => {
    if (!onDeleteEntry) return;
    if (!confirm("Supprimer cette entrée ? Cette action est irréversible.")) return;
    setDeletingId(entryId);
    try {
      await onDeleteEntry(entryId);
    } catch {
      // entry stays visible on error
    }
    setDeletingId(null);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            {columns.map((col) => (
              <th key={col} className="pb-2 pr-4 font-medium font-mono">{col}</th>
            ))}
            {hasSetTag && <th className="pb-2 pr-4 font-medium">Set</th>}
            {hasCategory && <th className="pb-2 pr-4 font-medium">Catégorie</th>}
            <th className="pb-2 pr-4 font-medium"><span className="flex items-center gap-1"><BarChart2 size={12} /> Usages{accountFilter ? " (compte)" : ""}</span></th>
            <th className="pb-2 pr-4 font-medium"><span className="flex items-center gap-1"><Clock size={12} /> Dernier</span></th>
            <th className="pb-2 font-medium">Cycle</th>
            <th className="pb-2 font-medium">Accès</th>
            <th className="pb-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entries.map((entry) => {
            const fields = JSON.parse(entry.fields) as Record<string, string>;
            const accessible = isAccessible(entry);
            const isUsed = usagePolicy === "cycle" || usagePolicy === "once_global"
              ? entry.usedInCycle
              : (usagePolicy === "cycle_per_account" || usagePolicy === "once_per_account") && !!accountFilter
                ? entry.usageCount > 0
                : false;
            const isEditing = editingId === entry.id;
            return (
              <React.Fragment key={entry.id}>
                <tr className={`hover:bg-gray-50 ${isUsed ? "opacity-60" : ""} ${accountFilter && !accessible ? "opacity-40" : ""} ${isEditing ? "bg-indigo-50/30" : ""}`}>
                  {columns.map((col) => (
                    <td key={col} className="py-2 pr-4 text-gray-700 max-w-[200px] truncate">{fields[col] ?? "—"}</td>
                  ))}
                  {hasSetTag && <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{entry.setTag ?? "—"}</td>}
                  {hasCategory && <td className="py-2 pr-4 text-xs text-gray-500">{entry.category ?? "—"}</td>}
                  <td className="py-2 pr-4 text-gray-500">{entry.usageCount}</td>
                  <td className="py-2 pr-4 text-gray-500">{formatDate(entry.lastUsedAt)}</td>
                  <td className="py-2">
                    <CycleBadge entry={entry} usagePolicy={usagePolicy} accountFilter={accountFilter} />
                  </td>
                  <td className="py-2 max-w-[160px]">
                    <div className="flex items-center gap-1 flex-wrap">
                      {entry.accessAccountIds.length === 0 ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-300"><Globe size={10} /> Global</span>
                      ) : (
                        entry.accessAccountIds.map((id) => {
                          const acc = accounts.find((a) => a.id === id);
                          return acc ? (
                            <button
                              key={id}
                              onClick={() => void onToggleAccess(entry, id, false)}
                              className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                              title={`Retirer l'accès à @${acc.handle}`}
                            >
                              <Lock size={8} />@{acc.handle}<X size={7} />
                            </button>
                          ) : null;
                        })
                      )}
                      {accounts.filter((a) => !entry.accessAccountIds.includes(a.id)).length > 0 && (
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) void onToggleAccess(entry, e.target.value, true); }}
                          className="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 focus:outline-none hover:border-blue-300 hover:text-blue-500 cursor-pointer"
                          title="Restreindre l'accès à un compte"
                        >
                          <option value="">+ compte</option>
                          {accounts.filter((a) => !entry.accessAccountIds.includes(a.id)).map((a) => (
                            <option key={a.id} value={a.id}>@{a.handle}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pl-2">
                    <div className="flex items-center gap-1">
                      {onEditEntry && (
                        <button
                          onClick={() => isEditing ? setEditingId(null) : startEdit(entry)}
                          title={isEditing ? "Annuler" : "Modifier"}
                          className={`p-1 rounded transition-colors ${isEditing ? "text-indigo-500 bg-indigo-50" : "text-gray-300 hover:text-indigo-500 hover:bg-gray-100"}`}
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      {onDeleteEntry && (
                        <button
                          onClick={() => void handleDelete(entry.id)}
                          disabled={deletingId === entry.id}
                          title="Supprimer"
                          className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {isEditing && (
                  <tr>
                    <td colSpan={totalCols} className="p-0">
                      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
                        <div className="flex flex-wrap gap-3 mb-3">
                          {columns.map((col) => (
                            <div key={col} className="flex flex-col gap-0.5 min-w-[120px]">
                              <label className="text-[10px] font-mono text-gray-500">{col}</label>
                              <input
                                value={editDraft.fields[col] ?? ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, fields: { ...d.fields, [col]: e.target.value } }))}
                                className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400 bg-white"
                              />
                            </div>
                          ))}
                          <div className="flex flex-col gap-0.5 min-w-[100px]">
                            <label className="text-[10px] font-mono text-gray-500">set_tag</label>
                            <input
                              value={editDraft.setTag}
                              onChange={(e) => setEditDraft((d) => ({ ...d, setTag: e.target.value }))}
                              placeholder="—"
                              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400 bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-[100px]">
                            <label className="text-[10px] font-mono text-gray-500">category</label>
                            <input
                              value={editDraft.category}
                              onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                              placeholder="—"
                              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400 bg-white"
                            />
                          </div>
                        </div>
                        {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void saveEdit()}
                            disabled={saving}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                          >
                            <Check size={11} /> {saving ? "…" : "Enregistrer"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Grouped view ─────────────────────────────────────────────────────────────

export function GroupedView({
  groups,
  columns,
  accountFilter,
  usagePolicy,
  expandedGroups,
  onToggleGroup,
  isAccessible,
  accounts,
  onToggleAccess,
  onToggleAccessForGroup,
}: {
  groups: SetGroup[];
  columns: string[];
  accountFilter: string | null;
  usagePolicy: string;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  isAccessible: (e: DataEntry) => boolean;
  accounts: InstagramAccount[];
  onToggleAccess: (entry: DataEntry, accountId: string, addAccess: boolean) => Promise<void>;
  onToggleAccessForGroup: (groupEntries: DataEntry[], accountId: string, addAccess: boolean) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      {groups.map((g, i) => {
        const key = `${g.category ?? ""}§§${g.setTag ?? ""}`;
        const isExpanded = expandedGroups.has(key);
        const inaccessible = accountFilter && !g.isAccessible;

        return (
          <div key={key} className={`border rounded-lg overflow-hidden ${inaccessible ? "opacity-50" : ""}`}>
            {/* Group header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100">
              {/* Toggle area */}
              <button
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                onClick={() => onToggleGroup(key)}
              >
                {isExpanded ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                <span className="text-xs font-mono text-gray-400 w-6">#{i + 1}</span>
                {g.setTag && (
                  <span className="text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-100 rounded px-1.5 py-0.5">{g.setTag}</span>
                )}
                {g.category && (
                  <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 rounded px-1.5 py-0.5">{g.category}</span>
                )}
                <span className="text-xs text-gray-500 ml-1">
                  {accountFilter ? g.accessibleCount : g.entries.length} fiche{(accountFilter ? g.accessibleCount : g.entries.length) !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-gray-400 ml-auto mr-3">
                  {g.lastUsedAt ? formatDate(g.lastUsedAt) : "Jamais"}
                </span>
              </button>
              {/* Group-level access management */}
              {(() => {
                const isGroupGlobal = g.entries.every((e) => e.accessAccountIds.length === 0);
                const commonAccountIds = g.entries.length === 0 ? [] :
                  g.entries[0]!.accessAccountIds.filter((id) =>
                    g.entries.every((e) => e.accessAccountIds.includes(id))
                  );
                const accountsNotInAll = accounts.filter((a) => !commonAccountIds.includes(a.id));
                return (
                  <div className="flex items-center gap-1 flex-wrap flex-shrink-0">
                    {isGroupGlobal ? (
                      <>
                        <span className="flex items-center gap-0.5 text-[10px] text-gray-300"><Globe size={9} /> Global</span>
                        {accounts.length > 0 && (
                          <select value="" onChange={(e) => { if (e.target.value) void onToggleAccessForGroup(g.entries, e.target.value, true); }}
                            className="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 hover:border-blue-300 hover:text-blue-500 cursor-pointer focus:outline-none"
                            title="Restreindre tout le set à un compte">
                            <option value="">+ compte</option>
                            {accounts.map((a) => <option key={a.id} value={a.id}>@{a.handle}</option>)}
                          </select>
                        )}
                      </>
                    ) : (
                      <>
                        {commonAccountIds.map((id) => {
                          const acc = accounts.find((a) => a.id === id);
                          return acc ? (
                            <button key={id}
                              onClick={() => void onToggleAccessForGroup(g.entries, id, false)}
                              className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                              title={`Retirer @${acc.handle} de tout le set`}
                            >
                              <Lock size={8} />@{acc.handle}<X size={7} />
                            </button>
                          ) : null;
                        })}
                        {accountsNotInAll.length > 0 && (
                          <select value="" onChange={(e) => { if (e.target.value) void onToggleAccessForGroup(g.entries, e.target.value, true); }}
                            className="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 hover:border-blue-300 hover:text-blue-500 cursor-pointer focus:outline-none"
                            title="Ajouter un compte à tout le set">
                            <option value="">+ compte</option>
                            {accountsNotInAll.map((a) => <option key={a.id} value={a.id}>@{a.handle}</option>)}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Group entries */}
            {isExpanded && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      {columns.map((col) => (
                        <th key={col} className="py-2 px-4 font-medium font-mono">{col}</th>
                      ))}
                      <th className="py-2 px-4 font-medium"><span className="flex items-center gap-1"><BarChart2 size={12} /> Usages</span></th>
                      <th className="py-2 px-4 font-medium"><span className="flex items-center gap-1"><Clock size={12} /> Dernier</span></th>
                      <th className="py-2 px-4 font-medium">Cycle</th>
                      <th className="py-2 px-4 font-medium">Accès</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {g.entries.map((entry) => {
                      const fields = JSON.parse(entry.fields) as Record<string, string>;
                      const accessible = isAccessible(entry);
                      const isUsed = usagePolicy === "cycle" || usagePolicy === "once_global"
                        ? entry.usedInCycle
                        : (usagePolicy === "cycle_per_account" || usagePolicy === "once_per_account") && !!accountFilter
                          ? entry.usageCount > 0
                          : false;
                      return (
                        <tr key={entry.id} className={`hover:bg-gray-50 ${isUsed ? "opacity-60" : ""} ${accountFilter && !accessible ? "opacity-40" : ""}`}>
                          {columns.map((col) => (
                            <td key={col} className="py-2 px-4 text-gray-700 max-w-[200px] truncate">{fields[col] ?? "—"}</td>
                          ))}
                          <td className="py-2 px-4 text-gray-500">{entry.usageCount}</td>
                          <td className="py-2 px-4 text-gray-500">{formatDate(entry.lastUsedAt)}</td>
                          <td className="py-2 px-4">
                            <CycleBadge entry={entry} usagePolicy={usagePolicy} accountFilter={accountFilter} />
                          </td>
                          <td className="py-2 px-4 max-w-[160px]">
                            <div className="flex items-center gap-1 flex-wrap">
                              {entry.accessAccountIds.length === 0 ? (
                                <span className="flex items-center gap-0.5 text-[10px] text-gray-300"><Globe size={10} /> Global</span>
                              ) : (
                                entry.accessAccountIds.map((id) => {
                                  const acc = accounts.find((a) => a.id === id);
                                  return acc ? (
                                    <button
                                      key={id}
                                      onClick={() => void onToggleAccess(entry, id, false)}
                                      className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                                      title={`Retirer l'accès à @${acc.handle}`}
                                    >
                                      <Lock size={8} />@{acc.handle}<X size={7} />
                                    </button>
                                  ) : null;
                                })
                              )}
                              {accounts.filter((a) => !entry.accessAccountIds.includes(a.id)).length > 0 && (
                                <select
                                  value=""
                                  onChange={(e) => { if (e.target.value) void onToggleAccess(entry, e.target.value, true); }}
                                  className="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 focus:outline-none hover:border-blue-300 hover:text-blue-500 cursor-pointer"
                                  title="Restreindre l'accès à un compte"
                                >
                                  <option value="">+ compte</option>
                                  {accounts.filter((a) => !entry.accessAccountIds.includes(a.id)).map((a) => (
                                    <option key={a.id} value={a.id}>@{a.handle}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

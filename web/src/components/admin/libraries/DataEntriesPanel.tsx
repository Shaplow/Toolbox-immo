"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Upload, RotateCcw, BarChart2, Clock, Lock, Globe, ChevronDown, ChevronRight, X, Download, Pencil, Trash2, Check } from "lucide-react";

function downloadCSVFromColumns(columns: string[], campaignName: string) {
  const headers = ["set_tag", "category", ...columns];
  const csv = headers.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modele-${campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface DataEntry {
  id: string;
  fields: string;
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  usedInCycle: boolean;
  createdAt: string;
  accessAccountIds: string[];
}

interface DataCampaign {
  id: string;
  name: string;
  isActive: boolean;
  usagePolicy: string;
  _count: { entries: number };
}

interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
}

interface Props {
  campaignId: string;
  libraryId: string;
}

function formatDate(d: string | null): string {
  if (!d) return "Jamais";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

interface SetGroup {
  setTag: string | null;
  category: string | null;
  entries: DataEntry[];
  isAccessible: boolean;
  accessibleCount: number;
  lastUsedAt: string | null;
}

export function DataEntriesPanel({ campaignId, libraryId }: Props) {
  const [campaign, setCampaign] = useState<DataCampaign | null>(null);
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resettingAccount, setResettingAccount] = useState(false);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAccessible = useCallback((entry: DataEntry) => {
    return entry.accessAccountIds.length === 0 || (accountFilter ? entry.accessAccountIds.includes(accountFilter) : true);
  }, [accountFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entriesUrl = accountFilter
        ? `/api/admin/libraries/data/campaigns/${campaignId}/entries?accountId=${encodeURIComponent(accountFilter)}`
        : `/api/admin/libraries/data/campaigns/${campaignId}/entries`;
      const [camRes, entriesRes] = await Promise.all([
        fetch(`/api/admin/libraries/data/${libraryId}/campaigns`),
        fetch(entriesUrl),
      ]);
      if (!camRes.ok) throw new Error(`campaigns HTTP ${camRes.status}`);
      const campaigns = await camRes.json() as DataCampaign[];
      setCampaign(campaigns.find((c) => c.id === campaignId) ?? null);
      if (entriesRes.ok) {
        const data = await entriesRes.json() as DataEntry[];
        setEntries(data);
      }
    } catch (err) {
      console.error("[DataEntriesPanel] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [campaignId, libraryId, accountFilter]);

  useEffect(() => { void load(); }, [load]);

  // Load accounts for filter selector
  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => r.ok ? r.json() : [])
      .then((data: unknown) => setAccounts(data as InstagramAccount[]))
      .catch(() => {/* ignore */});
  }, []);

  // Group entries by (category, setTag)
  const groups = useMemo<SetGroup[]>(() => {
    const hasAnySets = entries.some((e) => e.setTag !== null);
    if (!hasAnySets) return [];

    const map = new Map<string, DataEntry[]>();
    for (const e of entries) {
      const key = `${e.category ?? ""}§§${e.setTag ?? ""}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }

    return Array.from(map.entries()).map(([, groupEntries]) => {
      const pool = accountFilter
        ? groupEntries.filter(isAccessible)
        : groupEntries;
      const lastUsedAt = pool.reduce<string | null>((max, e) => {
        if (!e.lastUsedAt) return max;
        if (!max) return e.lastUsedAt;
        return e.lastUsedAt > max ? e.lastUsedAt : max;
      }, null);
      const isAcc = !accountFilter || groupEntries.some(isAccessible);
      return {
        setTag: groupEntries[0]!.setTag,
        category: groupEntries[0]!.category,
        entries: groupEntries,
        isAccessible: isAcc,
        accessibleCount: pool.length,
        lastUsedAt,
      };
    }).sort((a, b) => {
      // Accessible first, then by lastUsedAt ASC NULLS FIRST
      if (a.isAccessible !== b.isAccessible) return a.isAccessible ? -1 : 1;
      if (!a.lastUsedAt && !b.lastUsedAt) return 0;
      if (!a.lastUsedAt) return -1;
      if (!b.lastUsedAt) return 1;
      return a.lastUsedAt < b.lastUsedAt ? -1 : 1;
    });
  }, [entries, accountFilter, isAccessible]);

  const hasGroups = groups.length > 0;
  const columns = entries.length > 0 ? Object.keys(JSON.parse(entries[0]!.fields) as Record<string, string>).filter(
    (k) => !["set_tag", "category"].includes(k)
  ) : [];

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/import`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setImportError(d.error ?? "Erreur lors de l'import");
    } else {
      const d = await res.json() as { imported: number };
      setImportSuccess(`${d.imported} entrée${d.imported !== 1 ? "s" : ""} importée${d.imported !== 1 ? "s" : ""} avec succès`);
      void load();
    }
    setImporting(false);
  }

  async function handleReset() {
    if (!confirm("Remettre à zéro le cycle pour toutes les entrées ? Cette opération est irréversible.")) return;
    setResetting(true);
    setResetSuccess(null);
    setResetError(null);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/reset`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
    } else {
      const d = await res.json() as { reset: number };
      setResetSuccess(`${d.reset} entrée${d.reset !== 1 ? "s" : ""} réinitialisée${d.reset !== 1 ? "s" : ""}`);
      setTimeout(() => setResetSuccess(null), 4000);
    }
    setResetting(false);
    void load();
  }
  async function handleResetForAccount() {
    if (!accountFilter) return;
    const accountName = accounts.find((a) => a.id === accountFilter)?.handle ?? accountFilter;
    if (!confirm(`Réinitialiser le cycle pour @${accountName} ? Les usages de ce compte seront effacés.`)) return;
    setResettingAccount(true);
    setResetSuccess(null);
    setResetError(null);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: accountFilter }),
    });
    setResettingAccount(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
    } else {
      const d = await res.json() as { reset: number };
      setResetSuccess(`${d.reset} entrée${d.reset !== 1 ? "s" : ""} réinitialisée${d.reset !== 1 ? "s" : ""} pour @${accountName}`);
      setTimeout(() => setResetSuccess(null), 4000);
      void load();
    }
  }
  async function handleToggleAccess(entry: DataEntry, accountId: string, addAccess: boolean) {
    const next = addAccess
      ? [...entry.accessAccountIds, accountId]
      : entry.accessAccountIds.filter((id) => id !== accountId);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessAccountIds: next }),
    });
    if (!res.ok) return;
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, accessAccountIds: next } : e));
  }

  async function handleSaveEntry(entryId: string, fields: Record<string, string>, setTag: string | null, category: string | null) {
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields, setTag: setTag || null, category: category || null }),
    });
    if (!res.ok) throw new Error("Erreur lors de la sauvegarde");
    setEntries((prev) =>
      prev.map((e) => e.id === entryId ? { ...e, fields: JSON.stringify(fields), setTag: setTag || null, category: category || null } : e)
    );
  }

  async function handleDeleteEntry(entryId: string) {
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${entryId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Erreur lors de la suppression");
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  async function handleToggleAccessForGroup(groupEntries: DataEntry[], accountId: string, addAccess: boolean) {
    const updates = groupEntries.map((entry) => ({
      id: entry.id,
      accessAccountIds: addAccess
        ? entry.accessAccountIds.includes(accountId)
          ? entry.accessAccountIds
          : [...entry.accessAccountIds, accountId]
        : entry.accessAccountIds.filter((id) => id !== accountId),
    }));
    await Promise.all(
      updates.map(({ id, accessAccountIds }) =>
        fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessAccountIds }),
        })
      )
    );
    setEntries((prev) =>
      prev.map((e) => {
        const u = updates.find((x) => x.id === e.id);
        return u ? { ...e, accessAccountIds: u.accessAccountIds } : e;
      })
    );
  }

  const usedCount = entries.filter((e) => e.usedInCycle).length;
  const isPerAccountPolicy = campaign?.usagePolicy === "cycle_per_account" || campaign?.usagePolicy === "once_per_account";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {campaign?.name ?? "Campagne"}
            {campaign?.isActive && <span className="ml-2 text-xs text-green-600 font-normal border border-green-200 rounded px-1.5 py-0.5">Active</span>}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {entries.length} entrée{entries.length !== 1 ? "s" : ""} · {usedCount} utilisée{usedCount !== 1 ? "s" : ""} ce cycle
            {accountFilter && isPerAccountPolicy && (
              <span className="ml-1 text-indigo-500">
                · {entries.filter((e) => e.usageCount > 0).length} utilisée{entries.filter((e) => e.usageCount > 0).length !== 1 ? "s" : ""} par ce compte
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Upload size={14} /> Importer CSV
          </button>
          {columns.length > 0 && (
            <button
              onClick={() => downloadCSVFromColumns(columns, campaign?.name ?? "campagne")}
              className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-md hover:bg-gray-50"
              title="Télécharger le modèle CSV (en-têtes uniquement)"
            >
              <Download size={14} /> Modèle CSV
            </button>
          )}
          {accountFilter && isPerAccountPolicy ? (
            <button
              onClick={() => { void handleResetForAccount(); }}
              disabled={resettingAccount || entries.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 border border-orange-200 text-orange-600 text-sm rounded-md hover:bg-orange-50 disabled:opacity-50"
              title="Réinitialiser le cycle uniquement pour ce compte"
            >
              <RotateCcw size={14} /> Reset ce compte
            </button>
          ) : (
            <button
              onClick={() => { void handleReset(); }}
              disabled={resetting || entries.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-md hover:bg-red-50 disabled:opacity-50"
            >
              <RotateCcw size={14} /> Reset cycle
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={(e) => { void handleImport(e); }} className="hidden" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Account filter */}
        {accounts.length > 0 && (
          <select
            value={accountFilter ?? ""}
            onChange={(e) => setAccountFilter(e.target.value || null)}
            className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-700"
          >
            <option value="">Tous les comptes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} (@{a.handle})</option>
            ))}
          </select>
        )}
        {/* View toggle */}
        {hasGroups && (
          <div className="flex items-center gap-1 border border-gray-200 rounded overflow-hidden text-xs">
            <button
              onClick={() => setViewMode("flat")}
              className={`px-2.5 py-1 ${viewMode === "flat" ? "bg-gray-100 text-gray-800 font-medium" : "text-gray-500 hover:bg-gray-50"}`}
            >
              Liste
            </button>
            <button
              onClick={() => setViewMode("grouped")}
              className={`px-2.5 py-1 ${viewMode === "grouped" ? "bg-gray-100 text-gray-800 font-medium" : "text-gray-500 hover:bg-gray-50"}`}
            >
              Par set
            </button>
          </div>
        )}
      </div>

      {/* Alerts */}
      {importError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{importError}</div>}
      {importSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">{importSuccess}</div>}
      {resetSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">✓ {resetSuccess}</div>}
      {resetError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{resetError}</div>}

      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          <p className="mb-2 font-medium">Aucune entrée.</p>
          <p className="mb-3">Importez un fichier CSV — la première ligne doit contenir les noms des colonnes.</p>
          <p className="text-xs text-gray-400 mb-1">
            Colonnes réservées (exclues des champs) : <code className="bg-gray-100 px-1 rounded">set_tag</code>, <code className="bg-gray-100 px-1 rounded">category</code>
          </p>
          <p className="text-xs text-gray-400">
            Astuce : générez le modèle CSV depuis le builder (onglet Paramètres) pour obtenir automatiquement
            les bons en-têtes depuis le schéma de la template.
          </p>
        </div>
      ) : viewMode === "grouped" && hasGroups ? (
        <GroupedView
          groups={groups}
          columns={columns}
          accountFilter={accountFilter}
          usagePolicy={campaign?.usagePolicy ?? "cycle"}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          isAccessible={isAccessible}
          accounts={accounts}
          onToggleAccess={handleToggleAccess}
          onToggleAccessForGroup={handleToggleAccessForGroup}
        />
      ) : (
        <FlatTable entries={entries} columns={columns} accountFilter={accountFilter} usagePolicy={campaign?.usagePolicy ?? "cycle"} isAccessible={isAccessible} accounts={accounts} onToggleAccess={handleToggleAccess} onEditEntry={handleSaveEntry} onDeleteEntry={handleDeleteEntry} />
      )}
    </div>
  );
}

// ─── Shared: cycle badge ─────────────────────────────────────────────────────

function CycleBadge({ entry, usagePolicy, accountFilter }: { entry: DataEntry; usagePolicy: string; accountFilter: string | null }) {
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

function FlatTable({
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

function GroupedView({
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


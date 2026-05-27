"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Upload, RotateCcw, Download } from "lucide-react";
import { FlatTable, GroupedView } from "@/components/admin/libraries/dataEntries/DataEntriesViews";

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

export interface DataEntry {
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

export interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
}

interface Props {
  campaignId: string;
  libraryId: string;
}

// formatDate déplacé dans DataEntriesViews.tsx (utilisé uniquement par les vues).

export interface SetGroup {
  setTag: string | null;
  category: string | null;
  entries: DataEntry[];
  isAccessible: boolean;
  accessibleCount: number;
  lastUsedAt: string | null;
}

import { useConfirm } from "@/components/ui/useConfirm";

export function DataEntriesPanel({ campaignId, libraryId }: Props) {
  const { confirm, dialog: confirmDialog } = useConfirm();
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
    const ok = await confirm({
      title: "Remettre à zéro le cycle ?",
      description: "Tous les usages seront effacés pour toutes les entrées. Cette opération est irréversible.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: `Réinitialiser le cycle pour @${accountName} ?`,
      description: "Les usages de ce compte seront effacés. Cette opération est irréversible.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;
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
      {confirmDialog}
    </div>
  );
}

// ─── Shared: cycle badge ─────────────────────────────────────────────────────



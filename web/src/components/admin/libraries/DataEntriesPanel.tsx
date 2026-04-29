"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Upload, RotateCcw, BarChart2, Clock } from "lucide-react";

interface DataEntry {
  id: string;
  fields: string;
  usageCount: number;
  lastUsedAt: string | null;
  usedInCycle: boolean;
  createdAt: string;
}

interface DataCampaign {
  id: string;
  name: string;
  isActive: boolean;
  _count: { entries: number };
}

interface Props {
  campaignId: string;
  libraryId: string;
}

function formatDate(d: string | null): string {
  if (!d) return "Jamais";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function DataEntriesPanel({ campaignId, libraryId }: Props) {
  const [campaign, setCampaign] = useState<DataCampaign | null>(null);
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [camRes, entriesRes] = await Promise.all([
        fetch(`/api/admin/libraries/data/${libraryId}/campaigns`),
        fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries`),
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
  }, [campaignId, libraryId]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

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

  // Extraire les colonnes depuis la première entrée
  const columns = entries.length > 0 ? Object.keys(JSON.parse(entries[0].fields) as Record<string, string>) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {campaign?.name ?? "Campagne"}
            {campaign?.isActive && <span className="ml-2 text-xs text-green-600 font-normal border border-green-200 rounded px-1.5 py-0.5">Active</span>}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {entries.length} entrée{entries.length !== 1 ? "s" : ""} · {entries.filter((e) => e.usedInCycle).length} utilisée{entries.filter((e) => e.usedInCycle).length !== 1 ? "s" : ""} ce cycle
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Upload size={14} /> Importer CSV
          </button>
          <button
            onClick={() => { void handleReset(); }}
            disabled={resetting || entries.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-md hover:bg-red-50 disabled:opacity-50"
          >
            <RotateCcw size={14} /> Reset cycle
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          onChange={(e) => { void handleImport(e); }}
          className="hidden"
        />
      </div>

      {importError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{importError}</div>
      )}
      {importSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">{importSuccess}</div>
      )}
      {resetSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">✓ {resetSuccess}</div>
      )}
      {resetError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{resetError}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          <p className="mb-2">Aucune entrée.</p>
          <p>Importez un fichier CSV (première ligne = noms des colonnes).</p>
          <p className="text-xs text-gray-400 mt-2">Exemple RPI : <code>quartier,arrondissement,prix_m2,evo_5ans_pct</code></p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                {columns.map((col) => (
                  <th key={col} className="pb-2 pr-4 font-medium font-mono">{col}</th>
                ))}
                <th className="pb-2 pr-4 font-medium"><span className="flex items-center gap-1"><BarChart2 size={12} /> Usages</span></th>
                <th className="pb-2 pr-4 font-medium"><span className="flex items-center gap-1"><Clock size={12} /> Dernier</span></th>
                <th className="pb-2 font-medium">Cycle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map((entry) => {
                const fields = JSON.parse(entry.fields) as Record<string, string>;
                return (
                  <tr key={entry.id} className={`hover:bg-gray-50 ${entry.usedInCycle ? "opacity-60" : ""}`}>
                    {columns.map((col) => (
                      <td key={col} className="py-2 pr-4 text-gray-700 max-w-[200px] truncate">
                        {fields[col] ?? "—"}
                      </td>
                    ))}
                    <td className="py-2 pr-4 text-gray-500">{entry.usageCount}</td>
                    <td className="py-2 pr-4 text-gray-500">{formatDate(entry.lastUsedAt)}</td>
                    <td className="py-2">
                      {entry.usedInCycle
                        ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Utilisée</span>
                        : <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">Disponible</span>
                      }
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
}

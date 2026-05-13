"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ChevronRight, RotateCcw, Pencil, X, Check } from "lucide-react";
import Link from "next/link";

const USAGE_POLICIES = [
  {
    value: "cycle",
    label: "Cycle global",
    description: "Tour à tour. Une fois tout utilisé, reset manuel pour recommencer.",
  },
  {
    value: "cycle_per_account",
    label: "Cycle par compte",
    description: "Chaque compte tourne indépendamment. Quand tout est utilisé par ce compte, recommence automatiquement.",
  },
  {
    value: "once_per_account",
    label: "1 fois par compte",
    description: "Chaque compte peut utiliser chaque fiche max 1 fois. Rien de plus ensuite.",
  },
  {
    value: "once_global",
    label: "1 fois global",
    description: "Chaque fiche utilisée 1 fois par n'importe quel compte ne sera plus jamais proposée.",
  },
  {
    value: "unlimited",
    label: "Sans limite",
    description: "Toujours la fiche la moins récemment utilisée. Aucun blocage.",
  },
] as const;

interface DataCampaign {
  id: string;
  name: string;
  isActive: boolean;
  cycleResetAt: string | null;
  createdAt: string;
  _count: { entries: number };
  usedInCycleCount: number;
  usagePolicy: string;
}

interface Props {
  libraryId: string;
  libraryName: string;
}

export function DataCampaignsPanel({ libraryId, libraryName }: Props) {
  const [campaigns, setCampaigns] = useState<DataCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", isActive: false, usagePolicy: "cycle" });
  const [error, setError] = useState<string | null>(null);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [editingPolicyValue, setEditingPolicyValue] = useState("cycle");
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/libraries/data/${libraryId}/campaigns`);
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = await res.json() as DataCampaign[];
      setCampaigns(data);
    } catch (err) {
      console.error("[DataCampaignsPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/admin/libraries/data/${libraryId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, isActive: form.isActive, usagePolicy: form.usagePolicy }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Erreur");
      return;
    }
    setCreating(false);
    setForm({ name: "", isActive: false, usagePolicy: "cycle" });
    void load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer la campagne "${name}" et toutes ses entrées ?`)) return;
    const res = await fetch(`/api/admin/libraries/data/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  async function handleToggleActive(campaign: DataCampaign) {
    setPendingToggleId(campaign.id);
    const newActive = !campaign.isActive;
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: newActive }),
    });
    setPendingToggleId(null);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la mise à jour");
      return;
    }
    void load();
  }

  async function handleSavePolicy(campaign: DataCampaign) {
    setPolicySaving(true);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usagePolicy: editingPolicyValue }),
    });
    setPolicySaving(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la mise à jour");
      return;
    }
    setEditingPolicyId(null);
    void load();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Campagnes — {libraryName}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Une seule campagne peut être active à la fois.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
        >
          <Plus size={14} /> Nouvelle campagne
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={(e) => { void handleCreate(e); }} className="mb-6 p-5 border border-indigo-200 rounded-xl bg-indigo-50">
          <p className="text-sm font-semibold text-indigo-800 mb-4">Nouvelle campagne</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ex: RPI Q1 2026"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Politique d&apos;utilisation</label>
              <select
                value={form.usagePolicy}
                onChange={(e) => setForm((f) => ({ ...f, usagePolicy: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {USAGE_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">{USAGE_POLICIES.find((p) => p.value === form.usagePolicy)?.description}</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.isActive ? "bg-indigo-600" : "bg-gray-200"
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                  form.isActive ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
              <label className="text-sm text-gray-700">Activer immédiatement</label>
            </div>
          </div>
          {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Créer</button>
            <button type="button" onClick={() => setCreating(false)} className="px-4 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">Annuler</button>
          </div>
        </form>
      )}

      {/* Error */}
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
          <p className="font-medium">Impossible de charger les campagnes</p>
          <p className="font-mono text-xs mt-1">{loadError}</p>
          <button onClick={() => { void load(); }} className="text-xs underline mt-2">Réessayer</button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <RotateCcw size={32} className="text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">Aucune campagne</p>
          <p className="text-xs text-gray-400 mt-1">Créez-en une et importez vos données.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const pct = c._count.entries > 0
              ? Math.round((c.usedInCycleCount / c._count.entries) * 100)
              : 0;
            return (
              <div
                key={c.id}
                className={`flex flex-col gap-3 p-4 border rounded-xl bg-white transition-colors ${
                  c.isActive ? "border-green-300 shadow-sm" : "border-gray-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Active toggle */}
                  <button
                    onClick={() => { void handleToggleActive(c); }}
                    disabled={pendingToggleId === c.id}
                    title={c.isActive ? "Désactiver" : "Activer"}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                      c.isActive ? "bg-green-500" : "bg-gray-200 hover:bg-gray-300"
                    }`}
                  >
                    {pendingToggleId === c.id ? (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </span>
                    ) : (
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        c.isActive ? "translate-x-4" : "translate-x-0.5"
                      }`} />
                    )}
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                      {c.isActive && (
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {c._count.entries} entrée{c._count.entries !== 1 ? "s" : ""} · {c.usedInCycleCount} utilisée{c.usedInCycleCount !== 1 ? "s" : ""} ce cycle
                      {c.cycleResetAt && ` · Reset : ${new Date(c.cycleResetAt).toLocaleDateString("fr-FR")}`}
                    </p>
                    {editingPolicyId === c.id ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <select
                          autoFocus
                          value={editingPolicyValue}
                          onChange={(e) => setEditingPolicyValue(e.target.value)}
                          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {USAGE_POLICIES.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { void handleSavePolicy(c); }}
                          disabled={policySaving}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <Check size={10} />{policySaving ? "…" : "OK"}
                        </button>
                        <button
                          onClick={() => setEditingPolicyId(null)}
                          className="p-0.5 text-gray-400 hover:text-gray-700"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-0.5">
                        <p
                          className="text-[10px] text-indigo-500"
                          title={USAGE_POLICIES.find((p) => p.value === (c.usagePolicy ?? "cycle"))?.description}
                        >
                          {USAGE_POLICIES.find((p) => p.value === (c.usagePolicy ?? "cycle"))?.label ?? c.usagePolicy}
                        </p>
                        <button
                          onClick={() => { setEditingPolicyId(c.id); setEditingPolicyValue(c.usagePolicy ?? "cycle"); }}
                          className="p-0.5 text-gray-300 hover:text-gray-600 transition-colors"
                          title="Modifier la politique d’utilisation"
                        >
                          <Pencil size={10} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/admin/libraries/data/${libraryId}/${c.id}`}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      Données <ChevronRight size={12} />
                    </Link>
                    <button
                      onClick={() => { void handleDelete(c.id, c.name); }}
                      className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Cycle progress bar */}
                {c._count.entries > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>Progression du cycle</span>
                      <span>{c.usedInCycleCount}&nbsp;/&nbsp;{c._count.entries} ({pct}&nbsp;%)</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 100 ? "bg-green-500" : pct > 0 ? "bg-indigo-500" : "bg-gray-200"
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

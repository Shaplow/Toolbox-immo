"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { CONTENT_TYPES, DAY_LABELS, OFFRES, type OfferScheduleRule } from "@/types/calendar";

export function OfferSchedulePanel() {
  const [rules, setRules] = useState<OfferScheduleRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({
    offre: "ESSENTIEL",
    dayOfWeek: 1,
    publishTime: "19:00",
    contentType: "RPI",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/offer-schedule");
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      setRules(await res.json() as OfferScheduleRule[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/offer-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la création");
      }
      await load();
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(rule: OfferScheduleRule) {
    const res = await fetch(`/api/admin/offer-schedule/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (res.ok) {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r))
      );
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer cette règle ?")) return;
    const res = await fetch(`/api/admin/offer-schedule/${id}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  // Group by offre
  const grouped = OFFRES.reduce<Record<string, OfferScheduleRule[]>>((acc, offre) => {
    acc[offre] = rules.filter((r) => r.offre === offre);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {/* Create form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Ajouter une règle</h2>
        <form onSubmit={(e) => { void handleCreate(e); }} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Offre</label>
            <select
              value={form.offre}
              onChange={(e) => setForm((f) => ({ ...f, offre: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {OFFRES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Jour</label>
            <select
              value={form.dayOfWeek}
              onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {DAY_LABELS.map((d, i) => <option key={i} value={i + 1}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Heure</label>
            <input
              type="time"
              value={form.publishTime}
              onChange={(e) => setForm((f) => ({ ...f, publishTime: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              value={form.contentType}
              onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {CONTENT_TYPES.map((ct) => <option key={ct}>{ct}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
          >
            <Plus size={14} /> {creating ? "Création…" : "Ajouter"}
          </button>
        </form>
        {formError && (
          <p className="mt-2 text-xs text-red-600">{formError}</p>
        )}
      </div>

      {/* Rules grouped by offre */}
      {loading && <p className="text-sm text-gray-400">Chargement…</p>}
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {!loading && OFFRES.map((offre) => (
        <div key={offre} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-800">{offre}</h3>
            <p className="text-xs text-gray-400">{grouped[offre].length} règle(s)</p>
          </div>
          {grouped[offre].length === 0 ? (
            <p className="px-5 py-4 text-xs text-gray-400 italic">Aucune règle configurée.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {grouped[offre]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.publishTime.localeCompare(b.publishTime))
                .map((rule) => (
                  <div key={rule.id} className={`flex items-center gap-4 px-5 py-3 ${!rule.isActive ? "opacity-40" : ""}`}>
                    <span className="w-10 text-sm font-medium text-gray-700">{DAY_LABELS[rule.dayOfWeek - 1]}</span>
                    <span className="w-14 text-sm text-gray-600 tabular-nums">{rule.publishTime}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700">{rule.contentType}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void toggleActive(rule); }}
                        className={`text-${rule.isActive ? "indigo" : "gray"}-400 hover:text-indigo-600`}
                        title={rule.isActive ? "Désactiver" : "Activer"}
                      >
                        {rule.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleDelete(rule.id); }}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

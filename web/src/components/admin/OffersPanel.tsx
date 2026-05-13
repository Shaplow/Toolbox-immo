"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";

interface Offer {
  id: string;
  name: string;
  createdAt: string;
}

export function OffersPanel() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/offers");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      setOffers(await res.json() as Offer[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Erreur lors de la création");
      }
      setNewName("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer l'offre « ${name} » ? Les comptes et règles utilisant cette offre conserveront leur valeur.`)) return;
    const res = await fetch(`/api/admin/offers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setOffers((prev) => prev.filter((o) => o.id !== id));
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;
  if (loadError) return <p className="text-sm text-red-500">{loadError}</p>;

  return (
    <div className="space-y-6">
      {/* Create form */}
      <form onSubmit={(e) => { void handleCreate(e); }} className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l&apos;offre</label>
          <input
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ex: PREMIUM"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {creating ? "Ajout…" : "Ajouter"}
        </button>
      </form>
      {formError && <p className="text-xs text-red-500">{formError}</p>}

      {/* List */}
      {offers.length === 0 ? (
        <p className="text-sm text-gray-500">Aucune offre configurée.</p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {offers.map((offer) => (
            <div key={offer.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-gray-800">{offer.name}</span>
              <button
                onClick={() => void handleDelete(offer.id, offer.name)}
                className="rounded p-1 text-gray-400 hover:text-red-600"
                title="Supprimer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

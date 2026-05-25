"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

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
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
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
      toast.success("Offre créée.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/offers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setOffers((prev) => prev.filter((o) => o.id !== id));
    toast.success("Offre supprimée.");
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;
  if (loadError) return <p className="text-sm text-red-500">{loadError}</p>;

  return (
    <div className="space-y-6">
      {/* Formulaire de création */}
      <form onSubmit={(e) => { void handleCreate(e); }} className="flex items-end gap-3">
        <div className="flex-1">
          <FormField label="Nom de l'offre" required>
            <Input
              value={newName}
              onChange={setNewName}
              placeholder="ex: PREMIUM"
              required
            />
          </FormField>
        </div>
        <Button type="submit" variant="primary" icon={Plus} loading={saving}>
          Ajouter
        </Button>
      </form>

      {/* Liste ou état vide */}
      {offers.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Aucune offre"
          description="Créez votre première offre commerciale."
        />
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {offers.map((offer) => (
            <div key={offer.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-gray-800">{offer.name}</span>
              <DeleteButton
                itemLabel="cette offre"
                description="Les comptes et règles utilisant cette offre conserveront leur valeur."
                onConfirm={() => handleDelete(offer.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

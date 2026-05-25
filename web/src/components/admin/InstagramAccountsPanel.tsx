"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Instagram } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { InstagramAccountRow, type InstagramAccountData } from "./InstagramAccountRow";

interface Offer {
  id: string;
  name: string;
}

export function InstagramAccountsPanel() {
  const [accounts, setAccounts] = useState<InstagramAccountData[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", handle: "", offre: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accountsRes, offersRes] = await Promise.all([
        fetch("/api/admin/accounts"),
        fetch("/api/admin/offers"),
      ]);
      if (!accountsRes.ok) throw new Error(`Erreur serveur (HTTP ${accountsRes.status})`);
      if (!offersRes.ok) throw new Error(`Erreur chargement offres (HTTP ${offersRes.status})`);
      const offersData = await offersRes.json() as Offer[];
      setAccounts(await accountsRes.json() as InstagramAccountData[]);
      setOffers(offersData);
      // Initialise l'offre par défaut sur la première disponible
      setForm((f) => (f.offre ? f : { ...f, offre: offersData[0]?.name ?? "" }));
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
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), handle: form.handle.trim(), offre: form.offre }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Erreur lors de la création");
      }
      setCreating(false);
      setForm({ name: "", handle: "", offre: offers[0]?.name ?? "" });
      toast.success("Compte créé.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;
  if (loadError) return <p className="text-sm text-red-500">{loadError}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Comptes Instagram</h2>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setCreating((v) => !v)}
        >
          Nouveau compte
        </Button>
      </div>

      {creating && (
        <form
          onSubmit={(e) => { void handleCreate(e); }}
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold">Nouveau compte Instagram</h3>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Nom" required>
              <Input
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="Marc"
                required
              />
            </FormField>
            <FormField label="Handle Instagram" required>
              <Input
                value={form.handle}
                onChange={(v) => setForm((f) => ({ ...f, handle: v }))}
                placeholder="@marc_immo"
                required
              />
            </FormField>
            <FormField label="Offre">
              <select
                value={form.offre}
                onChange={(e) => setForm((f) => ({ ...f, offre: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {offers.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            </FormField>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={saving}>
              Créer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          icon={Instagram}
          title="Aucun compte Instagram"
          description="Ajoutez votre premier compte pour commencer."
        />
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {accounts.map((account) => (
            <InstagramAccountRow
              key={account.id}
              account={account}
              offers={offers}
              onUpdated={() => { void load(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

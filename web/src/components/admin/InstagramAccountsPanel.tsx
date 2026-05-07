"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Instagram, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface Cursor {
  libraryId: string;
  cursor: number;
  lastAdvancedAt: string | null;
  library: { id: string; name: string; themeSequence: string };
}

interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
  offre: string;
  createdAt: string;
  _count: { renders: number };
  cursors: Cursor[];
}

const OFFRES = ["ESSENTIEL", "CONFIRME", "CEO"] as const;

export function InstagramAccountsPanel() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", handle: "", offre: "ESSENTIEL" });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      setAccounts(await res.json() as InstagramAccount[]);
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
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name.trim(), handle: form.handle.trim(), offre: form.offre }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setFormError(d.error ?? "Erreur");
      return;
    }
    setCreating(false);
    setForm({ name: "", handle: "", offre: "ESSENTIEL" });
    void load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer le compte « ${name} » ? Ses curseurs seront perdus.`)) return;
    const res = await fetch(`/api/admin/accounts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  async function handleResetCursors(id: string, name: string) {
    if (!confirm(`Remettre tous les curseurs de séquence de « ${name} » à zéro ?`)) return;
    const res = await fetch(`/api/admin/accounts/${id}/cursors/reset`, { method: "POST" });
    if (!res.ok) {
      alert("Erreur lors du reset des curseurs");
      return;
    }
    void load();
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;
  if (loadError) return <p className="text-sm text-red-500">{loadError}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Comptes Instagram</h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Nouveau compte
        </button>
      </div>

      {creating && (
        <form onSubmit={(e) => void handleCreate(e)} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Nouveau compte Instagram</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Nom</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Marc"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Handle Instagram</label>
              <input
                required
                value={form.handle}
                onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
                placeholder="@marc_immo"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Offre</label>
              <select
                value={form.offre}
                onChange={(e) => setForm((f) => ({ ...f, offre: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {OFFRES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Créer
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
              Annuler
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <p className="text-sm text-gray-500">Aucun compte Instagram configuré.</p>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {accounts.map((account) => {
            const isExpanded = expandedId === account.id;
            return (
              <div key={account.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <Instagram className="h-4 w-4 shrink-0 text-pink-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{account.name}</p>
                    <p className="text-xs text-gray-500">@{account.handle} · {account.offre} · {account._count.renders} render{account._count.renders !== 1 ? "s" : ""}</p>
                  </div>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : account.id)}
                    className="rounded p-1 text-gray-400 hover:text-gray-600"
                    title="Voir les curseurs"
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => void handleResetCursors(account.id, account.name)}
                    className="rounded p-1 text-gray-400 hover:text-blue-600"
                    title="Remettre les curseurs à zéro"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void handleDelete(account.id, account.name)}
                    className="rounded p-1 text-gray-400 hover:text-red-600"
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Curseurs de séquence</p>
                    {account.cursors.length === 0 ? (
                      <p className="text-xs text-gray-400">Aucune bibliothèque utilisée avec theme_sequence pour le moment.</p>
                    ) : (
                      <div className="space-y-1">
                        {account.cursors.map((c) => {
                          let themes: string[] = [];
                          try { themes = JSON.parse(c.library.themeSequence) as string[]; } catch { themes = []; }
                          const activeTheme = themes.length > 0 ? themes[c.cursor % themes.length] : "—";
                          return (
                            <div key={c.libraryId} className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs">
                              <span className="font-medium text-gray-700">{c.library.name}</span>
                              <span className="text-gray-400">→</span>
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-blue-700">
                                {activeTheme} ({c.cursor}/{themes.length || "?"})
                              </span>
                              {c.lastAdvancedAt && (
                                <span className="ml-auto text-gray-400">
                                  avancé {new Date(c.lastAdvancedAt).toLocaleDateString("fr-FR")}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
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

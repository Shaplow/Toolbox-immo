"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Database, ChevronRight, Search, Pencil, X, Check } from "lucide-react";
import Link from "next/link";
import { LibraryExportButton } from "./LibraryExportButton";

interface DataLibrary {
  id: string;
  name: string;
  templateType: string;
  description: string | null;
  createdAt: string;
  _count: { campaigns: number };
}

export function DataLibrariesPanel() {
  const [libraries, setLibraries] = useState<DataLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", templateType: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/libraries/data");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = await res.json() as DataLibrary[];
      setLibraries(data);
    } catch (err) {
      console.error("[DataLibrariesPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const filtered = search.trim()
    ? libraries.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()) || l.templateType.toLowerCase().includes(search.toLowerCase()))
    : libraries;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/libraries/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, templateType: form.templateType, description: form.description }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Erreur");
      return;
    }
    setCreating(false);
    setForm({ name: "", templateType: "", description: "" });
    void load();
  }

  function startEdit(lib: DataLibrary) {
    setEditingId(lib.id);
    setEditForm({ name: lib.name, description: lib.description ?? "" });
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm.name.trim()) return;
    setEditSaving(true);
    setEditError(null);
    const res = await fetch(`/api/admin/libraries/data/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editForm.name, description: editForm.description }),
    });
    setEditSaving(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setEditError(d.error ?? "Erreur");
      return;
    }
    setEditingId(null);
    void load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer la bibliothèque « ${name} » et toutes ses données ?`)) return;
    const res = await fetch(`/api/admin/libraries/data/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Bibliothèques de données</h2>
          <p className="text-xs text-gray-500 mt-0.5">{libraries.length} bibliothèque{libraries.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
        >
          <Plus size={14} /> Nouvelle bibliothèque
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={(e) => { void handleCreate(e); }} className="mb-6 p-5 border border-indigo-200 rounded-xl bg-indigo-50">
          <p className="text-sm font-semibold text-indigo-800 mb-4">Nouvelle bibliothèque de données</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ex: Données RPI"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type de template *</label>
              <input
                required
                value={form.templateType}
                onChange={(e) => setForm((f) => ({ ...f, templateType: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ex: RPI, RTIPS, RPOD"
              />
              <p className="text-[11px] text-gray-400 mt-1">Identifiant métier (mis en majuscules automatiquement)</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Description (optionnel)</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
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
          <p className="font-medium">Impossible de charger les bibliothèques</p>
          <p className="font-mono text-xs mt-1">{loadError}</p>
          <button onClick={() => { void load(); }} className="text-xs underline mt-2">Réessayer</button>
        </div>
      )}

      {/* Search */}
      {!loading && libraries.length > 0 && (
        <div className="relative mb-5">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une bibliothèque…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Database size={32} className="text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">Aucune bibliothèque de données</p>
          <p className="text-xs text-gray-400 mt-1">Créez-en une pour importer vos données RPI, RTIPS…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((lib) => (
            <div
              key={lib.id}
              className="group flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              {/* Visual header */}
              <div className="h-20 flex items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50">
                <Database size={32} className="text-violet-300" />
              </div>

              {/* Content */}
              <div className="flex-1 p-4">
                {editingId === lib.id ? (
                  <form onSubmit={(e) => { void handleSaveEdit(e); }} className="space-y-2">
                    <input
                      required
                      autoFocus
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      placeholder="Nom"
                    />
                    <input
                      value={editForm.description}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      placeholder="Description (optionnel)"
                    />
                    {editError && <p className="text-red-600 text-[10px]">{editError}</p>}
                    <div className="flex items-center gap-1 pt-0.5">
                      <button
                        type="submit"
                        disabled={editSaving || !editForm.name.trim()}
                        className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Check size={11} />{editSaving ? "…" : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="flex items-center gap-1 px-2 py-1 border border-gray-200 text-xs rounded hover:bg-gray-50"
                      >
                        <X size={11} /> Annuler
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900 leading-snug">{lib.name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border text-violet-600 bg-violet-50 border-violet-200">
                          {lib.templateType}
                        </span>
                        <button
                          onClick={() => startEdit(lib)}
                          className="p-0.5 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                          title="Modifier"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    </div>

                    {lib.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{lib.description}</p>
                    )}

                    <p className="text-xs text-gray-400 mt-3">
                      {lib._count.campaigns} campagne{lib._count.campaigns !== 1 ? "s" : ""}
                    </p>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center border-t border-gray-100">
                <Link
                  href={`/admin/libraries/data/${lib.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
                >
                  Voir les campagnes <ChevronRight size={13} />
                </Link>
                <div className="w-px h-5 bg-gray-100" />
                <LibraryExportButton libraryId={lib.id} libraryName={lib.name} libraryType="data" />
                <div className="w-px h-5 bg-gray-100" />
                <button
                  onClick={() => { void handleDelete(lib.id, lib.name); }}
                  className="px-3.5 py-2.5 text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-400 py-8">
              Aucune bibliothèque correspondant à &laquo;&nbsp;{search}&nbsp;&raquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
}

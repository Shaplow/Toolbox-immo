"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Database, ChevronRight, Search, Pencil, X, Check } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
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
  const { confirm, dialog: confirmDialog } = useConfirm();
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
    const ok = await confirm({
      title: `Supprimer la bibliothèque « ${name} » ?`,
      description: "Toutes les données associées seront également supprimées. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/data/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
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
        <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
          Nouvelle bibliothèque
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={(e) => { void handleCreate(e); }} className="mb-6 p-5 border border-indigo-200 rounded-xl bg-indigo-50">
          <p className="text-sm font-semibold text-indigo-800 mb-4">Nouvelle bibliothèque de données</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <FormField label="Nom" required>
              <Input
                required
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="Ex: Données RPI"
              />
            </FormField>
            <FormField
              label="Type de template"
              required
              help="Identifiant métier (mis en majuscules automatiquement)"
            >
              <Input
                required
                value={form.templateType}
                onChange={(v) => setForm((f) => ({ ...f, templateType: v }))}
                placeholder="Ex: RPI, RTIPS, RPOD"
              />
            </FormField>
            <div className="col-span-2">
              <FormField label="Description (optionnel)">
                <Input
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                />
              </FormField>
            </div>
          </div>
          {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm">Créer</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Annuler
            </Button>
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
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Rechercher une bibliothèque…"
            className="pl-8"
          />
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : libraries.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Aucune bibliothèque de données"
          description="Créez-en une pour importer vos données RPI, RTIPS…"
          cta={{ label: "Nouvelle bibliothèque", onClick: () => setCreating(true) }}
        />
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
                    <Input
                      required
                      autoFocus
                      value={editForm.name}
                      onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                      placeholder="Nom"
                    />
                    <Input
                      value={editForm.description}
                      onChange={(v) => setEditForm((f) => ({ ...f, description: v }))}
                      placeholder="Description (optionnel)"
                    />
                    {editError && <p className="text-red-600 text-[10px]">{editError}</p>}
                    <div className="flex items-center gap-1 pt-0.5">
                      <Button
                        type="submit"
                        size="sm"
                        icon={Check}
                        loading={editSaving}
                        disabled={!editForm.name.trim()}
                      >
                        Enregistrer
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={X}
                        onClick={() => setEditingId(null)}
                      >
                        Annuler
                      </Button>
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
      {confirmDialog}
    </div>
  );
}

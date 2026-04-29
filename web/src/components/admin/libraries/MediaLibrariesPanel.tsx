"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Trash2, Video, Music2, ChevronRight, Search } from "lucide-react";
import Link from "next/link";

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  tags: string;
  description: string | null;
  createdAt: string;
  _count: { assets: number };
}

export function MediaLibrariesPanel() {
  const [libraries, setLibraries] = useState<MediaLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", type: "video" as "video" | "audio", tags: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "video" | "audio">("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/libraries/media");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = await res.json() as MediaLibrary[];
      setLibraries(data);
    } catch (err) {
      console.error("[MediaLibrariesPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  // All unique types across libraries
  const allTypes = useMemo(() => {
    const set = new Set<string>();
    libraries.forEach((lib) => {
      try { (JSON.parse(lib.tags) as string[]).forEach((t) => set.add(t)); } catch { /* ignore */ }
    });
    return Array.from(set).sort();
  }, [libraries]);

  const [typeLabelsFilter, setTypeLabelsFilter] = useState("");

  const filtered = useMemo(() => {
    return libraries.filter((lib) => {
      if (typeFilter && lib.type !== typeFilter) return false;
      if (search.trim() && !lib.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeLabelsFilter) {
        try {
          const tags = JSON.parse(lib.tags) as string[];
          if (!tags.includes(typeLabelsFilter)) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [libraries, typeFilter, search, typeLabelsFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await fetch("/api/admin/libraries/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, type: form.type, tags, description: form.description }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Erreur");
      return;
    }
    setCreating(false);
    setForm({ name: "", type: "video", tags: "", description: "" });
    void load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Supprimer la bibliothèque « ${name} » et tous ses assets ?`)) return;
    const res = await fetch(`/api/admin/libraries/media/${id}`, { method: "DELETE" });
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
          <h2 className="text-lg font-semibold text-gray-900">Bibliothèques médias</h2>
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
          <p className="text-sm font-semibold text-indigo-800 mb-4">Nouvelle bibliothèque</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ex: Rush RPI Paris"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
              <div className="flex gap-2">
                {(["video", "audio"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-sm transition-colors ${
                      form.type === t
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    }`}
                  >
                    {t === "video" ? <Video size={14} /> : <Music2 size={14} />}
                    {t === "video" ? "Vidéo" : "Audio"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Types (séparés par virgule)</label>
              <input
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="RPI, RTIPS, RPOD"
              />
            </div>
            <div>
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

      {/* Filters */}
      {!loading && libraries.length > 0 && (
        <div className="space-y-3 mb-5">
          {/* Search + type toggle */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une bibliothèque…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="flex gap-1">
              {([["", "Tout"], ["video", "Vidéo"], ["audio", "Audio"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setTypeFilter(val as "" | "video" | "audio")}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    typeFilter === val
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Type pills */}
          {allTypes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">Types&nbsp;:</span>
              {allTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeLabelsFilter(typeLabelsFilter === t ? "" : t)}
                  className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                    typeLabelsFilter === t
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : libraries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-gray-500">Aucune bibliothèque média</p>
          <p className="text-xs text-gray-400 mt-1">Créez-en une pour commencer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((lib) => {
            const tags = (() => { try { return JSON.parse(lib.tags) as string[]; } catch { return []; } })();
            return (
              <div
                key={lib.id}
                className="relative group flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                {/* Visual header */}
                <div className={`h-20 flex items-center justify-center ${
                  lib.type === "video" ? "bg-gradient-to-br from-indigo-50 to-purple-50" : "bg-gradient-to-br from-emerald-50 to-teal-50"
                }`}>
                  {lib.type === "video"
                    ? <Video size={32} className="text-indigo-300" />
                    : <Music2 size={32} className="text-emerald-300" />}
                </div>

                {/* Content */}
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 leading-snug">{lib.name}</p>
                    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                      lib.type === "video"
                        ? "text-indigo-600 bg-indigo-50 border-indigo-200"
                        : "text-emerald-600 bg-emerald-50 border-emerald-200"
                    }`}>
                      {lib.type === "video" ? "Vidéo" : "Audio"}
                    </span>
                  </div>

                  {lib.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{lib.description}</p>
                  )}

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tags.map((tag) => (
                        <span key={tag} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-gray-400 mt-3">
                    {lib._count.assets} fichier{lib._count.assets !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Footer actions */}
                <div className="flex items-center border-t border-gray-100">
                  <Link
                    href={`/admin/libraries/media/${lib.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
                  >
                    Voir les fichiers <ChevronRight size={13} />
                  </Link>
                  <div className="w-px h-5 bg-gray-100" />
                  <button
                    onClick={() => { void handleDelete(lib.id, lib.name); }}
                    className="px-3.5 py-2.5 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-400 py-8">
              Aucune bibliothèque correspondant aux filtres.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

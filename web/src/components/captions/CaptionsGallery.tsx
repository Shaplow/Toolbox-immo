"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Film, Pencil, Trash2, Plus } from "lucide-react";

type Preset = {
  id: string;
  name: string;
  createdAt: string;
};

export function CaptionsGallery({ isAdmin }: { isAdmin: boolean }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/caption-presets");
    if (res.ok) setPresets(await res.json() as Preset[]);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPresets(); }, [fetchPresets]);

  async function handleDelete(id: string) {
    if (!confirm("Supprimer ce preset ?")) return;
    await fetch(`/api/caption-presets/${id}`, { method: "DELETE" });
    await fetchPresets();
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setSavingId(id);
    await fetch(`/api/caption-presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setSavingId(null);
    setEditingId(null);
    await fetchPresets();
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-7 w-32 bg-gray-200 rounded-lg animate-pulse" />
            <div className="h-4 w-16 bg-gray-100 rounded mt-2 animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Captions</h1>
          <p className="text-sm text-gray-500 mt-1">
            {presets.length} preset{presets.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/tools/captions/editor"
            className="flex items-center gap-1.5 text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <Plus size={14} />
            Nouveau preset
          </Link>
        )}
      </div>

      {presets.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <Film size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun preset disponible</p>
          <p className="text-sm mt-1">
            {isAdmin ? "Créez votre premier preset depuis l'éditeur" : "Contactez votre administrateur"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="bg-white border border-gray-100 rounded-xl transition-colors hover:border-gray-200 overflow-hidden group"
            >
              {/* Info */}
              <div className="p-4">
                {editingId === preset.id ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); void handleRename(preset.id); }}
                  >
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-0"
                    />
                    <button
                      type="submit"
                      disabled={savingId === preset.id}
                      className="text-xs px-2 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60 shrink-0"
                    >
                      {savingId === preset.id ? "…" : "OK"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 shrink-0"
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-medium text-gray-900 truncate flex-1 text-sm">{preset.name}</h3>
                    {isAdmin && (
                      <button
                        onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                        className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Renommer"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1.5">
                  {new Date(preset.createdAt).toLocaleDateString("fr-FR")}
                </p>
              </div>

              {/* Actions */}
              <div className="px-4 pb-4 flex gap-2 flex-col">
                <div className="flex gap-2">
                  {isAdmin && (
                    <Link
                      href={`/tools/captions/${preset.id}/edit`}
                      className="flex-1 text-center text-xs bg-gray-900 text-white py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Éditer
                    </Link>
                  )}
                  <Link
                    href={`/tools/captions/${preset.id}/generate`}
                    className="flex-1 text-center text-xs bg-violet-600 text-white py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
                  >
                    Générer
                  </Link>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(preset.id)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 py-1.5 rounded-lg transition-colors"
                  >
                    <Trash2 size={11} />
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

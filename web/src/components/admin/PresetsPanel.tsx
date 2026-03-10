"use client";

import { useState, useCallback, useEffect } from "react";

type Preset = {
  id: string;
  name: string;
  isBuiltin: boolean;
  createdAt: string;
};

export function PresetsPanel() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/caption-presets");
    if (res.ok) setPresets(await res.json() as Preset[]);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPresets(); }, [fetchPresets]);

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setSaving(true);
    await fetch(`/api/caption-presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setSaving(false);
    setEditingId(null);
    await fetchPresets();
  }

  async function handleToggleBuiltin(id: string, current: boolean) {
    await fetch(`/api/caption-presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBuiltin: !current }),
    });
    await fetchPresets();
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer ce preset définitivement ?")) return;
    await fetch(`/api/caption-presets/${id}`, { method: "DELETE" });
    await fetchPresets();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400">
        <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mr-3" />
        Chargement…
      </div>
    );
  }

  const builtins = presets.filter((p) => p.isBuiltin);
  const custom   = presets.filter((p) => !p.isBuiltin);

  return (
    <div className="space-y-6">
      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
        <p className="text-sm text-violet-700 font-medium mb-1">Comment créer un preset ?</p>
        <p className="text-xs text-violet-600">
          Configurez un style dans l&apos;outil{" "}
          <a href="/tools/captions" className="underline font-medium hover:text-violet-800">Captions</a>,
          puis utilisez le panneau <strong>Presets</strong> (en haut à droite) pour le sauvegarder.
          Cochez &quot;Builtin&quot; en dessous pour le rendre visible à tous les utilisateurs assignés.
        </p>
      </div>

      {presets.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-12">Aucun preset pour l&apos;instant.</p>
      ) : (
        <div className="space-y-6">
          {builtins.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Presets intégrés ({builtins.length})
              </h2>
              <PresetList
                presets={builtins}
                editingId={editingId}
                editName={editName}
                saving={saving}
                onStartEdit={(p) => { setEditingId(p.id); setEditName(p.name); }}
                onCancelEdit={() => setEditingId(null)}
                onRename={handleRename}
                onChangeEditName={setEditName}
                onToggleBuiltin={handleToggleBuiltin}
                onDelete={handleDelete}
              />
            </section>
          )}
          {custom.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Presets personnalisés ({custom.length})
              </h2>
              <PresetList
                presets={custom}
                editingId={editingId}
                editName={editName}
                saving={saving}
                onStartEdit={(p) => { setEditingId(p.id); setEditName(p.name); }}
                onCancelEdit={() => setEditingId(null)}
                onRename={handleRename}
                onChangeEditName={setEditName}
                onToggleBuiltin={handleToggleBuiltin}
                onDelete={handleDelete}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface ListProps {
  presets: Preset[];
  editingId: string | null;
  editName: string;
  saving: boolean;
  onStartEdit: (p: Preset) => void;
  onCancelEdit: () => void;
  onRename: (id: string) => Promise<void>;
  onChangeEditName: (v: string) => void;
  onToggleBuiltin: (id: string, current: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function PresetList({
  presets, editingId, editName, saving,
  onStartEdit, onCancelEdit, onRename, onChangeEditName,
  onToggleBuiltin, onDelete,
}: ListProps) {
  return (
    <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
      {presets.map((preset) => (
        <div key={preset.id} className="bg-white px-5 py-3 flex items-center gap-3">
          {/* Builtin toggle */}
          <label className="flex items-center gap-1.5 shrink-0 cursor-pointer" title="Visible par tous (builtin)">
            <input
              type="checkbox"
              checked={preset.isBuiltin}
              onChange={() => onToggleBuiltin(preset.id, preset.isBuiltin)}
              className="accent-violet-600"
            />
            <span className="text-[10px] text-gray-400">builtin</span>
          </label>

          {/* Name / edit */}
          {editingId === preset.id ? (
            <form
              className="flex-1 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); void onRename(preset.id); }}
            >
              <input
                autoFocus
                value={editName}
                onChange={(e) => onChangeEditName(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button type="submit" disabled={saving}
                className="text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60">
                {saving ? "…" : "OK"}
              </button>
              <button type="button" onClick={onCancelEdit}
                className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                ✕
              </button>
            </form>
          ) : (
            <>
              <span className="flex-1 text-sm text-gray-800 font-medium">{preset.name}</span>
              <span className="text-xs text-gray-400">
                {new Date(preset.createdAt).toLocaleDateString("fr-FR")}
              </span>
              <button onClick={() => onStartEdit(preset)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                Renommer
              </button>
              <button onClick={() => onDelete(preset.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-sm ml-1">
                ×
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

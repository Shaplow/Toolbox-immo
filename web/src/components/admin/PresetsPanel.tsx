"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";

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
  const [editBuiltin, setEditBuiltin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    const res = await fetch("/api/caption-presets");
    const data = await res.json() as Preset[];
    setPresets(data);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPresets(); }, [fetchPresets]);

  function openEdit(p: Preset) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditBuiltin(p.isBuiltin);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/caption-presets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), isBuiltin: editBuiltin }),
    });
    const data = await res.json() as { error?: string };
    setSaving(false);
    if (data.error) { setError(data.error); return; }
    setEditingId(null);
    await fetchPresets();
  }

  async function deletePreset(id: string) {
    setSaving(true);
    await fetch(`/api/caption-presets/${id}`, { method: "DELETE" });
    setSaving(false);
    setConfirmDeleteId(null);
    await fetchPresets();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Chargement…</span>
      </div>
    );
  }

  if (presets.length === 0) {
    return <p className="text-sm text-gray-500">Aucun preset de sous-titres pour l&apos;instant.</p>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
      {presets.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
        >
          {editingId === p.id ? (
            <>
              <input
                type="text"
                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(p.id); if (e.key === "Escape") cancelEdit(); }}
                autoFocus
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editBuiltin}
                  onChange={(e) => setEditBuiltin(e.target.checked)}
                  className="accent-indigo-600"
                />
                Builtin
              </label>
              <button
                onClick={() => void saveEdit(p.id)}
                disabled={saving || !editName.trim()}
                className="p-1 rounded hover:bg-green-50 text-green-600 disabled:opacity-40"
                title="Enregistrer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button
                onClick={cancelEdit}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                title="Annuler"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-medium text-gray-800">{p.name}</span>
              {p.isBuiltin && (
                <span className="text-xs bg-indigo-100 text-indigo-700 rounded px-2 py-0.5 font-medium">
                  Builtin
                </span>
              )}
              <button
                onClick={() => openEdit(p)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
                title="Renommer"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {confirmDeleteId === p.id ? (
                <span className="flex items-center gap-1 text-sm text-red-600">
                  Supprimer ?
                  <button
                    onClick={() => void deletePreset(p.id)}
                    disabled={saving}
                    className="ml-1 px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium disabled:opacity-40"
                  >
                    Oui
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium"
                  >
                    Non
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(p.id)}
                  className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

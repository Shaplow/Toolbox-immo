"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Check, X, Subtitles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

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
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/caption-presets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), isBuiltin: editBuiltin }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setEditingId(null);
      toast.success("Preset renommé.");
      await fetchPresets();
    } catch {
      toast.error("Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePreset(id: string) {
    const res = await fetch(`/api/caption-presets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression.");
      return;
    }
    setPresets((prev) => prev.filter((p) => p.id !== id));
    toast.success("Preset supprimé.");
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;

  if (presets.length === 0) {
    return (
      <EmptyState
        icon={Subtitles}
        title="Aucun preset de sous-titres"
        description="Les presets de sous-titres apparaîtront ici."
      />
    );
  }

  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {presets.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-3 px-4 py-3"
        >
          {editingId === p.id ? (
            <>
              <div className="flex-1">
                <Input
                  value={editName}
                  onChange={setEditName}
                  placeholder="Nom du preset"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit(p.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
              </div>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={editBuiltin}
                  onChange={(e) => setEditBuiltin(e.target.checked)}
                  className="accent-indigo-600"
                />
                Builtin
              </label>
              <Button
                variant="secondary"
                size="sm"
                icon={Check}
                loading={saving}
                disabled={!editName.trim()}
                onClick={() => void saveEdit(p.id)}
              >
                Enregistrer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={cancelEdit}
              >
                Annuler
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm font-medium text-gray-800">{p.name}</span>
              {p.isBuiltin && (
                <span className="text-xs bg-indigo-100 text-indigo-700 rounded px-2 py-0.5 font-medium">
                  Builtin
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                onClick={() => openEdit(p)}
                className="text-gray-400 hover:text-gray-700"
                title="Renommer"
              >
                <span className="sr-only">Renommer</span>
              </Button>
              <DeleteButton
                itemLabel="ce preset"
                description="Les vidéos utilisant ce preset conserveront leur rendu."
                onConfirm={() => deletePreset(p.id)}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

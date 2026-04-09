"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";

type PromptRow = {
  id: string;
  name: string;
  prompt: string;
  isActive: boolean;
  createdAt: string;
};

export function DescriptionPromptsPanel({ initialPrompts }: { initialPrompts: PromptRow[] }) {
  const [prompts, setPrompts] = useState<PromptRow[]>(initialPrompts);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state (shared for create or edit)
  const [formName, setFormName] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormPrompt("");
    setError(null);
    setCreating(true);
  };

  const openEdit = (p: PromptRow) => {
    setCreating(false);
    setFormName(p.name);
    setFormPrompt(p.prompt);
    setError(null);
    setEditingId(p.id);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      setError("Nom et prompt requis");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      if (creating) {
        const res = await fetch("/api/description/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as PromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        setPrompts((prev) => [...prev, data]);
        setCreating(false);
      } else if (editingId) {
        const res = await fetch(`/api/description/prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as PromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        setPrompts((prev) => prev.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce prompt ? Les descriptions générées avec ce prompt garderont leur snapshot.")) return;
    const res = await fetch(`/api/description/prompts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPrompts((prev) => prev.filter((p) => p.id !== id));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {prompts.length} prompt{prompts.length !== 1 ? "s" : ""} configuré{prompts.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus size={13} /> Nouveau prompt
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <PromptForm
          name={formName}
          prompt={formPrompt}
          error={error}
          saving={saving}
          onName={setFormName}
          onPrompt={setFormPrompt}
          onSave={() => void handleSave()}
          onCancel={cancelForm}
          label="Créer"
        />
      )}

      {/* List */}
      <div className="space-y-2">
        {prompts.length === 0 && !creating && (
          <p className="text-sm text-gray-400 text-center py-8">
            Aucun prompt. Créez-en un pour commencer.
          </p>
        )}
        {prompts.map((p) => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-4">
                <PromptForm
                  name={formName}
                  prompt={formPrompt}
                  error={error}
                  saving={saving}
                  onName={setFormName}
                  onPrompt={setFormPrompt}
                  onSave={() => void handleSave()}
                  onCancel={cancelForm}
                  label="Enregistrer"
                />
              </div>
            ) : (
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5 whitespace-pre-line line-clamp-3">
                    {p.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-indigo-50"
                    title="Modifier"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => void handleDelete(p.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                    title="Supprimer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PromptForm ─────────────────────────────────────────────────────────────────

function PromptForm({
  name,
  prompt,
  error,
  saving,
  onName,
  onPrompt,
  onSave,
  onCancel,
  label,
}: {
  name: string;
  prompt: string;
  error: string | null;
  saving: boolean;
  onName: (v: string) => void;
  onPrompt: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Nom</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Ex: Annonce immobilière courte"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Instructions</label>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={"Tu es un expert en immobilier. À partir de la transcription ci-dessous, rédige une annonce immobilière professionnelle et attractive. Mets en valeur les points forts du bien.\n\nFormat: paragraphes courts, ton professionnel et chaleureux."}
          rows={6}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
        />
      </div>
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {label}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          <X size={12} /> Annuler
        </button>
      </div>
    </div>
  );
}

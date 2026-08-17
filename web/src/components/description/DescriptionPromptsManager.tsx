"use client";

/**
 * DescriptionPromptsManager — CRUD des prompts de description.
 *
 * Phase F (Vague 4 polish) du split de DescriptionTool. Le bloc
 * PromptsManager + PromptInlineForm étaient inline (~200 LOC) dans
 * DescriptionTool. Extraits ici pour réduire la masse du composant
 * orchestrateur.
 *
 * PromptsManager gère son propre state local (form values, editing id).
 * Les changements sont propagés via le callback onPromptsChange.
 */

import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/ui/useConfirm";
import type { DescriptionPromptRow } from "./DescriptionTool";

export function DescriptionPromptsManager({
  prompts,
  onPromptsChange,
}: {
  prompts: DescriptionPromptRow[];
  onPromptsChange: (updated: DescriptionPromptRow[]) => void;
}) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const openEdit = (p: DescriptionPromptRow) => {
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
        const data = await res.json() as DescriptionPromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        onPromptsChange([...prompts, data]);
        setCreating(false);
      } else if (editingId) {
        const res = await fetch(`/api/description/prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as DescriptionPromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        onPromptsChange(prompts.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Supprimer ce prompt ?",
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/description/prompts/${id}`, { method: "DELETE" });
    if (res.ok) onPromptsChange(prompts.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-3">
      {/* New prompt button */}
      {!creating && (
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info-600 text-white text-xs font-medium hover:bg-info-700 transition-colors"
        >
          <Plus size={13} /> Nouveau prompt
        </button>
      )}

      {/* Create form */}
      {creating && (
        <PromptInlineForm
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
      {prompts.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground text-center py-6">Aucun prompt. Créez-en un pour commencer.</p>
      )}
      <div className="space-y-2">
        {prompts.map((p) => (
          <div key={p.id} className="border border-gray-100 rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-3">
                <PromptInlineForm
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
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-line">{p.prompt}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-muted-foreground hover:text-info-600 rounded-lg hover:bg-info-50 transition-colors"
                    title="Modifier"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => void handleDelete(p.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
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
      {confirmDialog}
    </div>
  );
}

/**
 * PromptInlineForm — form interne pour création/édition d'un prompt.
 * Inline avec PromptsManager car ce dernier est son unique consumer.
 */
function PromptInlineForm({
  name, prompt, error, saving, onName, onPrompt, onSave, onCancel, label,
}: {
  name: string; prompt: string; error: string | null; saving: boolean;
  onName: (v: string) => void; onPrompt: (v: string) => void;
  onSave: () => void; onCancel: () => void; label: string;
}) {
  return (
    <div className="bg-info-50/60 border border-info-100 rounded-xl p-4 space-y-3">
      <div>
        <label className="text-xs font-medium text-foreground block mb-1">Nom</label>
        <input
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Ex: Annonce immobilière courte"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-info-200 focus:border-transparent"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-foreground block mb-1">Instructions</label>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder="Tu es un expert en immobilier. À partir de la transcription, rédige une annonce professionnelle…"
          rows={5}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-info-200 focus:border-transparent"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info-600 text-white text-xs font-medium hover:bg-info-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {label}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-muted-foreground text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          <X size={12} /> Annuler
        </button>
      </div>
    </div>
  );
}

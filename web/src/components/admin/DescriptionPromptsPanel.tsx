"use client";

import { useState } from "react";
import { Check, MessageSquare, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

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

  const openCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormPrompt("");
    setCreating(true);
  };

  const openEdit = (p: PromptRow) => {
    setCreating(false);
    setFormName(p.name);
    setFormPrompt(p.prompt);
    setEditingId(p.id);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      toast.error("Nom et prompt requis");
      return;
    }
    setSaving(true);

    try {
      if (creating) {
        const res = await fetch("/api/description/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as PromptRow & { error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erreur lors de la création"); return; }
        setPrompts((prev) => [...prev, data]);
        setCreating(false);
        toast.success("Prompt créé.");
      } else if (editingId) {
        const res = await fetch(`/api/description/prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), prompt: formPrompt.trim() }),
        });
        const data = await res.json() as PromptRow & { error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erreur lors de la mise à jour"); return; }
        setPrompts((prev) => prev.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
        toast.success("Prompt mis à jour.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/description/prompts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPrompts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Prompt supprimé.");
    } else {
      toast.error("Erreur lors de la suppression");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {prompts.length} prompt{prompts.length !== 1 ? "s" : ""} configuré{prompts.length !== 1 ? "s" : ""}
        </p>
        <Button variant="primary" size="sm" icon={MessageSquare} onClick={openCreate}>
          Nouveau prompt
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <PromptForm
          name={formName}
          prompt={formPrompt}
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
          <EmptyState
            icon={MessageSquare}
            title="Aucun prompt"
            description="Créez votre premier prompt pour générer des descriptions immobilières."
            cta={{ label: "Nouveau prompt", onClick: openCreate }}
          />
        )}
        {prompts.map((p) => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-4">
                <PromptForm
                  name={formName}
                  prompt={formPrompt}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    onClick={() => openEdit(p)}
                    title="Modifier"
                  >
                    <span className="sr-only">Modifier</span>
                  </Button>
                  <DeleteButton
                    itemLabel="ce prompt"
                    description="Les descriptions générées avec ce prompt garderont leur snapshot."
                    onConfirm={() => handleDelete(p.id)}
                  />
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
  saving,
  onName,
  onPrompt,
  onSave,
  onCancel,
  label,
}: {
  name: string;
  prompt: string;
  saving: boolean;
  onName: (v: string) => void;
  onPrompt: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 space-y-3">
      <FormField label="Nom" required>
        <Input
          value={name}
          onChange={onName}
          placeholder="Ex: Annonce immobilière courte"
          autoFocus
        />
      </FormField>
      <FormField label="Instructions" required>
        <Textarea
          value={prompt}
          onChange={onPrompt}
          placeholder={"Tu es un expert en immobilier. À partir de la transcription ci-dessous, rédige une annonce immobilière professionnelle et attractive. Mets en valeur les points forts du bien.\n\nFormat: paragraphes courts, ton professionnel et chaleureux."}
          rows={6}
        />
      </FormField>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" icon={Check} loading={saving} onClick={onSave}>
          {label}
        </Button>
        <Button variant="secondary" size="sm" icon={X} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

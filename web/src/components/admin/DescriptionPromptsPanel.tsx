"use client";

import { useState } from "react";
import { Check, MessageSquare, Pencil, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

type RecipeKind =
  | "transcript_only"
  | "transcript_and_frame"
  | "transcript_multi_frame"
  | "two_pass_reformulate"
  | "context_enriched";

const RECIPE_LABELS: Record<RecipeKind, string> = {
  transcript_only: "Transcription seule (défaut)",
  transcript_and_frame: "Transcription + 1 image",
  transcript_multi_frame: "Transcription + N frames",
  two_pass_reformulate: "Deux passes (résumé puis rédaction)",
  context_enriched: "Contexte enrichi (slot fields)",
};

const RECIPE_HINTS: Record<RecipeKind, string> = {
  transcript_only: "Comportement historique : 1 appel LLM avec le transcript.",
  transcript_and_frame: "Ajoute 1 frame de référence (rush/cover) au prompt.",
  transcript_multi_frame: "Ajoute jusqu'à N frames (par défaut 4, max 6).",
  two_pass_reformulate: "Étape 1 : résumé en bullets. Étape 2 : rédaction depuis le résumé.",
  context_enriched: "Injecte les champs du slot (adresse, prix…) — peut fonctionner sans transcript.",
};

type PromptRow = {
  id: string;
  name: string;
  prompt: string;
  isActive: boolean;
  createdAt: string;
  recipeKind?: RecipeKind;
  recipeConfig?: { frameCount?: number; contextFieldKeys?: string[] } | null;
};

export function DescriptionPromptsPanel({ initialPrompts }: { initialPrompts: PromptRow[] }) {
  const [prompts, setPrompts] = useState<PromptRow[]>(initialPrompts);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state (shared for create or edit)
  const [formName, setFormName] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formRecipeKind, setFormRecipeKind] = useState<RecipeKind>("transcript_only");
  const [formFrameCount, setFormFrameCount] = useState<number>(4);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormPrompt("");
    setFormRecipeKind("transcript_only");
    setFormFrameCount(4);
    setCreating(true);
  };

  const openEdit = (p: PromptRow) => {
    setCreating(false);
    setFormName(p.name);
    setFormPrompt(p.prompt);
    setFormRecipeKind(p.recipeKind ?? "transcript_only");
    setFormFrameCount(p.recipeConfig?.frameCount ?? 4);
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

    const recipeConfig =
      formRecipeKind === "transcript_multi_frame" ? { frameCount: formFrameCount } : null;

    try {
      if (creating) {
        const res = await fetch("/api/description/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            prompt: formPrompt.trim(),
            recipeKind: formRecipeKind,
            recipeConfig,
          }),
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
          body: JSON.stringify({
            name: formName.trim(),
            prompt: formPrompt.trim(),
            recipeKind: formRecipeKind,
            recipeConfig,
          }),
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

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const toggleActive = async (p: PromptRow) => {
    if (togglingId) return; // déjà une requête en vol — ignore le double-clic
    const nextActive = !p.isActive;
    setTogglingId(p.id);
    try {
      const res = await fetch(`/api/description/prompts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        toast.error("Erreur lors de la mise à jour");
        return;
      }
      const data = (await res.json()) as PromptRow;
      setPrompts((prev) => prev.map((row) => (row.id === p.id ? data : row)));
      toast.success(nextActive ? "Prompt activé." : "Prompt désactivé.");
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = prompts.filter((p) => p.isActive).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {prompts.length} prompt{prompts.length !== 1 ? "s" : ""} configuré{prompts.length !== 1 ? "s" : ""}
          {prompts.length > 0 && (
            <span className="ml-1 text-gray-400">
              · {activeCount} actif{activeCount !== 1 ? "s" : ""}
            </span>
          )}
        </p>
        <Button variant="primary" size="sm" icon={MessageSquare} onClick={openCreate}>
          Nouveau prompt
        </Button>
      </div>

      {prompts.length > 0 && activeCount === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Aucun prompt n&apos;est actif — ils n&apos;apparaîtront pas dans la modal IA des fiches publication.
          Active au moins un prompt avec l&apos;icône <Eye size={11} className="inline -mt-0.5" />.
        </div>
      )}

      {/* Create form */}
      {creating && (
        <PromptForm
          name={formName}
          prompt={formPrompt}
          recipeKind={formRecipeKind}
          frameCount={formFrameCount}
          saving={saving}
          onName={setFormName}
          onPrompt={setFormPrompt}
          onRecipeKind={setFormRecipeKind}
          onFrameCount={setFormFrameCount}
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
                  recipeKind={formRecipeKind}
                  frameCount={formFrameCount}
                  saving={saving}
                  onName={setFormName}
                  onPrompt={setFormPrompt}
                  onRecipeKind={setFormRecipeKind}
                  onFrameCount={setFormFrameCount}
                  onSave={() => void handleSave()}
                  onCancel={cancelForm}
                  label="Enregistrer"
                />
              </div>
            ) : (
              <div className={`px-4 py-3 flex items-start gap-3 ${p.isActive ? "" : "opacity-60 bg-gray-50/50"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{p.name}</p>
                    {!p.isActive && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 border border-gray-300">
                        Inactif
                      </span>
                    )}
                    {p.recipeKind && p.recipeKind !== "transcript_only" && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                        {RECIPE_LABELS[p.recipeKind]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 whitespace-pre-line line-clamp-3">
                    {p.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={p.isActive ? Eye : EyeOff}
                    onClick={() => void toggleActive(p)}
                    disabled={togglingId === p.id}
                    title={p.isActive ? "Désactiver (masquer dans les pickers)" : "Activer (rendre dispo dans les pickers)"}
                  >
                    <span className="sr-only">{p.isActive ? "Désactiver" : "Activer"}</span>
                  </Button>
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
  recipeKind,
  frameCount,
  saving,
  onName,
  onPrompt,
  onRecipeKind,
  onFrameCount,
  onSave,
  onCancel,
  label,
}: {
  name: string;
  prompt: string;
  recipeKind: RecipeKind;
  frameCount: number;
  saving: boolean;
  onName: (v: string) => void;
  onPrompt: (v: string) => void;
  onRecipeKind: (v: RecipeKind) => void;
  onFrameCount: (v: number) => void;
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
      <FormField label="Recette d'exécution" help={RECIPE_HINTS[recipeKind]}>
        <select
          value={recipeKind}
          onChange={(e) => onRecipeKind(e.target.value as RecipeKind)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
        >
          {(Object.keys(RECIPE_LABELS) as RecipeKind[]).map((k) => (
            <option key={k} value={k}>{RECIPE_LABELS[k]}</option>
          ))}
        </select>
      </FormField>
      {recipeKind === "transcript_multi_frame" && (
        <FormField label="Nombre de frames (1-6)">
          <Input
            type="number"
            value={String(frameCount)}
            onChange={(v) => onFrameCount(Math.min(6, Math.max(1, parseInt(v, 10) || 1)))}
          />
        </FormField>
      )}
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

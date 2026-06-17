"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, Sparkles, X } from "lucide-react";
import {
  DEFAULT_CAPTION_AUTO_HIGHLIGHT,
  type AutoHighlightMode,
  type AutoHighlightPlacement,
  type CaptionPromptRow,
} from "@/lib/captionPrompt";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

function formatAutoHighlightModeLabel(mode: AutoHighlightMode): string {
  if (mode === "highlight1") return "Highlight 1";
  if (mode === "highlight2") return "Highlight 2";
  return "Highlight 1 + Highlight 2";
}

// ── CaptionPromptsPanel ────────────────────────────────────────────────────────

export function CaptionPromptsPanel({
  initialPrompts,
}: {
  initialPrompts: CaptionPromptRow[];
}) {
  const [prompts, setPrompts] = useState<CaptionPromptRow[]>(initialPrompts);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Shared form state
  const [formName, setFormName] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formAhEnabled, setFormAhEnabled] = useState(DEFAULT_CAPTION_AUTO_HIGHLIGHT.enabled);
  const [formAhMode, setFormAhMode] = useState<AutoHighlightMode>(DEFAULT_CAPTION_AUTO_HIGHLIGHT.mode);
  const [formAhPlacement, setFormAhPlacement] = useState<AutoHighlightPlacement>(DEFAULT_CAPTION_AUTO_HIGHLIGHT.placement);
  const [formAhPrompt, setFormAhPrompt] = useState(DEFAULT_CAPTION_AUTO_HIGHLIGHT.prompt);

  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setFormName("");
    setFormPrompt("");
    setFormAhEnabled(DEFAULT_CAPTION_AUTO_HIGHLIGHT.enabled);
    setFormAhMode(DEFAULT_CAPTION_AUTO_HIGHLIGHT.mode);
    setFormAhPlacement(DEFAULT_CAPTION_AUTO_HIGHLIGHT.placement);
    setFormAhPrompt(DEFAULT_CAPTION_AUTO_HIGHLIGHT.prompt);
  };

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setCreating(true);
  };

  const openEdit = (p: CaptionPromptRow) => {
    setCreating(false);
    setFormName(p.name);
    setFormPrompt(p.prompt);
    setFormAhEnabled(p.autoHighlight.enabled);
    setFormAhMode(p.autoHighlight.mode);
    setFormAhPlacement(p.autoHighlight.placement);
    setFormAhPrompt(p.autoHighlight.prompt);
    setEditingId(p.id);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    resetForm();
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      toast.error("Nom et prompt requis");
      return;
    }
    setSaving(true);

    const payload = {
      name: formName.trim(),
      prompt: formPrompt.trim(),
      autoHighlight: {
        enabled: formAhEnabled,
        mode: formAhMode,
        placement: formAhPlacement,
        prompt: formAhPrompt.trim(),
      },
    };

    try {
      if (creating) {
        const res = await fetch("/api/caption-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as CaptionPromptRow & { error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erreur lors de la création"); return; }
        setPrompts((prev) => [...prev, data]);
        setCreating(false);
        resetForm();
        toast.success("Prompt créé.");
      } else if (editingId) {
        const res = await fetch(`/api/caption-prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as CaptionPromptRow & { error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erreur lors de la mise à jour"); return; }
        setPrompts((prev) => prev.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
        resetForm();
        toast.success("Prompt mis à jour.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/caption-prompts/${id}`, { method: "DELETE" });
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
        <p className="text-sm text-muted-foreground">
          {prompts.length} prompt{prompts.length !== 1 ? "s" : ""} configuré{prompts.length !== 1 ? "s" : ""}
        </p>
        <Button variant="primary" size="sm" icon={Sparkles} onClick={openCreate}>
          Nouveau prompt
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <CaptionPromptForm
          name={formName}
          prompt={formPrompt}
          ahEnabled={formAhEnabled}
          ahMode={formAhMode}
          ahPlacement={formAhPlacement}
          ahPrompt={formAhPrompt}
          saving={saving}
          onName={setFormName}
          onPrompt={setFormPrompt}
          onAhEnabled={setFormAhEnabled}
          onAhMode={setFormAhMode}
          onAhPlacement={setFormAhPlacement}
          onAhPrompt={setFormAhPrompt}
          onSave={() => void handleSave()}
          onCancel={cancelForm}
          label="Créer"
        />
      )}

      {/* List */}
      <div className="space-y-2">
        {prompts.length === 0 && !creating && (
          <EmptyState
            icon={Sparkles}
            title="Aucun prompt"
            description="Créez votre premier prompt pour le rendre disponible dans l'outil sous-titres."
            cta={{ label: "Nouveau prompt", onClick: openCreate }}
          />
        )}
        {prompts.map((p) => (
          <div key={p.id} className="bg-white border border-border rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-5">
                <CaptionPromptForm
                  name={formName}
                  prompt={formPrompt}
                  ahEnabled={formAhEnabled}
                  ahMode={formAhMode}
                  ahPlacement={formAhPlacement}
                  ahPrompt={formAhPrompt}
                  saving={saving}
                  onName={setFormName}
                  onPrompt={setFormPrompt}
                  onAhEnabled={setFormAhEnabled}
                  onAhMode={setFormAhMode}
                  onAhPlacement={setFormAhPlacement}
                  onAhPrompt={setFormAhPrompt}
                  onSave={() => void handleSave()}
                  onCancel={cancelForm}
                  label="Enregistrer"
                />
              </div>
            ) : (
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-900">{p.name}</p>
                    {p.autoHighlight.enabled && (
                      <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-medium text-danger-700">
                        {formatAutoHighlightModeLabel(p.autoHighlight.mode)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-4 leading-relaxed">
                    {p.prompt}
                  </p>
                  {p.autoHighlight.enabled && p.autoHighlight.prompt && (
                    <p className="text-xs text-danger-200 mt-1.5 line-clamp-2">
                      Auto-highlight : {p.autoHighlight.prompt}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
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
                    description="Les corrections déjà faites avec ce prompt ne sont pas affectées."
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

// ── CaptionPromptForm ──────────────────────────────────────────────────────────

function CaptionPromptForm({
  name,
  prompt,
  ahEnabled,
  ahMode,
  ahPlacement,
  ahPrompt,
  saving,
  onName,
  onPrompt,
  onAhEnabled,
  onAhMode,
  onAhPlacement,
  onAhPrompt,
  onSave,
  onCancel,
  label,
}: {
  name: string;
  prompt: string;
  ahEnabled: boolean;
  ahMode: AutoHighlightMode;
  ahPlacement: AutoHighlightPlacement;
  ahPrompt: string;
  saving: boolean;
  onName: (v: string) => void;
  onPrompt: (v: string) => void;
  onAhEnabled: (v: boolean) => void;
  onAhMode: (v: AutoHighlightMode) => void;
  onAhPlacement: (v: AutoHighlightPlacement) => void;
  onAhPrompt: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  label: string;
}) {
  const [showAhSection, setShowAhSection] = useState(ahEnabled);

  return (
    <div className="bg-danger-50/50 border border-danger-100 rounded-xl p-5 space-y-4">
      {/* Name */}
      <FormField label="Nom du prompt" required>
        <Input
          autoFocus
          value={name}
          onChange={onName}
          placeholder="Ex: Correction immobilier standard"
        />
      </FormField>

      {/* Main prompt */}
      <FormField label="Instructions de correction" required>
        <Textarea
          value={prompt}
          onChange={onPrompt}
          placeholder={"Tu es un expert en sous-titrage. Corrige les sous-titres ci-dessous pour les rendre plus lisibles et percutants.\n\nRègles :\n- Corrige les fautes d'orthographe et de grammaire\n- Améliore la ponctuation\n- Garde un style naturel et oral"}
          rows={10}
          className="font-mono leading-relaxed"
        />
      </FormField>

      {/* Auto-highlight section */}
      <div className="border border-danger-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => {
            const next = !showAhSection;
            setShowAhSection(next);
            if (!next) onAhEnabled(false);
          }}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-danger-700 bg-danger-50 hover:bg-danger-100 transition-colors"
        >
          <span>Auto-highlight</span>
          {showAhSection ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {showAhSection && (
          <div className="bg-white px-4 py-4 space-y-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={ahEnabled}
                onChange={(e) => onAhEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-danger-200 text-danger-600 focus:ring-danger-200"
              />
              Activer l&apos;auto-highlight pendant la correction IA
            </label>

            {ahEnabled && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Highlights à utiliser
                    </label>
                    <select
                      value={ahMode}
                      onChange={(e) => onAhMode(e.target.value as AutoHighlightMode)}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-danger-200"
                    >
                      <option value="highlight1">Highlight 1</option>
                      <option value="highlight2">Highlight 2</option>
                      <option value="both">Highlight 1 + Highlight 2</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Position dans le prompt
                    </label>
                    <select
                      value={ahPlacement}
                      onChange={(e) => onAhPlacement(e.target.value as AutoHighlightPlacement)}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-danger-200"
                    >
                      <option value="before">Avant le prompt</option>
                      <option value="after">Après le prompt</option>
                    </select>
                  </div>
                </div>
                <FormField label="Instructions d'auto-highlight">
                  <Textarea
                    value={ahPrompt}
                    onChange={onAhPrompt}
                    placeholder="Ex: Mets en HL1 les informations clés et en HL2 les accents marketing, sans surcharger chaque ligne."
                    rows={5}
                    className="font-mono leading-relaxed"
                  />
                </FormField>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" icon={Check} loading={saving} onClick={onSave}>
          {label}
        </Button>
        <Button variant="secondary" icon={X} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

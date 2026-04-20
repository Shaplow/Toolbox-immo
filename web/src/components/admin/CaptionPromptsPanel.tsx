"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import {
  DEFAULT_CAPTION_AUTO_HIGHLIGHT,
  type AutoHighlightMode,
  type AutoHighlightPlacement,
  type CaptionPromptRow,
} from "@/lib/captionPrompt";

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
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setFormName("");
    setFormPrompt("");
    setFormAhEnabled(DEFAULT_CAPTION_AUTO_HIGHLIGHT.enabled);
    setFormAhMode(DEFAULT_CAPTION_AUTO_HIGHLIGHT.mode);
    setFormAhPlacement(DEFAULT_CAPTION_AUTO_HIGHLIGHT.placement);
    setFormAhPrompt(DEFAULT_CAPTION_AUTO_HIGHLIGHT.prompt);
    setError(null);
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
    setError(null);
    setEditingId(p.id);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    resetForm();
  };

  const handleSave = async () => {
    if (!formName.trim() || !formPrompt.trim()) {
      setError("Nom et prompt requis");
      return;
    }
    setSaving(true);
    setError(null);

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
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        setPrompts((prev) => [...prev, data]);
        setCreating(false);
        resetForm();
      } else if (editingId) {
        const res = await fetch(`/api/caption-prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json() as CaptionPromptRow & { error?: string };
        if (!res.ok) { setError(data.error ?? "Erreur"); return; }
        setPrompts((prev) => prev.map((p) => (p.id === editingId ? data : p)));
        setEditingId(null);
        resetForm();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce prompt ? Les corrections déjà faites avec ce prompt ne sont pas affectées.")) return;
    const res = await fetch(`/api/caption-prompts/${id}`, { method: "DELETE" });
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition-colors"
        >
          <Plus size={13} /> Nouveau prompt
        </button>
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
          error={error}
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
          <p className="text-sm text-gray-400 text-center py-8">
            Aucun prompt. Créez-en un pour le rendre disponible dans l&apos;outil sous-titres.
          </p>
        )}
        {prompts.map((p) => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {editingId === p.id ? (
              <div className="p-5">
                <CaptionPromptForm
                  name={formName}
                  prompt={formPrompt}
                  ahEnabled={formAhEnabled}
                  ahMode={formAhMode}
                  ahPlacement={formAhPlacement}
                  ahPrompt={formAhPrompt}
                  error={error}
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
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                        {formatAutoHighlightModeLabel(p.autoHighlight.mode)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 whitespace-pre-line line-clamp-4 leading-relaxed">
                    {p.prompt}
                  </p>
                  {p.autoHighlight.enabled && p.autoHighlight.prompt && (
                    <p className="text-xs text-violet-400 mt-1.5 line-clamp-2">
                      Auto-highlight : {p.autoHighlight.prompt}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-gray-400 hover:text-violet-600 transition-colors rounded-lg hover:bg-violet-50"
                    title="Modifier"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => void handleDelete(p.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
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

// ── CaptionPromptForm ──────────────────────────────────────────────────────────

function CaptionPromptForm({
  name,
  prompt,
  ahEnabled,
  ahMode,
  ahPlacement,
  ahPrompt,
  error,
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
  error: string | null;
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
    <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-5 space-y-4">
      {/* Name */}
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1.5">Nom du prompt</label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Ex: Correction immobilier standard"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent bg-white"
        />
      </div>

      {/* Main prompt */}
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1.5">Instructions de correction</label>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={"Tu es un expert en sous-titrage. Corrige les sous-titres ci-dessous pour les rendre plus lisibles et percutants.\n\nRègles :\n- Corrige les fautes d'orthographe et de grammaire\n- Améliore la ponctuation\n- Garde un style naturel et oral"}
          rows={10}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-y focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent bg-white font-mono leading-relaxed"
        />
      </div>

      {/* Auto-highlight section */}
      <div className="border border-violet-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => {
            const next = !showAhSection;
            setShowAhSection(next);
            if (!next) onAhEnabled(false);
          }}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors"
        >
          <span>Auto-highlight</span>
          {showAhSection ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {showAhSection && (
          <div className="bg-white px-4 py-4 space-y-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={ahEnabled}
                onChange={(e) => onAhEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-300"
              />
              Activer l&apos;auto-highlight pendant la correction IA
            </label>

            {ahEnabled && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">
                      Highlights à utiliser
                    </label>
                    <select
                      value={ahMode}
                      onChange={(e) => onAhMode(e.target.value as AutoHighlightMode)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    >
                      <option value="highlight1">Highlight 1</option>
                      <option value="highlight2">Highlight 2</option>
                      <option value="both">Highlight 1 + Highlight 2</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">
                      Position dans le prompt
                    </label>
                    <select
                      value={ahPlacement}
                      onChange={(e) => onAhPlacement(e.target.value as AutoHighlightPlacement)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                    >
                      <option value="before">Avant le prompt</option>
                      <option value="after">Après le prompt</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1.5">
                    Instructions d&apos;auto-highlight
                  </label>
                  <textarea
                    value={ahPrompt}
                    onChange={(e) => onAhPrompt(e.target.value)}
                    placeholder="Ex: Mets en HL1 les informations clés et en HL2 les accents marketing, sans surcharger chaque ligne."
                    rows={5}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-y focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent bg-white font-mono leading-relaxed"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {label}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <X size={13} /> Annuler
        </button>
      </div>
    </div>
  );
}

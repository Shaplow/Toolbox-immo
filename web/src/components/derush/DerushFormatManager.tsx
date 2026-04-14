"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Lock, Save, X, ChevronLeft } from "lucide-react";
import type { DerushFormat } from "@/types/derush";

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  description: string;
  contextPrompt: string;
  silenceThreshold: string;
  exportMode: "individual" | "qa_pair";
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  contextPrompt: "",
  silenceThreshold: "1.5",
  exportMode: "individual",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function DerushFormatManager({
  initialFormats,
  isAdmin,
}: {
  initialFormats: DerushFormat[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [formats, setFormats] = useState<DerushFormat[]>(initialFormats);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const startCreate = useCallback(() => {
    setCreating(true);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, []);

  const startEdit = useCallback((f: DerushFormat) => {
    setEditingId(f.id);
    setCreating(false);
    setForm({
      name: f.name,
      description: f.description,
      contextPrompt: f.contextPrompt,
      silenceThreshold: String(f.silenceThreshold),
      exportMode: f.exportMode,
    });
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
    setError(null);
  }, []);

  const saveCreate = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/derush/formats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          silenceThreshold: parseFloat(form.silenceThreshold) || 1.5,
        }),
      });
      const data = await res.json() as DerushFormat & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setFormats((prev) => [...prev, data]);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, cancelEdit]);

  const saveEdit = useCallback(async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/derush/formats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          silenceThreshold: parseFloat(form.silenceThreshold) || 1.5,
        }),
      });
      const data = await res.json() as DerushFormat & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setFormats((prev) => prev.map((f) => (f.id === id ? { ...f, ...data } : f)));
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, cancelEdit]);

  const deleteFormat = useCallback(async (id: string, name: string) => {
    if (!confirm(`Supprimer le format « ${name} » ? Cette action est irréversible.`)) return;
    try {
      const res = await fetch(`/api/derush/formats/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      setFormats((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ─── Form component ────────────────────────────────────────────────────────

  const FormPanel = (
    <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-700">
        {creating ? "Nouveau format" : "Modifier le format"}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Nom *</label>
          <input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="ex: RQR Immobilier"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Seuil de silence (secondes)</label>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={form.silenceThreshold}
            onChange={(e) => setForm((s) => ({ ...s, silenceThreshold: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <p className="text-xs text-gray-400">Durée min entre 2 segments pour les fusionner (0 = désactivé)</p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">Description</label>
        <input
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="Description courte du format"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">Prompt de contexte Gemini</label>
        <textarea
          value={form.contextPrompt}
          onChange={(e) => setForm((s) => ({ ...s, contextPrompt: e.target.value }))}
          placeholder="Instructions spécifiques à ce format envoyées à Gemini pour la correction de la transcription…"
          rows={5}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
        />
        <p className="text-xs text-gray-400">
          Ce texte est envoyé à Gemini pour guider la correction de la transcription. Décrivez le type de contenu, les termes à privilégier, les erreurs fréquentes.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">Mode d&apos;export</label>
        <div className="grid grid-cols-2 gap-2">
          {(["individual", "qa_pair"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setForm((s) => ({ ...s, exportMode: mode }))}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                form.exportMode === mode
                  ? "border-violet-500 bg-violet-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="text-xs font-medium text-gray-800">
                {mode === "individual" ? "Individuel" : "Q+R groupé"}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {mode === "individual"
                  ? "Un clip par segment"
                  : "Question + réponse en un seul clip"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={cancelEdit}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Annuler
        </button>
        <button
          type="button"
          onClick={() => (creating ? void saveCreate() : editingId ? void saveEdit(editingId) : undefined)}
          disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Formats de segmentation</h1>
          <p className="text-sm text-gray-500">Configurez les formats de découpe pour la transcription</p>
        </div>
        {!creating && !editingId && (
          <button
            type="button"
            onClick={startCreate}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouveau format
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && FormPanel}

      {/* Formats list */}
      <div className="space-y-3">
        {formats.map((fmt) => {
          const isEditing = editingId === fmt.id;
          const canEdit = !fmt.isBuiltin || isAdmin;

          return (
            <div key={fmt.id}>
              {isEditing ? (
                FormPanel
              ) : (
                <div className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800">{fmt.name}</p>
                        {fmt.isBuiltin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 border border-amber-200">
                            <Lock className="w-2.5 h-2.5" />
                            Builtin
                          </span>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {fmt.exportMode === "qa_pair" ? "Q+R groupé" : "Individuel"}
                        </span>
                        <span className="text-xs text-gray-400">{fmt.silenceThreshold}s seuil</span>
                      </div>
                      {fmt.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{fmt.description}</p>
                      )}
                      {fmt.contextPrompt && (
                        <p className="mt-1 text-xs text-gray-400 italic line-clamp-2">
                          Prompt: {fmt.contextPrompt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(fmt)}
                            className="rounded-lg p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {!fmt.isBuiltin && (
                            <button
                              type="button"
                              onClick={() => void deleteFormat(fmt.id, fmt.name)}
                              className="rounded-lg p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {formats.length === 0 && !creating && (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">Aucun format disponible.</p>
            <button
              type="button"
              onClick={startCreate}
              className="mt-2 text-sm text-violet-600 hover:underline flex items-center gap-1 mx-auto"
            >
              <Plus className="w-4 h-4" />
              Créer un format
            </button>
          </div>
        )}
      </div>

      {/* Back link */}
      <div className="pt-4">
        <a
          href="/tools/derush"
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour au dérush
        </a>
      </div>
    </div>
  );
}

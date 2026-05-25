"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

type RecipeRow = Record<string, unknown>;

/** Fields managed server-side — excluded from the editable JSON body. */
const READONLY_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function toEditableJson(recipe: RecipeRow | null): string {
  if (!recipe) {
    // Template for a brand-new recipe
    return JSON.stringify(
      {
        code: "",
        label: "",
        source: "auto_template",
        templateId: null,
        libraryId: null,
        needsDescription: "none",
        needsCover: "none",
        needsCaptions: false,
        needsClientValidation: false,
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
        notes: null,
      },
      null,
      2
    );
  }
  const editable: RecipeRow = {};
  for (const [k, v] of Object.entries(recipe)) {
    if (!READONLY_FIELDS.has(k)) editable[k] = v;
  }
  return JSON.stringify(editable, null, 2);
}

export function RecipeJsonEditor({
  recipe,
  onClose,
  onSaved,
}: {
  /** null = create mode */
  recipe: RecipeRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = recipe === null;
  const [json, setJson] = useState(() => toEditableJson(recipe));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset when recipe changes (open another editor without unmounting)
  useEffect(() => {
    setJson(toEditableJson(recipe));
    setParseError(null);
    setServerError(null);
  }, [recipe]);

  function handleChange(value: string) {
    setJson(value);
    setParseError(null);
    setServerError(null);
  }

  async function handleSave() {
    // Client-side JSON validation
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setParseError(`JSON invalide : ${String(e)}`);
      return;
    }

    setSaving(true);
    setServerError(null);

    const url = isCreate
      ? "/api/admin/recipes"
      : `/api/admin/recipes/${String(recipe!.id)}`;
    const method = isCreate ? "POST" : "PATCH";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setServerError(data.error ?? `Erreur ${res.status}`);
        return;
      }
      onSaved();
    } catch {
      setServerError("Erreur réseau — réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isCreate ? "Nouvelle ContentRecipe" : `Éditer recipe — ${String(recipe!.code ?? recipe!.id)}`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          {isCreate && (
            <p className="text-xs text-gray-500 mb-3">
              Champs <code className="bg-gray-100 px-1 rounded">id</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">createdAt</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">updatedAt</code> sont gérés par le serveur.
            </p>
          )}
          {!isCreate && (
            <p className="text-xs text-gray-500 mb-3">
              Les champs <code className="bg-gray-100 px-1 rounded">id</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">createdAt</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">updatedAt</code> sont exclus (readonly côté serveur).
            </p>
          )}
          <textarea
            value={json}
            onChange={(e) => handleChange(e.target.value)}
            rows={22}
            spellCheck={false}
            className="w-full font-mono text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
          />
          {parseError && (
            <p className="mt-2 text-sm text-red-600 font-medium">{parseError}</p>
          )}
          {serverError && (
            <p className="mt-2 text-sm text-red-600 font-medium">Erreur serveur : {serverError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {saving ? "Sauvegarde…" : isCreate ? "Créer" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

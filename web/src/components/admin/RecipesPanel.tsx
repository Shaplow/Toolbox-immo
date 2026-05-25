"use client";

import { useState, useCallback } from "react";
import { Pencil, Trash2, RefreshCw } from "lucide-react";
import { RecipeJsonEditor } from "@/components/admin/RecipeJsonEditor";

type RecipeRow = {
  id: string;
  code: string;
  label: string;
  source: string;
  templateId: string | null;
  libraryId: string | null;
  needsDescription: string;
  needsCover: string;
  needsCaptions: boolean;
  needsClientValidation: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  template: { name: string } | null;
  library: { name: string } | null;
  defaultAssigneeMonteur: { name: string | null } | null;
  defaultAssigneeCm: { name: string | null } | null;
  _count: { publicationSlots: number };
};

function boolTag(v: boolean) {
  return v ? (
    <span className="inline-block text-[11px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">oui</span>
  ) : (
    <span className="inline-block text-[11px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">—</span>
  );
}

function strTag(v: string | null | undefined, defaultVal = "—") {
  if (!v || v === "none") return <span className="text-gray-300 text-xs">{defaultVal}</span>;
  return <span className="text-xs text-gray-700">{v}</span>;
}

export function RecipesPanel({ initialRecipes }: { initialRecipes: RecipeRow[] }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>(initialRecipes);
  const [editorRecipe, setEditorRecipe] = useState<RecipeRow | null | "new">(undefined as unknown as "new");
  const [editorOpen, setEditorOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/recipes");
    if (res.ok) {
      setRecipes(await res.json() as RecipeRow[]);
    }
  }, []);

  function openEditor(recipe: RecipeRow | null) {
    setEditorRecipe(recipe);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorRecipe(undefined as unknown as "new");
  }

  async function handleSaved() {
    closeEditor();
    await refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer cette ContentRecipe ? Cette action est irréversible.")) return;
    setDeletingId(id);
    await fetch(`/api/admin/recipes/${id}`, { method: "DELETE" });
    setDeletingId(null);
    await refresh();
  }

  async function handleSeed() {
    if (!confirm("Seeder les recipes depuis les templates existants (idempotent) ?")) return;
    setSeeding(true);
    setSeedMsg(null);
    const res = await fetch("/api/admin/recipes/seed-from-templates", { method: "POST" });
    const data = await res.json() as { created?: number; skipped?: number; error?: string };
    if (data.error) {
      setSeedMsg(`Erreur : ${data.error}`);
    } else {
      setSeedMsg(`Seed terminé — ${data.created ?? 0} créée(s), ${data.skipped ?? 0} ignorée(s).`);
    }
    setSeeding(false);
    await refresh();
  }

  return (
    <>
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => openEditor(null)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Nouvelle recipe
        </button>
        <button
          onClick={() => void handleSeed()}
          disabled={seeding}
          className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={14} className={seeding ? "animate-spin" : ""} />
          Seed depuis templates
        </button>
        {seedMsg && (
          <p className="text-xs text-gray-500">{seedMsg}</p>
        )}
      </div>

      {/* Table */}
      {recipes.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-12">
          Aucune ContentRecipe. Cliquez sur &ldquo;Nouvelle recipe&rdquo; ou &ldquo;Seed depuis templates&rdquo;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Label</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Template</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Bibliothèque</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Desc.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cover</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Caps.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Valid.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Monteur</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">CM</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Slots</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                      {r.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-800 font-medium max-w-[160px] truncate">{r.label}</td>
                  <td className="px-4 py-3">{strTag(r.source)}</td>
                  <td className="px-4 py-3">{strTag(r.template?.name)}</td>
                  <td className="px-4 py-3">{strTag(r.library?.name)}</td>
                  <td className="px-4 py-3">{strTag(r.needsDescription)}</td>
                  <td className="px-4 py-3">{strTag(r.needsCover)}</td>
                  <td className="px-4 py-3">{boolTag(r.needsCaptions)}</td>
                  <td className="px-4 py-3">{boolTag(r.needsClientValidation)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{r.defaultAssigneeMonteur?.name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{r.defaultAssigneeCm?.name ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-semibold text-gray-500">{r._count.publicationSlots}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => openEditor(r)}
                        title="Éditer JSON"
                        className="text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void handleDelete(r.id)}
                        disabled={deletingId === r.id}
                        title="Supprimer"
                        className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* JSON editor modal */}
      {editorOpen && (
        <RecipeJsonEditor
          recipe={editorRecipe === null ? null : (editorRecipe as RecipeRow)}
          onClose={closeEditor}
          onSaved={() => void handleSaved()}
        />
      )}
    </>
  );
}

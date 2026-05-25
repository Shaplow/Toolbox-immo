"use client";

import { useState, useCallback } from "react";
import { Pencil, RefreshCw, ClipboardList } from "lucide-react";
import { RecipeJsonEditor } from "@/components/admin/RecipeJsonEditor";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";

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
  const [editorRecipe, setEditorRecipe] = useState<RecipeRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

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
    setEditorRecipe(null);
  }

  async function handleSaved() {
    closeEditor();
    await refresh();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/recipes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try {
        const data = await res.json() as { error?: string };
        if (data.error) msg = `Erreur : ${data.error}`;
      } catch { /* body non-JSON */ }
      toast.error(msg);
      return;
    }
    toast.success("Recipe supprimée.");
    await refresh();
  }

  async function handleSeed() {
    setSeeding(true);
    const res = await fetch("/api/admin/recipes/seed-from-templates", { method: "POST" });
    const data = await res.json() as { created?: number; skipped?: number; error?: string };
    if (data.error) {
      toast.error(`Erreur : ${data.error}`);
    } else {
      toast.success(`Seed terminé — ${data.created ?? 0} créée(s), ${data.skipped ?? 0} ignorée(s).`);
    }
    setSeeding(false);
    await refresh();
  }

  return (
    <>
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button variant="primary" onClick={() => openEditor(null)}>
          + Nouvelle recipe
        </Button>
        <Button
          variant="secondary"
          icon={RefreshCw}
          loading={seeding}
          onClick={() => void handleSeed()}
        >
          Seed depuis templates
        </Button>
      </div>

      {/* Table */}
      {recipes.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Aucune ContentRecipe"
          description='Cliquez sur "Nouvelle recipe" ou "Seed depuis templates".'
        />
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
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        onClick={() => openEditor(r)}
                        title="Éditer JSON"
                        className="text-gray-400 hover:text-indigo-600"
                      >
                        <span className="sr-only">Éditer JSON</span>
                      </Button>
                      <DeleteButton
                        itemLabel="cette recipe"
                        description="Cette action est irréversible."
                        onConfirm={() => handleDelete(r.id)}
                      />
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
          recipe={editorRecipe}
          onClose={closeEditor}
          onSaved={() => void handleSaved()}
        />
      )}
    </>
  );
}

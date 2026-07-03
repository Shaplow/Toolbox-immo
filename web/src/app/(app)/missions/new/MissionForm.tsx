"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Save } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { FlexFieldsEditor } from "@/components/calendar/FlexFieldsEditor";

export interface MissionRecipe {
  id: string;
  label: string;
  source: string;
  templateId: string | null;
  fieldSchema: string[];
  autoSaveLibraryName: string | null;
}

export interface MissionAccount {
  id: string;
  name: string;
  handle: string;
}

interface MissionFormProps {
  recipes: MissionRecipe[];
  accounts: MissionAccount[];
  initialRecipeId?: string;
  initialAccountId?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Génération auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

export function MissionForm({
  recipes,
  accounts,
  initialRecipeId = "",
  initialAccountId = "",
}: MissionFormProps) {
  const router = useRouter();

  const validInitialRecipe = recipes.find((r) => r.id === initialRecipeId) ?? null;

  const [recipeId, setRecipeId] = useState(validInitialRecipe?.id ?? "");
  const [accountId, setAccountId] = useState(
    accounts.some((a) => a.id === initialAccountId) ? initialAccountId : "",
  );
  const [title, setTitle] = useState("");
  const [schema, setSchema] = useState<string[]>(validInitialRecipe?.fieldSchema ?? []);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((validInitialRecipe?.fieldSchema ?? []).map((k) => [k, ""])),
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === recipeId) ?? null,
    [recipes, recipeId],
  );

  function onRecipeChange(next: string) {
    setRecipeId(next);
    const recipe = recipes.find((r) => r.id === next);
    const nextSchema = recipe?.fieldSchema ?? [];
    setSchema(nextSchema);
    // Reset des valeurs sur les champs hérités (l'utilisateur pourra en ajouter).
    setValues(Object.fromEntries(nextSchema.map((k) => [k, ""])));
  }

  async function handleSubmit() {
    if (!recipeId) {
      toast.error("Choisissez une recette pour la mission.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patternTemplateId: recipeId,
          accountId: accountId || null,
          title: title.trim() || null,
          fields: values,
          fieldSchema: schema,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la création de la mission.");
        return;
      }
      const slot = (await res.json()) as { id: string };
      toast.success("Mission créée.");
      // Enchaîne sur la génération si la recette porte un template builder,
      // sinon ouvre la fiche publication.
      if (selectedRecipe?.templateId) {
        const acc = accountId ? `&accountId=${accountId}` : "";
        router.push(`/generate/${selectedRecipe.templateId}?slotId=${slot.id}${acc}`);
      } else {
        router.push(`/publications/${slot.id}`);
      }
    } catch {
      toast.error("Erreur réseau lors de la création.");
    } finally {
      setSubmitting(false);
    }
  }

  const recipeOptions = recipes.map((r) => ({
    value: r.id,
    label: `${r.label} · ${SOURCE_LABEL[r.source] ?? r.source}`,
  }));

  const accountOptions = [
    { value: "", label: "Aucun compte — production stock" },
    ...accounts.map((a) => ({ value: a.id, label: `@${a.handle} · ${a.name}` })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Clapperboard size={18} className="text-muted-foreground" />
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Nouvelle mission
        </h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-3">
        Générez à partir d&apos;une recette. Le compte Instagram est optionnel — sans
        compte, la mission produit un média « stock ».
      </p>

      <Card className="p-5 space-y-5">
        <FormField label="Recette" required help="Pilote la génération (template, cover, sous-titres, description).">
          <Select
            value={recipeId}
            onChange={onRecipeChange}
            options={recipeOptions}
            placeholder={recipes.length ? "Choisir une recette…" : "Aucune recette disponible"}
          />
        </FormField>

        <FormField label="Compte Instagram" help="Optionnel. Laissez vide pour une production stock (archivable en médiathèque).">
          <Select
            value={accountId}
            onChange={setAccountId}
            options={accountOptions}
            placeholder="Aucun compte — production stock"
          />
        </FormField>

        <FormField label="Titre" help="Optionnel. Par défaut, le nom de la recette.">
          <Input
            value={title}
            onChange={setTitle}
            placeholder="Titre de la mission…"
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Champs personnalisés
          </span>
          <p className="text-xs text-muted-foreground">
            Hérités de la recette. Ajoutez-en d&apos;autres au besoin — ils préremplissent
            le formulaire de génération.
          </p>
          <div className="mt-1">
            <FlexFieldsEditor
              schema={schema}
              values={values}
              onChange={(nextSchema, nextValues) => {
                setSchema(nextSchema);
                setValues(nextValues);
              }}
            />
          </div>
        </div>

        {selectedRecipe?.autoSaveLibraryName && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Save size={13} className="shrink-0" />
            <span>
              La sortie sera enregistrée automatiquement dans la médiathèque «{" "}
              <span className="font-medium text-foreground">{selectedRecipe.autoSaveLibraryName}</span> ».
            </span>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !recipeId}>
          {submitting ? "Création…" : "Créer la mission"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clapperboard, Save } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { toast } from "@/components/ui/Toast";
export interface MissionRecipe {
  id: string;
  label: string;
  source: string;
  templateId: string | null;
  requiresProperty: boolean;
  autoSaveLibraryName: string | null;
}

export interface MissionAccount {
  id: string;
  name: string;
  handle: string;
}

export interface MissionProperty {
  id: string;
  label: string;
  /** Valeurs partagées du bien (résolues live à la génération). */
  fields: Record<string, string>;
}

interface MissionFormProps {
  recipes: MissionRecipe[];
  accounts: MissionAccount[];
  properties: MissionProperty[];
  initialRecipeId?: string;
  initialAccountId?: string;
  initialPropertyId?: string;
  /** L'utilisateur peut-il créer une recette (admin) ? Pilote l'empty-state du
   *  catalogue vide : lien vers /admin/patterns pour un admin, message d'attente sinon. */
  canCreateRecipe?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Génération auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

export function MissionForm({
  recipes,
  accounts,
  properties,
  initialRecipeId = "",
  initialAccountId = "",
  initialPropertyId = "",
  canCreateRecipe = false,
}: MissionFormProps) {
  const router = useRouter();
  const hasRecipes = recipes.length > 0;

  const validInitialRecipe = recipes.find((r) => r.id === initialRecipeId) ?? null;

  const [recipeId, setRecipeId] = useState(validInitialRecipe?.id ?? "");
  const [accountId, setAccountId] = useState(
    accounts.some((a) => a.id === initialAccountId) ? initialAccountId : "",
  );
  const [title, setTitle] = useState("");
  const [propertyId, setPropertyId] = useState(
    properties.some((p) => p.id === initialPropertyId) ? initialPropertyId : "",
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === recipeId) ?? null,
    [recipes, recipeId],
  );
  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );
  const sharedFieldEntries = selectedProperty
    ? Object.entries(selectedProperty.fields).filter(([, v]) => v !== "")
    : [];

  async function handleSubmit() {
    if (!recipeId) {
      toast.error("Choisissez une recette pour la mission.");
      return;
    }
    if (selectedRecipe?.requiresProperty && !propertyId) {
      toast.error("Cette recette nécessite une fiche. Sélectionnez une fiche pour continuer.");
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
          propertyId: propertyId || null,
          title: title.trim() || null,
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

  const propertyOptions = [
    { value: "", label: "Aucune fiche" },
    ...properties.map((p) => ({ value: p.id, label: p.label })),
  ];

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { href: "/outils", label: "Atelier" },
          { label: "Nouvelle mission" },
        ]}
      />
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
          {hasRecipes ? (
            <Select
              value={recipeId}
              onChange={setRecipeId}
              options={recipeOptions}
              placeholder="Choisir une recette…"
            />
          ) : (
            <div className="rounded-md border border-input bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              Aucune recette pour l&apos;instant — indispensable pour lancer une mission.{" "}
              {canCreateRecipe ? (
                <>
                  <Link href="/admin/patterns" className="font-medium text-primary hover:underline">
                    Créez-en une
                  </Link>{" "}
                  dans Configuration → Recettes, puis revenez ici.
                </>
              ) : (
                "Demandez à un administrateur d'en créer une."
              )}
            </div>
          )}
        </FormField>

        <FormField
          label="Fiche"
          help="Optionnel. Fiche partagée (adresse, prix…) réutilisée par plusieurs missions. Éditée une fois, propagée aux prochaines générations."
        >
          {properties.length > 0 ? (
            <Select
              value={propertyId}
              onChange={setPropertyId}
              options={propertyOptions}
              placeholder="Aucune fiche"
            />
          ) : (
            <div className="rounded-md border border-input bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              Aucune fiche pour l&apos;instant.{" "}
              <Link href="/fiches?type=etype_bien" className="font-medium text-primary hover:underline">
                Créez-en une
              </Link>{" "}
              pour partager ses infos entre plusieurs missions.
            </div>
          )}
          {selectedProperty && (
            <div className="mt-2 rounded-md border border-border bg-muted/60 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Champs partagés de la fiche
              </p>
              {sharedFieldEntries.length > 0 ? (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {sharedFieldEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground truncate">{k}</dt>
                      <dd className="text-foreground truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Cette fiche n&apos;a pas encore de valeurs.{" "}
                  <Link href={`/fiches/${selectedProperty.id}`} className="text-primary hover:underline">
                    Compléter
                  </Link>
                </p>
              )}
            </div>
          )}
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

      {selectedRecipe?.requiresProperty && !propertyId && (
        <p className="text-[12px] text-warning-700 bg-warning-50/80 rounded-md px-3 py-2">
          Cette recette nécessite une fiche — sélectionnez-en une ci-dessus pour continuer.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()} disabled={submitting}>
          Annuler
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitting || !recipeId || (selectedRecipe?.requiresProperty && !propertyId)}
        >
          {submitting ? "Création…" : "Créer la mission"}
        </Button>
      </div>
    </div>
  );
}

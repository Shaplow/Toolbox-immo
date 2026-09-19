"use client";

/**
 * FieldsSection — les champs custom du type de fiche, en édition.
 *
 * Pas `EntityFieldsSection` : ce nom est déjà pris par
 * `components/publications/sections/EntityFieldsSection.tsx`, qui montre les
 * mêmes champs en LECTURE SEULE sur la publication. Deux fichiers homonymes
 * dans deux dossiers `sections/` se confondent au premier grep.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/molecules/Section";
import { toast } from "@/components/ui/Toast";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import { validateFieldValuesAll } from "@/lib/customFields";
import type { FicheSectionChromeProps } from "@/components/fiches/sectionShell";
import type { EntityFicheData } from "../ficheTypes";

export interface FieldsSectionProps extends FicheSectionChromeProps {
  entity: Pick<EntityFicheData, "id" | "fieldSchema" | "fields" | "isArchived">;
  isAdmin: boolean;
}

export function FieldsSection({
  entity,
  isAdmin,
  sectionId = "fields",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: FieldsSectionProps) {
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, string>>(entity.fields);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [savingFields, setSavingFields] = useState(false);

  /**
   * Erreurs de champs, recalculées à chaque frappe.
   *
   * Pré-affichées : depuis que `required` bloque à l'enregistrement, découvrir
   * un champ manquant au clic sur « Enregistrer » — un seul à la fois, dans
   * l'ordre du schéma — transformerait la correction en partie de devinettes.
   * Même source que le serveur (`validateFieldValuesAll`), mêmes `previousValues`,
   * pour que le rouge côté client ne mente jamais sur ce que la garde acceptera.
   */
  const fieldErrors = useMemo(
    () =>
      validateFieldValuesAll(entity.fieldSchema, fields, {
        requireRequired: !entity.isArchived,
        allowUnknownKeys: true,
        previousValues: entity.fields,
      }),
    [entity.fieldSchema, entity.isArchived, entity.fields, fields],
  );
  const missingRequired = entity.fieldSchema.filter(
    (f) => f.required && fieldErrors[f.key],
  ).length;

  function setFieldValue(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldsDirty(true);
  }

  async function saveFields() {
    setSavingFields(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Champs enregistrés.");
      setFieldsDirty(false);
      // Le libellé peut avoir été recalculé côté serveur : sans refresh, le
      // titre de la page garderait l'ancienne valeur.
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingFields(false);
    }
  }

  return (
    <Section
      title="Champs"
      icon={FileText}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
    >
      {entity.fieldSchema.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          Aucun champ défini pour ce type de fiche.
          {isAdmin && (
            <>
              {" "}
              <Link href="/admin/entity-types" className="text-primary hover:underline">
                Configurer les champs
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {isAdmin && missingRequired > 0 && (
            <Alert variant="warning">
              {missingRequired === 1
                ? "Un champ obligatoire est vide — la fiche ne peut pas être enregistrée."
                : `${missingRequired} champs obligatoires sont vides — la fiche ne peut pas être enregistrée.`}
            </Alert>
          )}
          {entity.fieldSchema.map((field) => (
            <CustomFieldValueInput
              key={field.key}
              field={field}
              value={fields[field.key] ?? ""}
              onChange={(v) => setFieldValue(field.key, v)}
              showLabel
              validateNumberFormat
              previousValue={entity.fields[field.key] ?? ""}
              error={isAdmin ? fieldErrors[field.key] : undefined}
              disabled={!isAdmin}
            />
          ))}
          {isAdmin && fieldsDirty && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void saveFields()}
                // Inutile d'envoyer une requête dont on connaît déjà le refus.
                disabled={savingFields || Object.keys(fieldErrors).length > 0}
              >
                {savingFields ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

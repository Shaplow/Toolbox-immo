"use client";

/**
 * useRecipeEntityBinding — socle partagé de fetch pour le champ « Exige une
 * fiche » de PatternTemplateFields (RecipeForm / PatternTemplateForm).
 *
 * Pur hook de data-fetching : la valeur `requiresEntityTypeId` est possédée
 * par le formulaire appelant (contrôlée), ce hook ne fait que résoudre :
 *  1. la liste des types de fiche (/api/entity-types) ;
 *  2. les clés de champ suggérées pour le mode description « preFilled »
 *     (/api/entity-types/[id]/field-keys), rechargées quand le type requis
 *     change — saisie libre autorisée en aval (la fiche peut ne pas exister
 *     encore).
 *
 * Le fallback legacy `requiresProperty` → « Bien » est résolu en amont par
 * `requiredEntityTypeId()` (lib/publications/entityRequirement.ts), pas ici.
 */
import { useEffect, useState } from "react";

export interface EntityTypeOption {
  id: string;
  name: string;
}

export interface PropertyFieldKey {
  key: string;
  label: string;
}

export function useRecipeEntityBinding(opts: {
  /** Id du type de fiche requis courant ("" = aucun). */
  requiresEntityTypeId: string;
  /** Mode description courant — les field-keys ne se chargent qu'en "preFilled". */
  needsDescription: string;
}) {
  const [entityTypes, setEntityTypes] = useState<EntityTypeOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/entity-types");
        if (!r.ok) return;
        const data = (await r.json()) as { types: EntityTypeOption[] };
        if (!cancelled) setEntityTypes(data.types);
      } catch {
        /* liste indisponible — le select reste vide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [propertyFieldKeys, setPropertyFieldKeys] = useState<PropertyFieldKey[]>([]);
  const { requiresEntityTypeId, needsDescription } = opts;
  const fieldKeysTypeId = requiresEntityTypeId || "etype_bien";
  useEffect(() => {
    if (needsDescription !== "preFilled") return;
    let cancelled = false;
    void (async () => {
      setPropertyFieldKeys([]);
      try {
        const r = await fetch(`/api/entity-types/${fieldKeysTypeId}/field-keys`);
        if (!r.ok) return;
        const data = (await r.json()) as PropertyFieldKey[];
        if (!cancelled) setPropertyFieldKeys(data);
      } catch {
        /* suggestions indisponibles — la saisie libre reste possible */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsDescription, fieldKeysTypeId]);

  return { entityTypes, propertyFieldKeys };
}

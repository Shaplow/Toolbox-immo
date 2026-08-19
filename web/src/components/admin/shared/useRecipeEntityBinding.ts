"use client";

/**
 * useRecipeEntityBinding — socle partagé de fetch pour le champ « Exige une
 * fiche » et le champ « Bibliothèque de données (légendes tournantes) » de
 * PatternTemplateFields (RecipeForm / PatternTemplateForm).
 *
 * Pur hook de data-fetching : la valeur `requiresEntityTypeId` est possédée
 * par le formulaire appelant (contrôlée), ce hook ne fait que résoudre :
 *  1. la liste des types de fiche (/api/entity-types) ;
 *  2. les clés de champ suggérées pour le mode description « preFilled »
 *     (/api/entity-types/[id]/field-keys), rechargées quand le type requis
 *     change — saisie libre autorisée en aval (la fiche peut ne pas exister
 *     encore) ;
 *  3. les bibliothèques de données disponibles pour le picker de légendes
 *     tournantes (/api/admin/libraries/data), un seul fetch alimentant à la
 *     fois le picker, les chips de clés et les warnings de rotation — chargé
 *     seulement en mode « preFilled » comme (2).
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

/** Projection de DataLibrary utile au picker + chips + warnings de rotation. */
export interface DataLibraryOption {
  id: string;
  name: string;
  templateType: string;
  /** JSON brut `CustomField[]` — à décoder avec `normalizeCustomFields`. */
  fieldsSchema: string;
  rotationScope: string;
  rotationMode: string;
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

  const [dataLibraries, setDataLibraries] = useState<DataLibraryOption[]>([]);
  useEffect(() => {
    if (needsDescription !== "preFilled") return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/admin/libraries/data");
        if (!r.ok) return;
        const data = (await r.json()) as DataLibraryOption[];
        if (!cancelled) setDataLibraries(data);
      } catch {
        /* bibliothèques indisponibles — le picker reste vide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsDescription]);

  return { entityTypes, propertyFieldKeys, dataLibraries };
}

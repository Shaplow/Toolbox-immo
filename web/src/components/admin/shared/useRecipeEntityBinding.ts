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
import { SYSTEM_ENTITY_TYPE_IDS } from "@/lib/entityTypes";

/** Référence stable — un `[]` littéral relancerait les mémos des appelants. */
const EMPTY_FIELD_KEYS: PropertyFieldKey[] = [];

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
  /** Dossiers nommés (DataEntry.setTag non null) + nombre de fiches, tri naturel. */
  folders: { setTag: string; count: number }[];
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
  const fieldKeysTypeId = requiresEntityTypeId || SYSTEM_ENTITY_TYPE_IDS.bien;
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

  /**
   * Clés du BIEN lié au tournage.
   *
   * La résolution de légende lit la fiche du slot, le tournage ET le bien du
   * tournage — mais le picker ne proposait que les clés d'UN type. Pour une
   * recette qui exige « Tournage », l'admin ne voyait jamais les clés du Bien
   * qu'il pointe : il tapait `{{prix}}` à l'aveugle, sans rien pour confirmer
   * que ça résoudrait.
   *
   * Chargé seulement quand la recette exige un type AUTRE que le Bien —
   * sinon ce sont les mêmes clés que `propertyFieldKeys`.
   */
  const [relatedFieldKeys, setRelatedFieldKeys] = useState<PropertyFieldKey[]>([]);
  const needsRelatedKeys =
    needsDescription === "preFilled" &&
    !!requiresEntityTypeId &&
    requiresEntityTypeId !== SYSTEM_ENTITY_TYPE_IDS.bien;
  useEffect(() => {
    // Pas de `setState([])` dans la branche inactive : on DÉRIVE la valeur
    // exposée plus bas. Vider l'état ici serait un setState synchrone dans un
    // effet — et déclencherait un rendu en cascade pour rien.
    if (!needsRelatedKeys) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/entity-types/${SYSTEM_ENTITY_TYPE_IDS.bien}/field-keys`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as PropertyFieldKey[];
        if (!cancelled) setRelatedFieldKeys(data);
      } catch {
        /* suggestions indisponibles — la saisie libre reste possible */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsRelatedKeys]);

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

  return {
    entityTypes,
    propertyFieldKeys,
    // Dérivé : la liste chargée ne doit pas rester visible si la recette
    // cesse d'exiger un type autre que le Bien.
    relatedFieldKeys: needsRelatedKeys ? relatedFieldKeys : EMPTY_FIELD_KEYS,
    dataLibraries,
  };
}

"use client";

/**
 * useRecipeEntityBinding — socle partagé RecipeForm / PatternTemplateForm
 * (V2.6). Encapsule les 3 blocs qui étaient copiés-collés à l'identique dans
 * les deux formulaires de recette :
 *  1. state « Exige une fiche » (select de type, compat legacy
 *     requiresProperty → « Bien ») ;
 *  2. fetch de la liste des types de fiche (/api/entity-types) ;
 *  3. fetch des clés de champs suggérées pour le mode description
 *     « preFilled » (/api/entity-types/[id]/field-keys), rechargé quand le
 *     type requis change — saisie libre autorisée en aval (la fiche peut ne
 *     pas exister encore).
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
  initialRequiresEntityTypeId: string | null | undefined;
  initialRequiresProperty: boolean | null | undefined;
  /** Mode description courant — les field-keys ne se chargent qu'en "preFilled". */
  needsDescription: string;
}) {
  const [requiresEntityTypeId, setRequiresEntityTypeId] = useState(
    opts.initialRequiresEntityTypeId ?? (opts.initialRequiresProperty ? "etype_bien" : ""),
  );

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
  const fieldKeysTypeId = requiresEntityTypeId || "etype_bien";
  const { needsDescription } = opts;
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

  return { requiresEntityTypeId, setRequiresEntityTypeId, entityTypes, propertyFieldKeys };
}

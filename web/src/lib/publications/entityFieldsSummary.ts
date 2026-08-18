/**
 * entityFieldsSummary — projection en lecture seule des champs d'une fiche
 * (Entity) rattachée à un `PublicationSlot`, pour affichage sur la fiche
 * publication (cf. `components/publications/sections/EntityFieldsSection.tsx`).
 *
 * Avant : la fiche publication affichait le lien vers la fiche rattachée
 * mais aucune de ses valeurs — l'utilisateur devait ouvrir la fiche dans un
 * autre onglet pour vérifier ce qui alimentera la génération/la légende.
 * Beaucoup de rôles ne PEUVENT même pas ouvrir cet onglet : les types de
 * fiche `visibility="admin"` (ex. « Bien ») sont strictement réservés à
 * l'ADMIN (cf. `lib/permissions/entityScope.ts`) — pour un monteur/CM/
 * vidéaste, cette section EST la seule vue possible sur ces valeurs.
 *
 * Ordre d'affichage : les clés déclarées dans le `fieldSchema` du type
 * d'abord (dans leur ordre), avec leur libellé — puis toute clé brute
 * présente dans `Entity.fields` mais absente du schéma actuel (legacy /
 * schéma modifié après coup), affichée sous son nom de clé brut.
 */

import { normalizeCustomFields } from "@/lib/customFields";
import { safeJSON } from "@/lib/utils/json";

export interface EntityFieldEntry {
  key: string;
  label: string;
  value: string;
}

export type EntitySummaryRole = "data" | "shoot";

export interface EntityFieldsSummary {
  role: EntitySummaryRole;
  entityId: string;
  label: string;
  typeName: string;
  fields: EntityFieldEntry[];
  /** L'utilisateur courant peut-il ouvrir `/fiches/[id]` pour cette fiche ? */
  canOpen: boolean;
}

/** `true` pour tout ce qui compte comme une valeur affichable — "0" et
 *  "false" sont légitimes, seule la chaîne vide/espaces ne l'est pas. */
function hasDisplayableValue(raw: unknown): raw is string | number | boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  return true;
}

/**
 * Projette `Entity.fields` (JSON `Record<string,string>`) en liste ordonnée
 * de `{key,label,value}`, filtrée aux valeurs non vides — libellés résolus
 * depuis `EntityType.fieldSchema`.
 */
export function buildEntityFieldEntries(
  fieldsJson: string | null | undefined,
  fieldSchemaJson: string | null | undefined,
): EntityFieldEntry[] {
  const values = safeJSON<Record<string, unknown>>(fieldsJson, {});
  const schema = normalizeCustomFields(fieldSchemaJson);
  const seen = new Set<string>();
  const out: EntityFieldEntry[] = [];

  for (const f of schema) {
    seen.add(f.key);
    const raw = values[f.key];
    if (!hasDisplayableValue(raw)) continue;
    out.push({ key: f.key, label: f.label || f.key, value: String(raw).trim() });
  }
  for (const [key, raw] of Object.entries(values)) {
    if (seen.has(key)) continue;
    if (!hasDisplayableValue(raw)) continue;
    out.push({ key, label: key, value: String(raw).trim() });
  }
  return out;
}

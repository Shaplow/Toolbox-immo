/**
 * captionDataLibrary — orchestrateur du tirage DataLibrary pour la légende
 * pré-remplie d'une recette (`PatternTemplate.descriptionDataLibraryId`).
 *
 * Sépare lecture (storedEntry / `selectDataEntry`) / résolution pure
 * (`resolvePrefilledCaptionFromEntities`) / claim (à la charge de
 * l'appelant, cf. `claimDataEntryForCaption` dans `contentLibraryResolver.ts`)
 * — ce module ne fait AUCUNE écriture.
 *
 * Réutilise le moteur de tirage « dossier simple » de la Content Library
 * (LRU par dossier, `rotationScope` shared|per_account) : c'est ce qui fait
 * varier les légendes par compte Instagram et tourner dans le temps, sans
 * dupliquer d'algorithme de sélection.
 */

import { prisma } from "@/lib/prisma";
import {
  resolvePrefilledCaptionFromEntities,
  type PrefilledCaptionConfig,
} from "@/lib/publications/preFilledDescription";
import { selectDataEntry } from "@/lib/contentLibraryResolver";
import { extractTemplateVars, extractConditionFields } from "@/lib/textTemplate";

export interface CaptionLibraryResolution {
  caption: string | null;
  usedEntry: { entryId: string; fields: Record<string, string>; setTag: string | null; libraryId: string } | null;
  /** true ⇒ l'appelant DOIT persister captionDataEntryId + claimDataEntryForCaption + logActivity. */
  drewNewEntry: boolean;
}

/** Parse tolérant d'une colonne `fields` DataEntry (miroir de `selectDataEntry`). */
function parseEntryFields(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Clés du modèle de légende référencées par une DataEntry : `{{clé}}` +
 * champs des conditions `{{#if champ == "x"}}` + alias legacy
 * `descriptionSourceFieldKey` quand le modèle (`descriptionFixedText`) est
 * vide — ce dernier compte comme LA variable du modèle (lookup direct, cf.
 * `resolvePrefilledCaption`).
 */
function referencedTemplateKeys(config: PrefilledCaptionConfig): Set<string> {
  const template =
    typeof config.descriptionFixedText === "string" ? config.descriptionFixedText : "";
  if (template.trim().length > 0) {
    const keys = new Set(extractTemplateVars(template));
    for (const cond of extractConditionFields(template)) keys.add(cond.field);
    return keys;
  }
  const legacyKey = config.descriptionSourceFieldKey?.trim();
  return legacyKey ? new Set([legacyKey]) : new Set();
}

export async function resolveCaptionWithDataLibrary(params: {
  config: PrefilledCaptionConfig & {
    descriptionDataLibraryId: string | null;
    /** Dossier épinglé — le tirage ne sert que ce dossier. null = tous. */
    descriptionDataSetTag: string | null;
  };
  accountId: string | null | undefined;
  storedEntry: { id: string; fields: string; setTag: string | null; libraryId: string } | null;
  redraw?: boolean;
  shootEntityFieldsJson: string | Record<string, unknown> | null | undefined;
  entityFieldsJson: string | Record<string, unknown> | null | undefined;
}): Promise<CaptionLibraryResolution> {
  const { config, accountId, storedEntry, redraw, shootEntityFieldsJson, entityFieldsJson } = params;

  // a. Pas de bibliothèque configurée → chemin legacy strictement identique
  // (3 sources). storedEntry est ignoré : une recette qui perd sa
  // bibliothèque repasse en pure ré-interpolation.
  if (!config.descriptionDataLibraryId) {
    const caption = resolvePrefilledCaptionFromEntities(config, shootEntityFieldsJson, entityFieldsJson);
    return { caption, usedEntry: null, drewNewEntry: false };
  }

  const libraryId = config.descriptionDataLibraryId;
  const pinnedSetTag = config.descriptionDataSetTag?.trim() || null;

  // b. Candidat : reuse du storedEntry si pas de redraw explicite, sinon tirage.
  // La réutilisation exige que l'entrée mémorisée appartienne TOUJOURS à la
  // config courante de la recette — sans cette garde, changer de bibliothèque
  // ou épingler/changer de dossier n'aurait aucun effet sur les slots
  // existants : ils ré-interpoleraient à vie une fiche de l'ancienne
  // bibliothèque / d'un autre dossier.
  // Note : quand AUCUN dossier n'est épinglé, le setTag de l'entrée n'entre pas
  // dans la garde — sinon dépingler invaliderait tous les slots d'un coup.
  let candidate: { entryId: string; fields: Record<string, string>; setTag: string | null } | null = null;
  let drewNewEntry = false;

  const storedMatchesConfig =
    !!storedEntry &&
    storedEntry.libraryId === libraryId &&
    (pinnedSetTag === null || storedEntry.setTag === pinnedSetTag);

  if (!redraw && storedEntry && storedMatchesConfig) {
    candidate = {
      entryId: storedEntry.id,
      fields: parseEntryFields(storedEntry.fields),
      setTag: storedEntry.setTag,
    };
  } else {
    if (!redraw && storedEntry && !storedMatchesConfig) {
      console.warn(
        `[resolveCaptionWithDataLibrary] entry=${storedEntry.id} (library=${storedEntry.libraryId}, dossier=${storedEntry.setTag ?? "—"}) ` +
          `hors config courante (library=${libraryId}, dossier=${pinnedSetTag ?? "tous"}) — nouveau tirage.`,
      );
    }
    // f. Mission sans compte + bibliothèque per_account : on tire QUAND MÊME
    // (rotation globale dégradée) plutôt que de sauter le tirage — notre
    // claim écrit les compteurs GLOBAUX (DataEntry.usageCount/lastUsedAt),
    // donc les missions sans compte tournent correctement entre elles sans
    // polluer les compteurs per-account des vrais comptes.
    if (!accountId) {
      const lib = await prisma.dataLibrary.findUnique({
        where: { id: libraryId },
        select: { rotationScope: true },
      });
      if (lib && lib.rotationScope !== "shared") {
        console.warn(
          `[resolveCaptionWithDataLibrary] library=${libraryId} rotationScope=per_account sans accountId — tirage en rotation globale dégradée (mission sans compte).`,
        );
      }
    }
    const drawn = await selectDataEntry(libraryId, undefined, accountId ?? undefined, { pinnedSetTag });
    if (drawn) {
      candidate = { entryId: drawn.entryId, fields: drawn.fields, setTag: drawn.resolvedSetTag };
      drewNewEntry = true;
    }
  }

  // c. Garde anti-gaspillage : le modèle ne référence AUCUNE clé du candidat
  // → on le jette (pas de claim, pas de stockage) plutôt que de brûler la
  // rotation quand l'admin a configuré une bibliothèque mais un modèle 100 %
  // fiche.
  if (candidate) {
    const referenced = referencedTemplateKeys(config);
    const isReferenced = Object.keys(candidate.fields).some((key) => referenced.has(key));
    if (!isReferenced) {
      candidate = null;
      drewNewEntry = false;
    }
  }

  // d. Résolution pure — entity > shootEntity > dataEntry (fill-only).
  const caption = resolvePrefilledCaptionFromEntities(
    config,
    shootEntityFieldsJson,
    entityFieldsJson,
    candidate?.fields,
  );

  // e. Résolution vide/blanche → on ne wipe jamais la légende avec du vide :
  // une résolution vide ne consomme rien et ne stocke rien.
  if (caption === null) {
    return { caption: null, usedEntry: null, drewNewEntry: false };
  }

  return {
    caption,
    usedEntry: candidate
      ? { entryId: candidate.entryId, fields: candidate.fields, setTag: candidate.setTag, libraryId }
      : null,
    drewNewEntry,
  };
}

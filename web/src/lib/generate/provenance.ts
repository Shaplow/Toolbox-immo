/**
 * Provenance d'une valeur du formulaire de génération — source de vérité
 * unique pour « d'où vient cette valeur », partagée entre le pré-remplissage
 * (serveur), le formulaire (badge affiché à l'utilisateur) et le rendu
 * (re-résolution live des valeurs issues d'une fiche).
 *
 * Précédence canonique, du plus fort au plus faible :
 *   manual > entity (fiche data) > shootEntity (fiche tournage) > dataEntry > assetMetadata
 *
 * Une valeur `manual` n'est JAMAIS écrasée : c'est une intention explicite de
 * l'utilisateur. Les valeurs `entity`/`shootEntity` sont re-résolues à chaque
 * render (la fiche a pu être éditée ou re-rattachée depuis le submit), alors
 * que `dataEntry` est un tirage figé au moment du submit.
 *
 * La map est stockée dans `Listing.jsonData` sous la clé réservée
 * `__provenance` — pas de colonne Prisma dédiée. Les champs du schéma d'un
 * template ne peuvent pas entrer en collision avec cette clé : elle est
 * filtrée à la lecture du schéma (voir `stripProvenance`).
 */

export const PROVENANCE_VALUES = [
  "manual",
  "entity",
  "shootEntity",
  "dataEntry",
  "assetMetadata",
] as const;

export type ValueProvenance = (typeof PROVENANCE_VALUES)[number];

/** Clé réservée du `Listing.jsonData` portant la map de provenance. */
export const PROVENANCE_KEY = "__provenance";

export type ProvenanceMap = Record<string, ValueProvenance>;

/** Rang de précédence : plus le nombre est bas, plus la source est prioritaire. */
const PRECEDENCE: Record<ValueProvenance, number> = {
  manual: 0,
  entity: 1,
  shootEntity: 2,
  dataEntry: 3,
  assetMetadata: 4,
};

/** `true` si `candidate` a le droit d'écraser une valeur venue de `current`. */
export function canOverride(
  current: ValueProvenance | undefined,
  candidate: ValueProvenance,
): boolean {
  if (current === undefined) return true;
  return PRECEDENCE[candidate] < PRECEDENCE[current];
}

/** `true` si la valeur doit être re-résolue à chaque render (fiche éditable). */
export function isLiveResolved(provenance: ValueProvenance | undefined): boolean {
  return provenance === "entity" || provenance === "shootEntity";
}

/**
 * Règle « valeur non vide » commune à tous les enrichisseurs (alignée sur
 * `enrichListingWithAssetMetadata`) : "0" et false sont des valeurs légitimes,
 * seuls undefined/null/"" comptent comme vides.
 */
export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Extrait la map de provenance d'un `jsonData` de Listing (tolérant). */
export function readProvenance(listingData: unknown): ProvenanceMap {
  if (!listingData || typeof listingData !== "object") return {};
  const raw = (listingData as Record<string, unknown>)[PROVENANCE_KEY];
  if (!raw || typeof raw !== "object") return {};
  const out: ProvenanceMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (PROVENANCE_VALUES.includes(value as ValueProvenance)) {
      out[key] = value as ValueProvenance;
    }
  }
  return out;
}

/** Renvoie une copie de `listingData` sans la clé réservée de provenance. */
export function stripProvenance<T extends Record<string, unknown>>(listingData: T): T {
  if (!(PROVENANCE_KEY in listingData)) return listingData;
  const rest = { ...listingData };
  delete rest[PROVENANCE_KEY];
  return rest;
}

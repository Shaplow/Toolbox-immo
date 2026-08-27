/**
 * estimateOutputDuration — estimation unique de la durée de la vidéo produite.
 *
 * Sert à décider si une piste musicale est assez longue pour couvrir le rendu.
 * Auparavant, deux estimations divergentes coexistaient (une au prefill dans
 * `contentLibraryResolver`, une au render-time dans `generateRender`), et toutes
 * deux comptaient **0** pour un slot sans `maxDuration` — c'est-à-dire pour le
 * clip principal d'un reel immo, celui qui vient du formulaire. Résultat : sur un
 * template sans caps, l'estimation valait 0, le filtre de durée était désactivé,
 * et une piste de 20 s partait sur une vidéo de 60 s (le mix `amix=duration=first`
 * laisse alors du silence jusqu'à la fin, sans le moindre avertissement).
 *
 * Deux principes :
 *  - `maxDuration` est un PLAFOND, pas une durée : sans durée d'asset connue, on
 *    ne peut que le prendre comme approximation ;
 *  - une estimation incomplète ne désactive PLUS le filtre, elle sert de borne
 *    inférieure (`partial: true`). Une piste plus courte que la somme partielle
 *    est de toute façon trop courte.
 */

/** Une source contribuant à la durée finale (slot de séquence ou bloc vidéo). */
export interface DurationSource {
  /** Identifiant, seulement pour les diagnostics. */
  id: string;
  /** Durée réelle de l'asset retenu, en secondes, si connue. */
  assetDuration?: number | null;
  /** Plafond appliqué à ce clip (`slot.maxDuration`), si défini. */
  cap?: number | null;
}

export interface DurationEstimate {
  /** Borne (inférieure) de la durée de sortie, en secondes. */
  seconds: number;
  /** true si au moins une source n'a pu être estimée — la valeur sous-estime. */
  partial: boolean;
  /** Sources sans durée ni plafond, pour les logs. */
  unknownSourceIds: string[];
}

function resolveSourceSeconds(source: DurationSource): number | null {
  const assetDuration =
    typeof source.assetDuration === "number" && source.assetDuration > 0 ? source.assetDuration : null;
  const cap = typeof source.cap === "number" && source.cap > 0 ? source.cap : null;
  if (assetDuration !== null && cap !== null) return Math.min(assetDuration, cap);
  if (assetDuration !== null) return assetDuration;
  if (cap !== null) return cap;
  return null;
}

/**
 * Estime la durée d'une SÉQUENCE : les clips sont concaténés, on somme.
 *
 * @param canvasMaxDuration plafond global du template (`canvas.maxDuration`).
 */
export function estimateSequenceDuration(
  sources: readonly DurationSource[],
  canvasMaxDuration?: number | null,
): DurationEstimate {
  let seconds = 0;
  const unknownSourceIds: string[] = [];
  for (const source of sources) {
    const resolved = resolveSourceSeconds(source);
    if (resolved === null) {
      unknownSourceIds.push(source.id);
      continue;
    }
    seconds += resolved;
  }
  const cap = typeof canvasMaxDuration === "number" && canvasMaxDuration > 0 ? canvasMaxDuration : null;
  if (cap !== null && seconds > cap) seconds = cap;
  return { seconds, partial: unknownSourceIds.length > 0, unknownSourceIds };
}

/**
 * Estime la durée d'un rendu SINGLE-VIDEO (pas de `videoSequence`).
 *
 * Ici un seul bloc vidéo est réellement rendu : on prend le plafond du canvas
 * s'il existe, sinon le MAXIMUM des sources — surtout pas leur somme, qui
 * surestimerait massivement et ferait rejeter toutes les pistes.
 */
export function estimateSingleVideoDuration(
  sources: readonly DurationSource[],
  canvasMaxDuration?: number | null,
): DurationEstimate {
  const cap = typeof canvasMaxDuration === "number" && canvasMaxDuration > 0 ? canvasMaxDuration : null;
  if (cap !== null) return { seconds: cap, partial: false, unknownSourceIds: [] };

  let seconds = 0;
  const unknownSourceIds: string[] = [];
  for (const source of sources) {
    const resolved = resolveSourceSeconds(source);
    if (resolved === null) {
      unknownSourceIds.push(source.id);
      continue;
    }
    seconds = Math.max(seconds, resolved);
  }
  return { seconds, partial: unknownSourceIds.length > 0, unknownSourceIds };
}

/**
 * Durée minimale exigée d'une piste musicale.
 *
 * `Math.max` et non une priorité : `minDuration` est un plancher voulu par le
 * template, l'estimation est un plancher imposé par le montage — les deux
 * doivent être respectés. Retourne `undefined` quand la piste boucle (n'importe
 * quelle longueur convient) ou qu'aucune contrainte n'est connue.
 */
export function resolveRequiredAudioDuration(
  music: { minDuration?: number | null; loop?: boolean | null },
  estimate: DurationEstimate,
): number | undefined {
  if (music.loop) return undefined;
  const floor = Math.max(
    typeof music.minDuration === "number" && music.minDuration > 0 ? music.minDuration : 0,
    estimate.seconds > 0 ? estimate.seconds : 0,
  );
  return floor > 0 ? floor : undefined;
}

/**
 * Centrage vertical OPTIQUE des capitales.
 *
 * Problème : `line-height: normal` réserve l'espace ascender + descender complet
 * de la police. Un texte tout en capitales (serif display) n'utilise ni les
 * ascendantes hautes ni les descendantes → la line-box a de l'espace vide
 * asymétrique, et un centrage flex (`justify-content:center`) centre la BOÎTE,
 * pas l'encre visible. Résultat : les capitales paraissent décalées.
 *
 * On calcule un décalage en **em** (proportionnel à la taille de police) à
 * appliquer en `transform: translateY(...em)` sur le contenu texte. L'unité em
 * garantit la parité builder ↔ HTML/vidéo sans dépendre du zoom, du styleScale
 * ni de la conversion pt→px : `0.05em` vaut 5 % de la fonte des deux côtés.
 *
 * PARITÉ : la formule `capCenteringOffsetEm` est répliquée à l'identique dans le
 * script inline de `buildHTML.ts` (`applyCapCentering`). Toute modif ici doit y
 * être reportée.
 */

export interface CapCenteringMetrics {
  /** TextMetrics.fontBoundingBoxAscent (ascender de la police, px) */
  fontBoundingBoxAscent: number;
  /** TextMetrics.fontBoundingBoxDescent (descender de la police, px) */
  fontBoundingBoxDescent: number;
  /** TextMetrics.actualBoundingBoxAscent (encre réelle au-dessus de la baseline, px) */
  actualBoundingBoxAscent: number;
  /** TextMetrics.actualBoundingBoxDescent (encre réelle sous la baseline, px) */
  actualBoundingBoxDescent: number;
}

/** Plafond de sécurité : au-delà, les métriques sont douteuses → on n'applique rien. */
const MAX_OFFSET_EM = 0.5;

/**
 * Décalage vertical (em, positif = vers le bas) pour recentrer optiquement
 * l'encre dans sa line-box. `fontSizePx` = la taille à laquelle les métriques
 * ont été mesurées (les métriques étant proportionnelles, le résultat en em est
 * indépendant de cette référence).
 */
export function capCenteringOffsetEm(metrics: CapCenteringMetrics, fontSizePx: number): number {
  if (!(fontSizePx > 0)) return 0;
  const spaceAbove = metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent;
  const spaceBelow = metrics.fontBoundingBoxDescent - metrics.actualBoundingBoxDescent;
  const offsetPx = (spaceBelow - spaceAbove) / 2;
  const offsetEm = offsetPx / fontSizePx;
  if (!Number.isFinite(offsetEm)) return 0;
  return Math.max(-MAX_OFFSET_EM, Math.min(MAX_OFFSET_EM, offsetEm));
}

/**
 * Centrage vertical OPTIQUE des capitales.
 *
 * ## Le problème
 *
 * `justify-content: center` centre la **pile de boîtes de ligne CSS**, pas l'encre.
 * Dans une boîte de ligne, la ligne de base est posée à `ascent` du haut de la
 * content-area, et l'espace sous elle est réservé aux jambages. Un titre en
 * capitales n'a aucun jambage : son encre occupe `[baseline − capHeight, baseline]`,
 * une portion asymétrique de la boîte. Le centre de l'encre ne tombe donc pas sur
 * le centre de la boîte, et le texte paraît décalé.
 *
 * ## La formule
 *
 *     offset = (descent − ascent + capHeight) / 2       (em, positif = vers le bas)
 *
 * réécrite ici en `capHeight/2 − (ascent − descent)/2`, ce qui n'exige que deux
 * mesures au lieu de trois.
 *
 * Propriété démontrée (et couverte par les tests) : le résultat est **indépendant
 * du `line-height` et du nombre de lignes**. Le demi-leading est symétrique par
 * définition CSS donc il s'élimine, et le décalage entre le centre de la pile et
 * le centre de la zone d'encre s'annule exactement.
 *
 * ## Aucune valeur en dur, aucune configuration par police
 *
 * Les métriques sont lues au runtime sur la police réellement rendue. La même
 * formule donne +0,1335 em sur Didot, −0,0615 em sur Playfair Display, +0,05 em
 * sur Bebas Neue. **Le signe change selon la police** — une constante serait fausse
 * partout sauf sur une police. Une police ajoutée plus tard fonctionne sans
 * modification de code.
 *
 * ## Pourquoi une sonde DOM et pas le canvas
 *
 * Une version précédente (supprimée en `f17d842`) utilisait
 * `ctx.measureText(...)`. Deux défauts :
 * - construire un `ctx.font` valide depuis `getComputedStyle` échoue **silencieusement**
 *   si le raccourci est rejeté : le canvas retombe sur `10px sans-serif` et renvoie
 *   les métriques d'une autre police, sans erreur ;
 * - `fontBoundingBoxAscent/Descent` est spécifié comme la bounding box des *glyphes*
 *   (Firefox l'implémente ainsi) ; que Blink retourne les ascent/descent du layout
 *   est un détail d'implémentation non garanti.
 *
 * La sonde mesure directement sur le moteur de layout, donc sur les métriques qui
 * positionnent réellement la ligne de base. Correct par construction, et
 * auto-correcteur entre plateformes : le Chrome du builder et le Chromium de
 * Puppeteer peuvent avoir des ascent/descent différents pour la même police, chacun
 * mesure les siens et le résultat optique est juste des deux côtés.
 *
 * ## PARITÉ
 *
 * `measureFontOpticalOffsetEm` est **injectée dans le script inline de `buildHTML`
 * via `.toString()`**. Elle ne doit donc référencer aucune constante ni aucun import
 * de ce module — tout est inliné dans son corps, et un test unitaire le vérifie.
 */

/**
 * Plafond de sécurité. Les valeurs réelles observées vont de −0,07 à +0,14 em ;
 * au-delà de 0,5 em les métriques sont douteuses et on préfère ne rien appliquer
 * plutôt que de casser une mise en page.
 */
export const MAX_OPTICAL_OFFSET_EM = 0.5;

/**
 * Arithmétique pure du centrage optique. Sans DOM, donc testable sous Vitest
 * (`environment: "node"`).
 *
 * @param capHeightEm         Hauteur de capitale, en em.
 * @param halfAscentDescentEm `(ascent − descent) / 2`, en em.
 * @returns Décalage en em, positif = vers le bas. `0` si les entrées sont
 *          inutilisables — on ne devine pas.
 */
export function opticalCapCenterOffsetEm(
  capHeightEm: number,
  halfAscentDescentEm: number,
): number {
  if (!Number.isFinite(capHeightEm) || !Number.isFinite(halfAscentDescentEm)) return 0;
  // Une capHeight nulle ou négative signale une sonde qui n'a pas abouti.
  if (!(capHeightEm > 0)) return 0;

  const offset = capHeightEm / 2 - halfAscentDescentEm;
  if (!Number.isFinite(offset)) return 0;

  const clamped = Math.max(-MAX_OPTICAL_OFFSET_EM, Math.min(MAX_OPTICAL_OFFSET_EM, offset));
  // Arrondi à 4 décimales : rend la valeur stable entre deux mesures (les ascent
  // sont arrondis à l'entier par Blink) et donne un seuil qui veut dire quelque
  // chose au test de parité builder ↔ HTML.
  return Math.round(clamped * 10_000) / 10_000;
}

/** Identité de police servant de clé de cache. La taille n'y entre pas : les métriques sont linéaires. */
export interface FontOpticalKey {
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
}

/**
 * Mesure le décalage optique d'une police via une sonde DOM, en em.
 *
 * ⚠️ **Fonction auto-suffisante par contrainte** : elle est sérialisée par
 * `.toString()` et injectée dans le script inline de `buildHTML`. Aucune référence
 * à une constante de module, un import ou une autre fonction du fichier — sinon le
 * script injecté lève un `ReferenceError` au runtime, silencieusement pour le
 * rendu. Un test unitaire garde cette propriété.
 *
 * Technique : un conteneur en `line-height: 3` (le strut domine forcément la boîte,
 * puisque `ascent + descent < 2` pour toute police réelle), un span vide en
 * `display:inline-block; height:0; vertical-align:baseline` — dont la baseline est
 * son bord bas, donc il se pose exactement **sur** la ligne de base — et un second
 * span en `height: 1cap`.
 *
 * Tout est exprimé en **ratios de la boîte de ligne**, donc invariant à n'importe
 * quel `transform: scale()` ancêtre : indispensable, le canvas du builder étant mis
 * à l'échelle par le zoom.
 */
export function measureFontOpticalOffsetEm(font: FontOpticalKey): number {
  if (typeof document === "undefined") return 0;

  // Inlinés volontairement : cette fonction est injectée par .toString().
  const PROBE_LINE_HEIGHT = 3;
  const MAX_OFFSET_EM = 0.5;

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-99999px;top:0;white-space:nowrap;font-size:1000px;line-height:" +
    PROBE_LINE_HEIGHT;
  probe.style.fontFamily = font.fontFamily;
  probe.style.fontWeight = font.fontWeight;
  probe.style.fontStyle = font.fontStyle;

  const baselineSpan = document.createElement("span");
  baselineSpan.style.cssText =
    "display:inline-block;width:0;height:0;vertical-align:baseline";
  const capSpan = document.createElement("span");
  capSpan.style.cssText =
    "display:inline-block;width:0;vertical-align:baseline;height:1cap";

  probe.appendChild(baselineSpan);
  probe.appendChild(capSpan);
  document.body.appendChild(probe);

  let offsetEm = 0;
  try {
    const probeRect = probe.getBoundingClientRect();
    const lineBox = probeRect.height;
    if (lineBox > 0) {
      // Géométrie du strut : baseline − lineBoxTop = L/2 + (ascent − descent)/2.
      const halfAsymRatio =
        (baselineSpan.getBoundingClientRect().top - probeRect.top) / lineBox - 0.5;
      const capRatio = capSpan.getBoundingClientRect().height / lineBox;

      // Ratios × L pour repasser en em (L = PROBE_LINE_HEIGHT em, posé ci-dessus).
      const capHeightEm = capRatio * PROBE_LINE_HEIGHT;
      const halfAscentDescentEm = halfAsymRatio * PROBE_LINE_HEIGHT;

      if (Number.isFinite(capHeightEm) && capHeightEm > 0 && Number.isFinite(halfAscentDescentEm)) {
        const raw = capHeightEm / 2 - halfAscentDescentEm;
        const clamped = Math.max(-MAX_OFFSET_EM, Math.min(MAX_OFFSET_EM, raw));
        offsetEm = Math.round(clamped * 10_000) / 10_000;
      }
    }
  } catch {
    offsetEm = 0;
  } finally {
    probe.remove();
  }

  return offsetEm;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const cache = new Map<string, number>();
let cacheVersion = -1;

/**
 * Décalage optique d'une police, mémorisé.
 *
 * @param version Compteur d'invalidation des métriques (côté builder :
 *                `fontMetricsVersion`, incrémenté sur `document.fonts.ready` et
 *                `loadingdone`). Un changement vide le cache : une mesure faite
 *                avant que la police soit chargée serait celle du fallback.
 */
export function getFontOpticalOffsetEm(font: FontOpticalKey, version = 0): number {
  if (version !== cacheVersion) {
    cache.clear();
    cacheVersion = version;
  }
  const key = `${font.fontFamily}|${font.fontWeight}|${font.fontStyle}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const measured = measureFontOpticalOffsetEm(font);
  cache.set(key, measured);
  return measured;
}

/** Vide le cache. Réservé aux tests. */
export function clearFontOpticalCache(): void {
  cache.clear();
  cacheVersion = -1;
}

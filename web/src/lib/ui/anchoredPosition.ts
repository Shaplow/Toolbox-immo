/**
 * Géométrie d'un popover ancré à un déclencheur — calcul pur, sans DOM.
 *
 * Extrait de `components/ui/useAnchoredPosition` pour être testable : la suite
 * unitaire tourne sans navigateur, et c'est précisément ce calcul qui portait
 * le bug des listes « qui s'ouvrent bien plus haut que le champ ».
 *
 * LE BUG, pour qu'il ne revienne pas : en bascule vers le haut, le popover
 * était posé à `trigger.top - gap - maxHeight`, avec l'**estimation** fournie
 * par l'appelant. Comme un popover se dessine vers le BAS depuis son `top`, il
 * flottait d'exactement `maxHeight - hauteurRéelle` pixels au-dessus du champ.
 * Un Select à 3 options (~98 px) déclaré `maxHeight: 288` s'affichait ~190 px
 * trop haut. `maxHeight` n'est donc plus qu'un REPLI, utilisé tant que le
 * portail n'est pas monté et que la hauteur réelle est inconnue.
 *
 * Les coordonnées d'entrée sont celles du viewport (`getBoundingClientRect`) ;
 * la sortie est en coordonnées document (scroll ajouté), parce que les popovers
 * sont rendus en `position: absolute` — cf. le commentaire du hook.
 */

/** Marge minimale entre le popover et le bord de la fenêtre. */
export const VIEWPORT_MARGIN = 8;

export type AnchorAlign = "start" | "end" | "center";

/** `DOMRect` aplati : seuls les champs dont le calcul se sert. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface AnchoredGeometryInput {
  trigger: AnchorRect;
  /** `null` tant que le portail n'est pas monté : la taille est inconnue. */
  popover: PopoverSize | null;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  /** Hauteur estimée, repli tant que la vraie n'est pas mesurable. */
  maxHeight: number;
  gap: number;
  preferTop: boolean;
  align: AnchorAlign;
}

export interface AnchoredGeometry {
  top: number;
  left: number;
  /** Largeur du déclencheur — pour les popovers qui s'y calent (Select). */
  width: number;
}

export function computeAnchoredPosition({
  trigger,
  popover,
  viewport,
  scroll,
  maxHeight,
  gap,
  preferTop,
  align,
}: AnchoredGeometryInput): AnchoredGeometry {
  // La hauteur réelle dès qu'elle existe, l'estimation sinon. Un popover
  // mesuré à 0 (contenu vide, pas encore peint) retombe aussi sur l'estimation
  // plutôt que de se coller au déclencheur.
  const height = popover?.height || maxHeight;
  const width = popover?.width ?? 0;

  // ─── Vertical ───────────────────────────────────────────────────────────
  const needed = height + gap;
  const spaceBelow = viewport.height - trigger.bottom;
  const spaceAbove = trigger.top;

  const flipUp = preferTop
    ? spaceAbove > needed || spaceAbove > spaceBelow
    : spaceBelow < needed && spaceAbove > spaceBelow;

  let top = flipUp ? trigger.top - gap - height : trigger.bottom + gap;

  // Bornage volontairement ASYMÉTRIQUE : on empêche le popover de sortir par le
  // haut, on ne le remonte JAMAIS pour le faire tenir par le bas. Un bornage
  // symétrique (comme sur l'axe horizontal) tirerait un popover ouvert vers le
  // bas par-dessus son propre déclencheur — soit exactement le symptôme qu'on
  // corrige. Un popover trop grand déborde donc par le bas : il porte sa propre
  // contrainte `max-h-*` et défile à l'intérieur.
  top = Math.max(top, VIEWPORT_MARGIN);

  // ─── Horizontal ─────────────────────────────────────────────────────────
  // `end` et `center` ont besoin de la largeur réelle : au premier passage elle
  // vaut 0 et on retombe sur `start`, corrigé dès la re-mesure. Sans ce repli,
  // un popover non mesuré partirait à gauche de son déclencheur.
  let left = trigger.left;
  if (width) {
    if (align === "end") left = trigger.right - width;
    else if (align === "center") left = trigger.left + trigger.width / 2 - width / 2;

    const maxLeft = Math.max(viewport.width - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft);
  }

  return { top: top + scroll.y, left: left + scroll.x, width: trigger.width };
}

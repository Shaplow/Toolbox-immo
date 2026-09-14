"use client";

/**
 * Positionnement d'un popover ancré à un déclencheur, rendu dans un portail.
 *
 * Pourquoi un portail plutôt qu'un simple `z-index` : une liste en
 * `position: absolute` reste enfant de son conteneur, donc **coupée** par tout
 * ancêtre en `overflow: hidden` — c'est le cas de `Section` (rounded-2xl +
 * overflow-hidden), des cartes et des panneaux scrollables. Aucun z-index ne
 * répare un clipping ; seul un portail vers `document.body` en sort.
 *
 * Coordonnées **absolues** (rect + scrollX/Y) et non `fixed` : un ancêtre avec
 * `transform`/`filter`/`backdrop-filter` crée un containing block qui casse
 * `position: fixed`, ce qui reproduirait le bug ailleurs.
 *
 * Ce module ne fait plus que le câblage React : mesurer, écouter, rejouer. Le
 * calcul lui-même vit dans `lib/ui/anchoredPosition` — pur, donc testable sans
 * navigateur, ce qui manquait quand il portait le bug du popover qui flotte
 * au-dessus de son champ.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Z } from "@/lib/ui/zIndex";
import {
  computeAnchoredPosition,
  type AnchorAlign,
  type AnchoredGeometry,
} from "@/lib/ui/anchoredPosition";

export type AnchoredPosition = AnchoredGeometry;

interface Options {
  /**
   * Hauteur estimée du popover. Sert de REPLI tant que le portail n'est pas
   * monté — dès que la hauteur réelle est mesurable, c'est elle qui décide du
   * retournement et du placement.
   */
  maxHeight?: number;
  /** Espace entre le déclencheur et le popover. */
  gap?: number;
  /** Ouvre vers le haut par défaut (le retournement reste automatique). */
  preferTop?: boolean;
  /**
   * `end` aligne le bord droit du popover sur celui du déclencheur,
   * `center` centre les deux (tooltips, badges d'aide).
   */
  align?: AnchorAlign;
  /**
   * Popover monté, pour mesurer sa taille réelle.
   *
   * **À passer systématiquement.** Sans lui, le popover reste positionné sur
   * l'estimation `maxHeight` : aligné à gauche même en `align: "end"`, non
   * borné dans le viewport, et surtout posé trop haut quand il bascule.
   */
  popoverRef?: RefObject<HTMLElement | null>;
}

/**
 * Étage d'empilement des popovers portalés.
 *
 * Échelle de l'app : cf. `lib/ui/zIndex` (source unique).
 * Un popover portalé quitte le DOM de son dialogue : sans z-index
 * supérieur il se retrouve *sous* le panneau (Drawer = 51) et devient
 * invisible — le clipping est réglé, l'empilement le remplace.
 */
export const POPOVER_Z_INDEX = Z.popover;

export function useAnchoredPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  { maxHeight = 288, gap = 6, preferTop = false, align = "start", popoverRef }: Options = {},
) {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);
  // Dernier `update` en date, pour que l'effet de re-mesure (plus bas) puisse
  // le rejouer sans dupliquer le calcul.
  const updateRef = useRef<() => void>(() => {});

  // Pas de garde `mounted` pour le SSR : `open` vaut false au premier rendu et
  // ne passe à true que sur une interaction, donc toujours côté client.
  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const el = popoverRef?.current;

      const next = computeAnchoredPosition({
        trigger: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        },
        // `null` tant que le portail n'est pas monté : le calcul retombe alors
        // sur `maxHeight`, et la re-mesure ci-dessous corrige avant peinture.
        popover: el ? { width: el.offsetWidth, height: el.offsetHeight } : null,
        viewport: {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        },
        scroll: { x: window.scrollX, y: window.scrollY },
        maxHeight,
        gap,
        preferTop,
        align,
      });

      // Ne remplacer l'objet que si la position change réellement : sans ce
      // test, chaque tick de scroll et chaque notification du ResizeObserver
      // ci-dessous déclencherait un rendu pour rien — et le second pourrait
      // se rappeler lui-même.
      setPosition((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.width === next.width
          ? prev
          : next,
      );
    };

    updateRef.current = update;
    update();

    // `true` en capture : suit aussi le scroll des conteneurs internes.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, triggerRef, maxHeight, gap, preferTop, align, popoverRef]);

  const ready = open && position !== null;

  /**
   * Re-mesure une fois le popover RÉELLEMENT monté.
   *
   * Le premier passage ne peut connaître ni sa largeur ni sa hauteur : il
   * calcule avant que React n'ait monté le portail. Un `requestAnimationFrame`
   * ne suffit pas — React peut committer le portail APRÈS lui, et on relisait
   * alors une taille nulle. Cet effet de layout, lui, est vidé synchronement
   * avant peinture : la correction ne se voit pas.
   *
   * Le ResizeObserver couvre en prime les popovers dont le contenu change
   * pendant qu'ils sont ouverts (liste filtrée à la frappe) — le cas où la
   * hauteur bouge sous les pieds d'un popover déjà retourné.
   */
  useLayoutEffect(() => {
    const el = popoverRef?.current;
    if (!ready || !el) return;
    updateRef.current();
    const observer = new ResizeObserver(() => updateRef.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready, popoverRef]);

  return { position, ready };
}

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
 * Extrait de Combobox, qui résolvait déjà le problème dans son coin ; Select et
 * DropdownMenu partagent désormais la même implémentation.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Z } from "@/lib/ui/zIndex";

export interface AnchoredPosition {
  top: number;
  left: number;
  /** Largeur du déclencheur — pour les popovers qui s'y calent (Select). */
  width: number;
}

interface Options {
  /** Hauteur max estimée du popover — sert à décider du retournement. */
  maxHeight?: number;
  /** Espace entre le déclencheur et le popover. */
  gap?: number;
  /** Ouvre vers le haut par défaut (le retournement reste automatique). */
  preferTop?: boolean;
  /**
   * `end` aligne le bord droit du popover sur celui du déclencheur,
   * `center` centre les deux (tooltips, badges d'aide).
   */
  align?: "start" | "end" | "center";
  /**
   * Popover monté, pour mesurer sa largeur réelle et le maintenir dans le
   * viewport. Sans lui, un menu aligné à droite près du bord gauche de l'écran
   * déborde hors champ.
   */
  popoverRef?: RefObject<HTMLElement | null>;
}

/** Marge minimale entre le popover et le bord de la fenêtre. */
const VIEWPORT_MARGIN = 8;

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
      const viewportWidth = document.documentElement.clientWidth;

      // Vertical : retourne vers le haut quand le bas manque de place et que
      // le haut en a plus — ou d'emblée si l'appelant le préfère.
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipUp = preferTop
        ? rect.top > maxHeight || rect.top > spaceBelow
        : spaceBelow < maxHeight && rect.top > spaceBelow;
      const top = (flipUp ? rect.top - gap - maxHeight : rect.bottom + gap) + window.scrollY;

      // Horizontal : aligné sur le déclencheur, puis ramené dans le viewport
      // dès que la largeur réelle du popover est mesurable (second passage).
      // `end` et `center` ont besoin de la largeur réelle du popover : au
      // premier passage elle vaut 0 et on retombe sur un alignement `start`,
      // corrigé au rAF suivant. Sans ce repli, un popover non mesuré partirait
      // à gauche de son déclencheur.
      const popoverWidth = popoverRef?.current?.offsetWidth ?? 0;
      let left = rect.left;
      if (popoverWidth) {
        if (align === "end") left = rect.right - popoverWidth;
        else if (align === "center") left = rect.left + rect.width / 2 - popoverWidth / 2;
      }
      if (popoverWidth) {
        const maxLeft = Math.max(viewportWidth - popoverWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
        left = Math.min(Math.max(left, VIEWPORT_MARGIN), maxLeft);
      }

      const nextLeft = left + window.scrollX;
      // Ne remplacer l'objet que si la position change réellement : sans ce
      // test, chaque tick de scroll et chaque notification du ResizeObserver
      // ci-dessous déclencherait un rendu pour rien — et le second pourrait
      // se rappeler lui-même.
      setPosition((prev) =>
        prev && prev.top === top && prev.left === nextLeft && prev.width === rect.width
          ? prev
          : { top, left: nextLeft, width: rect.width },
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
   * Le premier passage ne peut pas connaître la largeur du popover : il la
   * calcule avant que React n'ait monté le portail. `align: "end"` et
   * `align: "center"` retombaient donc sur un alignement `start`, et le
   * recadrage viewport ne s'appliquait pas. Un `requestAnimationFrame` ne
   * suffit pas : React peut committer le portail APRÈS lui, et on relisait
   * alors une largeur nulle.
   *
   * Le ResizeObserver couvre en prime les popovers dont le contenu change
   * pendant qu'ils sont ouverts (liste filtrée à la frappe).
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

"use client";

/**
 * useDayDrop — déclare une colonne-jour comme cible de drop pour une SlotCard.
 * `dateIso` au format YYYY-MM-DD ; le handler de drop recompose le scheduledAt.
 */

import { useDroppable } from "@dnd-kit/core";

export function useDayDrop(dateIso: string, opts?: { disabled?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dateIso}`,
    data: { type: "day", dateIso },
    disabled: opts?.disabled,
  });
  return { setNodeRef, isOver };
}

/**
 * useBankDrop — déclare le rail « Banque » comme cible de drop.
 *
 * Le geste inverse exact du glisser-sur-un-jour : lâcher une carte du
 * calendrier ici lui retire sa date. Le rail était jusqu'ici source de drag
 * seulement ; le trajet ne se faisait que dans un sens.
 */
export function useBankDrop(opts?: { disabled?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "bank",
    data: { type: "bank" },
    disabled: opts?.disabled,
  });
  return { setNodeRef, isOver };
}

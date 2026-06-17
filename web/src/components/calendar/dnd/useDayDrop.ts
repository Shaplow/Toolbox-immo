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

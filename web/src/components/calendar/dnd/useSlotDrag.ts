"use client";

/**
 * useSlotDrag — rend une SlotCard draggable via @dnd-kit.
 *
 * `fromBank` distingue un slot tiré du rail banque (Phase 2) d'un slot déjà
 * placé dans la grille semaine — le handler de drop adapte la recomposition de
 * `scheduledAt` selon ce flag.
 */

import { useDraggable } from "@dnd-kit/core";
import type { PublicationSlot } from "@/types/calendar";

export function useSlotDrag(
  slot: PublicationSlot,
  opts?: { disabled?: boolean; fromBank?: boolean },
) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: slot.id,
    data: { type: "slot", slot, fromBank: opts?.fromBank ?? false },
    disabled: opts?.disabled,
  });
  return { attributes, listeners, setNodeRef, isDragging };
}

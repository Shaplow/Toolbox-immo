"use client";

/**
 * CalendarDndContext — wrapper @dnd-kit du calendrier.
 *
 * - PointerSensor avec `activationConstraint.distance: 6` : un clic (sans
 *   mouvement) n'initie PAS de drag, donc le onClick des SlotCard reste intact.
 * - KeyboardSensor pour l'accessibilité (drag au clavier).
 * - DragOverlay : rend une SlotCard fantôme suivant le curseur, bornée à la
 *   fenêtre via restrictToWindowEdges.
 *
 * Le drop est résolu ici : si la cible est une colonne-jour (`type: "day"`),
 * on remonte `onSlotDrop` au CalendarView qui patche le scheduledAt.
 */

import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { SlotCard } from "../SlotCard";
import type { PublicationSlot } from "@/types/calendar";
import type { UserRole } from "@/types/roles";

export interface SlotDropPayload {
  slotId: string;
  dateIso: string;
  fromBank: boolean;
  slot: PublicationSlot;
}

interface CalendarDndContextProps {
  children: ReactNode;
  onSlotDrop: (payload: SlotDropPayload) => void;
  currentUserRole?: UserRole;
  currentUserId?: string;
}

export function CalendarDndContext({
  children,
  onSlotDrop,
  currentUserRole,
  currentUserId,
}: CalendarDndContextProps) {
  const [activeSlot, setActiveSlot] = useState<PublicationSlot | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as
      | { slot?: PublicationSlot }
      | undefined;
    if (data?.slot) setActiveSlot(data.slot);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveSlot(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | { slot?: PublicationSlot; fromBank?: boolean }
      | undefined;
    const overData = over.data.current as
      | { type?: string; dateIso?: string }
      | undefined;
    if (overData?.type !== "day" || !overData.dateIso) return;
    if (!activeData?.slot) return;
    onSlotDrop({
      slotId: String(active.id),
      dateIso: overData.dateIso,
      fromBank: Boolean(activeData.fromBank),
      slot: activeData.slot,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToWindowEdges]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveSlot(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeSlot ? (
          <div className="w-[220px] rotate-1 opacity-90 shadow-lg">
            <SlotCard
              slot={activeSlot}
              onClick={() => {}}
              currentUserRole={currentUserRole}
              currentUserId={currentUserId}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

"use client";

/**
 * BankRail — rail latéral repliable affiché en vue semaine (ADMIN).
 *
 * Liste les contenus de banque « prêts à programmer », draggables directement
 * vers une colonne-jour de la grille (le drop pose le scheduledAt). Comme la
 * vue semaine et la vue banque sont mutuellement exclusives, ce rail est le
 * seul endroit où un vrai drag banque→jour est possible.
 *
 * Composant présentational : les slots + le loading sont possédés par
 * CalendarView (qui les charge via /api/calendar/slots?bank=only et les retire
 * du rail après un drop réussi). Un clic (sans drag) sur un item ouvre le
 * ScheduleFromBankModal en repli.
 */

import { Inbox, X, GripVertical, CalendarClock } from "lucide-react";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { STATUS_LABELS, type PublicationSlot } from "@/types/calendar";
import { getPublicationPhase, PHASE_COLORS } from "@/lib/slots/phase";
import { useSlotDrag } from "./dnd/useSlotDrag";

interface BankRailProps {
  slots: PublicationSlot[];
  loading: boolean;
  onClose: () => void;
  onScheduleSlot: (slot: PublicationSlot) => void;
}

export function BankRail({ slots, loading, onClose, onScheduleSlot }: BankRailProps) {
  return (
    <aside className="w-64 shrink-0 flex flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Inbox size={14} className="text-muted-foreground" />
        <span className="text-[12px] font-semibold text-foreground">
          Banque · prêts
        </span>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {slots.length}
        </span>
        <ButtonIcon
          icon={X}
          label="Fermer le rail banque"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="ml-auto"
        />
      </header>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[70vh]">
        {loading ? (
          <>
            <div className="h-14 rounded-md bg-muted animate-pulse" />
            <div className="h-14 rounded-md bg-muted animate-pulse" />
          </>
        ) : slots.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
            Aucun contenu prêt à programmer.
          </p>
        ) : (
          slots.map((slot) => (
            <BankRailItem
              key={slot.id}
              slot={slot}
              onSchedule={() => onScheduleSlot(slot)}
            />
          ))
        )}
      </div>

      {!loading && slots.length > 0 && (
        <footer className="px-3 py-1.5 border-t border-border text-[10.5px] text-muted-foreground">
          Glisse un contenu sur un jour pour le programmer.
        </footer>
      )}
    </aside>
  );
}

// ─── BankRailItem ─────────────────────────────────────────────────────────────

function BankRailItem({
  slot,
  onSchedule,
}: {
  slot: PublicationSlot;
  onSchedule: () => void;
}) {
  const { listeners, setNodeRef, isDragging } = useSlotDrag(slot, {
    fromBank: true,
  });
  const phase = getPublicationPhase(slot.status);
  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSchedule}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSchedule();
        }
      }}
      title={`${title} · @${slot.account.handle} — glisser sur un jour ou cliquer pour programmer`}
      className={[
        "group w-full text-left rounded-md border border-border bg-card px-2 py-1.5 cursor-grab touch-none transition-colors",
        "hover:bg-muted hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isDragging ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-1.5">
        <GripVertical size={12} className="text-muted-foreground/60 shrink-0" />
        <p className="text-[12.5px] font-medium text-foreground truncate flex-1 leading-tight">
          {title}
        </p>
        <CalendarClock
          size={12}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0"
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-1.5 pl-[18px]">
        <span className="text-[10.5px] text-muted-foreground truncate">
          @{slot.account.handle}
        </span>
        <Chip className={`${PHASE_COLORS[phase]} text-[9.5px] shrink-0`}>
          {STATUS_LABELS[slot.status]}
        </Chip>
      </div>
    </div>
  );
}

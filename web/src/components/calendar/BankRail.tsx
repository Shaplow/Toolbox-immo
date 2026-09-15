"use client";

/**
 * BankRail — la BANQUE, rail latéral de la vue semaine (ADMIN).
 *
 * Avant, deux portes menaient au même endroit : l'onglet « Missions » (vue
 * plein écran) et ce rail, filtré aux seuls contenus « prêts ». Même requête,
 * même objet — « mission » n'a jamais été qu'un mot d'écran, il n'existe aucun
 * champ en base. Il ne reste qu'une porte, et elle montre TOUT le backlog.
 *
 * Pourquoi tout, y compris ce qui n'est pas prêt : « l'admin doit déjà pouvoir
 * les placer sur le calendrier pour pré-programmer ». Rien ne s'y opposait
 * côté serveur — poser une date ne change pas le statut et aucune garde ne lie
 * les deux ; le verrou était ici, dans un filtre d'affichage.
 *
 * Composant présentational : les slots et le chargement sont possédés par
 * CalendarView, qui les retire du rail après un drop réussi.
 */

import { useMemo, useState } from "react";
import {
  Inbox,
  X,
  GripVertical,
  CalendarClock,
  CheckSquare,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { STATUS_LABELS, type PublicationSlot } from "@/types/calendar";
import { getPublicationPhase, PHASE_COLORS } from "@/lib/slots/phase";
import { isReadyToSchedule } from "@/lib/slots/bankReady";
import { BANK_GROUP_BG, partitionBank } from "@/lib/slots/bankGroups";
import { BulkScheduleModal } from "./BulkScheduleModal";
import { useSlotDrag } from "./dnd/useSlotDrag";
import { useBankDrop } from "./dnd/useDayDrop";

interface BankRailProps {
  slots: PublicationSlot[];
  loading: boolean;
  onClose: () => void;
  onScheduleSlot: (slot: PublicationSlot) => void;
  /** Programmation en lot réussie — l'appelant recharge. */
  onBulkScheduled?: (count: number) => void;
}

export function BankRail({
  slots,
  loading,
  onClose,
  onScheduleSlot,
  onBulkScheduled,
}: BankRailProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const { groups, rest } = useMemo(() => partitionBank(slots), [slots]);
  const readyCount = useMemo(() => slots.filter(isReadyToSchedule).length, [slots]);
  // En sélection multiple le pointeur sert déjà à cocher : accepter un drop
  // par-dessus mélangerait deux gestes sur le même appui.
  const { setNodeRef: setDropRef, isOver } = useBankDrop({ disabled: selectMode });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  return (
    <aside
      ref={setDropRef}
      className={`w-64 shrink-0 flex flex-col rounded-lg border bg-card transition-colors ${
        isOver ? "border-primary ring-2 ring-primary/25" : "border-border"
      }`}
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Inbox size={14} className="text-muted-foreground" />
        <span className="text-[12px] font-semibold text-foreground">Banque</span>
        <span
          className="text-[11px] font-mono tabular-nums text-muted-foreground"
          title={`${slots.length} en banque · ${readyCount} prête${readyCount > 1 ? "s" : ""}`}
        >
          {slots.length}
          {readyCount > 0 && <span className="opacity-60"> · {readyCount}</span>}
        </span>
        <ButtonIcon
          icon={X}
          label="Fermer la banque"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="ml-auto"
        />
      </header>

      {slots.length > 1 && !loading && (
        <div className="px-2 py-1.5 border-b border-border">
          <Chip
            size="sm"
            selected={selectMode}
            icon={selectMode ? CheckSquare : Square}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedIds(new Set());
            }}
          >
            Sélection multiple
          </Chip>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-3 max-h-[70vh]">
        {loading ? (
          <>
            <div className="h-14 rounded-md bg-muted animate-pulse" />
            <div className="h-14 rounded-md bg-muted animate-pulse" />
          </>
        ) : slots.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
            La banque est vide.
          </p>
        ) : (
          <>
            {groups.map(({ group, slots: groupSlots }) =>
              groupSlots.length === 0 ? null : (
                <section key={group.key} className="space-y-1.5">
                  <header
                    className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${BANK_GROUP_BG[group.key]}`}
                    title={group.hint}
                  >
                    <span className="text-[10.5px] font-semibold text-foreground truncate">
                      {group.label}
                    </span>
                    <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground">
                      {groupSlots.length}
                    </span>
                  </header>
                  {groupSlots.map((slot) => (
                    <BankRailItem
                      key={slot.id}
                      slot={slot}
                      selectMode={selectMode}
                      selected={selectedIds.has(slot.id)}
                      onToggleSelect={() => toggleSelect(slot.id)}
                      onSchedule={() => onScheduleSlot(slot)}
                    />
                  ))}
                </section>
              ),
            )}
            {/* Hors taxonomie (une annulée restée sans date, par exemple) : la
                banque montre tout ce qu'elle contient, sinon elle ment. */}
            {rest.length > 0 && (
              <section className="space-y-1.5">
                <header className="flex items-center gap-1.5 rounded px-1.5 py-1 bg-muted">
                  <span className="text-[10.5px] font-semibold text-foreground">Autres</span>
                  <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground">
                    {rest.length}
                  </span>
                </header>
                {rest.map((slot) => (
                  <BankRailItem
                    key={slot.id}
                    slot={slot}
                    selectMode={selectMode}
                    selected={selectedIds.has(slot.id)}
                    onToggleSelect={() => toggleSelect(slot.id)}
                    onSchedule={() => onScheduleSlot(slot)}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {selectMode && selectedIds.size > 0 ? (
        <footer className="px-2 py-2 border-t border-border space-y-1.5">
          <Button
            variant="primary"
            size="sm"
            icon={CalendarClock}
            className="w-full"
            onClick={() => setBulkOpen(true)}
          >
            Programmer {selectedIds.size}
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            className="w-full text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            Annuler la sélection
          </button>
        </footer>
      ) : (
        !loading &&
        slots.length > 0 && (
          <footer className="px-3 py-1.5 border-t border-border text-[10.5px] text-muted-foreground">
            Glisse une publication sur un jour pour la programmer.
          </footer>
        )
      )}

      {bulkOpen && (
        <BulkScheduleModal
          slotIds={[...selectedIds]}
          onScheduled={(count) => {
            onBulkScheduled?.(count);
            clearSelection();
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </aside>
  );
}

// ─── BankRailItem ─────────────────────────────────────────────────────────────

function BankRailItem({
  slot,
  selectMode,
  selected,
  onToggleSelect,
  onSchedule,
}: {
  slot: PublicationSlot;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSchedule: () => void;
}) {
  // En sélection, on ne glisse plus : les deux gestes partent du même appui et
  // se disputeraient le pointeur.
  const { listeners, setNodeRef, isDragging } = useSlotDrag(slot, {
    fromBank: true,
    disabled: selectMode,
  });
  const phase = getPublicationPhase(slot.status);
  const title = slot.pattern?.label ?? slot.title ?? "Publication";
  const ready = isReadyToSchedule(slot);

  return (
    <div
      ref={setNodeRef}
      {...(selectMode ? {} : listeners)}
      role="button"
      tabIndex={0}
      onClick={selectMode ? onToggleSelect : onSchedule}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectMode) onToggleSelect();
          else onSchedule();
        }
      }}
      title={`${title} · ${slot.account ? `@${slot.account.handle}` : "Sans compte"} — ${
        selectMode ? "cliquer pour sélectionner" : "glisser sur un jour ou cliquer pour programmer"
      }`}
      className={[
        "group w-full text-left rounded-md border bg-card px-2 py-1.5 touch-none transition-colors",
        selectMode ? "cursor-pointer" : "cursor-grab",
        // Ce qui est livrable se repère sans lire : la bordure d'accent remplace
        // le filtre qui masquait tout le reste.
        selected
          ? "border-primary ring-1 ring-primary/30"
          : ready
            ? "border-info-200"
            : "border-border",
        "hover:bg-muted hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isDragging ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-1.5">
        {selectMode ? (
          selected ? (
            <CheckSquare size={12} className="text-primary shrink-0" />
          ) : (
            <Square size={12} className="text-muted-foreground/60 shrink-0" />
          )
        ) : (
          <GripVertical size={12} className="text-muted-foreground/60 shrink-0" />
        )}
        <p className="text-[12.5px] font-medium text-foreground truncate flex-1 leading-tight">
          {title}
        </p>
        {!selectMode && (
          <CalendarClock
            size={12}
            className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0"
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-1.5 pl-[18px]">
        <span className="text-[10.5px] text-muted-foreground truncate">
          {slot.account ? `@${slot.account.handle}` : "Sans compte"}
        </span>
        <Chip className={`${PHASE_COLORS[phase]} text-[9.5px] shrink-0`}>
          {STATUS_LABELS[slot.status]}
        </Chip>
      </div>
    </div>
  );
}

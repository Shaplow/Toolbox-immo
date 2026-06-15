"use client";

/**
 * BankView — vue Banque de contenus (slots stockés sans date programmée).
 *
 * Cas d'usage : l'admin a créé des missions en banque (bulk-stock) ; le monteur
 * les remplit progressivement. Ici on visualise tous les contenus banque,
 * groupés par état, avec une action "Programmer" sur les contenus prêts.
 *
 * Groupes (ordre d'affichage) :
 *  1. "Prêts à programmer" — EDIT_APPROVED, READY_FOR_CM, CAPTIONS_PENDING.
 *  2. "En attente de validation admin" — EDIT_REVIEW.
 *  3. "En montage" — IN_EDIT, RUSHES_RECEIVED.
 *  4. "À démarrer" — RUSHES_EXPECTED, PLANNED, DRAFT.
 *  5. "Validation client" — AWAITING_CLIENT, CLIENT_REVISION (rare ici, mais possible).
 *
 * Click sur une card → SlotDetailPanel (drawer). Bouton "Programmer" visible
 * uniquement quand le slot a un currentVersionId et qu'il est dans le groupe 1.
 */

import { useMemo, useState } from "react";
import { CalendarClock, Inbox, ChevronRight, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";
import { STATUS_LABELS, type PublicationSlot, type SlotStatus } from "@/types/calendar";
import { getPublicationPhase, PHASE_COLORS } from "@/lib/slots/phase";
import { BulkScheduleModal } from "./BulkScheduleModal";

interface BankViewProps {
  slots: PublicationSlot[];
  loading: boolean;
  onOpenSlot: (slot: PublicationSlot) => void;
  onScheduleSlot: (slot: PublicationSlot) => void;
  /** Sprint B — callback appelé après une programmation en lot. */
  onBulkScheduled?: (scheduledCount: number) => void;
}

/** Slot considéré "prêt à programmer" : a un montage courant ET status finalisable. */
function isReadyToSchedule(slot: PublicationSlot): boolean {
  if (!slot.currentVersionId) return false;
  return (
    slot.status === "EDIT_APPROVED" ||
    slot.status === "READY_FOR_CM" ||
    slot.status === "CAPTIONS_PENDING"
  );
}

interface Group {
  key: string;
  label: string;
  hint: string;
  statuses: SlotStatus[];
  variant: "ready" | "review" | "wip" | "todo";
}

// 4 groupes en v1 (scope manual_rushes). Le groupe "Validation client" a été
// retiré : AWAITING_CLIENT/CLIENT_REVISION sont rares hors workflow client
// complet et créaient une section structurellement vide dans le backlog.
const GROUPS: Group[] = [
  {
    key: "ready",
    label: "Prêts à programmer",
    hint: "Montage validé — il ne manque qu'une date.",
    statuses: ["EDIT_APPROVED", "READY_FOR_CM", "CAPTIONS_PENDING"],
    variant: "ready",
  },
  {
    key: "review",
    label: "En attente de validation admin",
    hint: "Une nouvelle version a été livrée.",
    statuses: ["EDIT_REVIEW"],
    variant: "review",
  },
  {
    key: "wip",
    label: "En montage",
    hint: "Le monteur est sur le coup.",
    statuses: ["IN_EDIT", "RUSHES_RECEIVED"],
    variant: "wip",
  },
  {
    key: "todo",
    label: "À démarrer",
    hint: "Mission créée — en attente d'action.",
    statuses: ["RUSHES_EXPECTED", "PLANNED", "DRAFT", "TO_DO"],
    variant: "todo",
  },
];

const GROUP_BG: Record<Group["variant"], string> = {
  ready:
    "bg-gradient-to-b from-sky-50/80 to-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(56,148,200,0.18)]",
  review:
    "bg-gradient-to-b from-peach-50/80 to-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,140,90,0.18)]",
  wip: "bg-gradient-to-b from-stone-50/80 to-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(120,113,108,0.12)]",
  todo: "bg-gradient-to-b from-white/60 to-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]",
};

interface PartitionedGroups {
  group: Group;
  slots: PublicationSlot[];
}

export function BankView({
  slots,
  loading,
  onOpenSlot,
  onScheduleSlot,
  onBulkScheduled,
}: BankViewProps) {
  // Sprint B — sélection multiple sur le groupe "ready" pour programmer en lot.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // V8 Phase 6 — Collapse manuel des groupes (auto-replié si <3 items, sauf
  // "ready" qui demande toujours action). Toggle au click sur le header.
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set());
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());

  const groupedSlots = useMemo<PartitionedGroups[]>(() => {
    return GROUPS.map((g) => ({
      group: g,
      slots: slots.filter((s) => (g.statuses as readonly string[]).includes(s.status)),
    })).filter((g) => g.slots.length > 0);
  }, [slots]);

  function toggleSelect(slotId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  if (loading && slots.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white/40 p-6 h-32 animate-pulse shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
          />
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Aucun contenu en banque"
        description="Crée des missions sans date depuis le bouton « Nouvelles missions » — elles apparaîtront ici pendant la production."
      />
    );
  }

  return (
    <div className="space-y-5 pb-24">
      {groupedSlots.map(({ group, slots: groupSlots }) => {
        const isReady = group.variant === "ready";
        // V8 Phase 6 — Auto-collapse si <3 items, sauf "ready" (action-critique).
        const autoCollapsed = !isReady && groupSlots.length < 3;
        const isCollapsed = manuallyCollapsed.has(group.key)
          ? true
          : manuallyExpanded.has(group.key)
            ? false
            : autoCollapsed;
        const toggleCollapse = () => {
          if (isCollapsed) {
            setManuallyExpanded((s) => {
              const next = new Set(s);
              next.add(group.key);
              return next;
            });
            setManuallyCollapsed((s) => {
              const next = new Set(s);
              next.delete(group.key);
              return next;
            });
          } else {
            setManuallyCollapsed((s) => {
              const next = new Set(s);
              next.add(group.key);
              return next;
            });
            setManuallyExpanded((s) => {
              const next = new Set(s);
              next.delete(group.key);
              return next;
            });
          }
        };
        return (
          <section
            key={group.key}
            className={`rounded-2xl backdrop-blur-[8px] p-5 ${GROUP_BG[group.variant]}`}
          >
            <header
              className="flex items-baseline justify-between gap-3 mb-4 cursor-pointer select-none"
              onClick={toggleCollapse}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCollapse();
                }
              }}
              aria-expanded={!isCollapsed}
              title={isCollapsed ? "Déplier" : "Replier"}
            >
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-gray-950 leading-tight inline-flex items-center gap-1.5">
                  {group.label}
                  <span className={`text-[10px] text-gray-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`}>
                    ▾
                  </span>
                </h2>
                <p className="mt-0.5 text-[11.5px] text-gray-600">{group.hint}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isReady && groupSlots.length > 1 && (
                  <Chip
                    variant={selectMode ? "sky" : "default"}
                    size="sm"
                    selected={selectMode}
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelectedIds(new Set());
                    }}
                    icon={selectMode ? CheckSquare : Square}
                  >
                    Sélection multiple
                  </Chip>
                )}
                <span className="text-[11px] font-mono tabular-nums text-gray-500">
                  {groupSlots.length} contenu{groupSlots.length > 1 ? "s" : ""}
                </span>
              </div>
            </header>
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {groupSlots.map((slot) => (
                  <BankCard
                    key={slot.id}
                    slot={slot}
                    showSchedule={isReady && !selectMode}
                    selectMode={isReady && selectMode}
                    selected={selectedIds.has(slot.id)}
                    onOpen={() => onOpenSlot(slot)}
                    onSchedule={() => onScheduleSlot(slot)}
                    onToggleSelect={() => toggleSelect(slot.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Sprint B — barre d'action fixe pour programmer en lot. */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-gray-950 text-white shadow-[0_8px_24px_-4px_rgba(15,23,42,0.45)]">
          <span className="text-[12px] font-medium tabular-nums">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={CalendarClock}
            onClick={() => setBulkOpen(true)}
          >
            Programmer en lot
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            className="text-white hover:bg-white/10"
          >
            Annuler
          </Button>
        </div>
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
    </div>
  );
}

// ─── BankCard ───────────────────────────────────────────────────────────────

interface BankCardProps {
  slot: PublicationSlot;
  showSchedule: boolean;
  /** Sprint B — mode multi-select actif (rendu checkbox + bind click). */
  selectMode?: boolean;
  /** Sprint B — la card est-elle dans le set sélectionné ? */
  selected?: boolean;
  onOpen: () => void;
  onSchedule: () => void;
  /** Sprint B — toggle de la sélection (clic card en mode select). */
  onToggleSelect?: () => void;
}

function BankCard({
  slot,
  showSchedule,
  selectMode = false,
  selected = false,
  onOpen,
  onSchedule,
  onToggleSelect,
}: BankCardProps) {
  const phase = getPublicationPhase(slot.status);
  const phaseClasses = PHASE_COLORS[phase];
  const title = slot.pattern?.label ?? slot.title ?? "Publication";
  const monteurName = slot.assigneeMonteur?.name ?? null;
  const updatedAt = new Date(slot.updatedAt);
  const canSchedule = showSchedule && isReadyToSchedule(slot);

  return (
    <article
      className={`group relative rounded-xl bg-white px-4 py-3.5 transition-shadow ${
        selected
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(56,148,200,0.6),0_4px_12px_rgba(56,148,200,0.18)]"
          : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.14)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_8px_rgba(15,23,42,0.06),0_12px_28px_-12px_rgba(15,23,42,0.22)]"
      }`}
    >
      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpen}
        className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label={selectMode ? `Sélectionner ${title}` : `Ouvrir ${title}`}
      />

      {selectMode && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${
              selected ? "bg-sky-600 text-white" : "bg-white border border-gray-300"
            }`}
          >
            {selected ? <CheckSquare size={14} /> : null}
          </span>
        </div>
      )}

      <div className="relative pointer-events-none">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-gray-950 truncate leading-tight">
              {title}
            </p>
            <p className="mt-0.5 text-[11.5px] text-gray-500 truncate">
              @{slot.account.handle}
            </p>
          </div>
          <Chip className={`${phaseClasses} text-[10px] shrink-0`}>
            {STATUS_LABELS[slot.status]}
          </Chip>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[10.5px] text-gray-500">
          <span className="truncate">
            {monteurName ? `Monteur · ${monteurName}` : "Sans monteur"}
          </span>
          <span className="font-mono tabular-nums shrink-0">
            {updatedAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
          </span>
        </div>
      </div>

      {canSchedule && (
        <div className="relative mt-3 flex items-center justify-end gap-2 pointer-events-auto">
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={CalendarClock}
            onClick={onSchedule}
          >
            Programmer
          </Button>
        </div>
      )}
      {!canSchedule && (
        <div className="relative mt-3 flex items-center justify-end text-[11px] text-gray-400 pointer-events-none">
          <span>Ouvrir la fiche</span>
          <ChevronRight size={12} className="ml-0.5" />
        </div>
      )}
    </article>
  );
}

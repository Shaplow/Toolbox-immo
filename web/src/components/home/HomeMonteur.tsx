import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorklistSection } from "./WorklistSection";
import type { WorklistSlotBadges } from "./WorklistSlotCard";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import {
  getMonteurSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  TERMINAL_STATUSES,
} from "@/types/worklist";

// Statuts à inclure dans la worklist Monteur (DRAFT exclu intentionnellement).
const MONTEUR_STATUSES: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
];

interface HomeMonteurProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeMonteur({ userId, userName }: HomeMonteurProps) {
  const now = new Date();
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();

  const rawSlots = await prisma.publicationSlot.findMany({
    where: {
      assigneeMonteurId: userId,
      status: { in: MONTEUR_STATUSES },
    },
    include: {
      account: {
        select: { id: true, handle: true, name: true },
      },
      pattern: {
        select: { label: true },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  // Cast Prisma result → WorklistSlot (scheduledAt est un Date côté Prisma).
  const slots: WorklistSlot[] = rawSlots.map((s) => ({
    id: s.id,
    title: s.title,
    scheduledAt: s.scheduledAt,
    status: s.status as SlotStatus,
    notes: s.notes,
    assigneeMonteurId: s.assigneeMonteurId,
    assigneeCmId: s.assigneeCmId,
    patternId: s.patternId,
    account: s.account,
    pattern: s.pattern,
  }));

  // ── Badges contextuels monteur ─────────────────────────────────────────────
  // Fetch la dernière version non-deleted pour les slots EDIT_REVIEW,
  // afin d'afficher "V{n} en attente validation".
  const editReviewSlotIds = slots
    .filter((s) => s.status === "EDIT_REVIEW")
    .map((s) => s.id);

  const latestVersionsBySlot = new Map<string, number>();
  if (editReviewSlotIds.length > 0) {
    const latestVersions = await prisma.publicationVersion.findMany({
      where: {
        slotId: { in: editReviewSlotIds },
        deletedAt: null,
      },
      select: { slotId: true, versionNumber: true },
      orderBy: { versionNumber: "desc" },
    });
    // Garder seulement le max par slot
    for (const v of latestVersions) {
      if (!latestVersionsBySlot.has(v.slotId)) {
        latestVersionsBySlot.set(v.slotId, v.versionNumber);
      }
    }
  }

  const monteurBadgesMap = new Map<string, WorklistSlotBadges>();
  for (const slot of slots) {
    const badges: WorklistSlotBadges = {};
    if (slot.status === "RUSHES_RECEIVED") {
      badges.hasNewRushes = true;
    }
    if (slot.status === "EDIT_REVIEW") {
      const vn = latestVersionsBySlot.get(slot.id);
      badges.versionPendingNumber = vn ?? null;
    }
    if (badges.hasNewRushes || badges.versionPendingNumber !== undefined) {
      monteurBadgesMap.set(slot.id, badges);
    }
  }

  // ── Découpe en sections ────────────────────────────────────────────────────

  /** En retard : dans le passé, statut non-terminal, exclu "waiting" (déjà fait côté monteur) */
  const overdue = slots.filter(
    (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s.status) && s.scheduledAt < now
  );

  /** À monter / En cours : dans la semaine courante OU sans date dépassée, sections todo/in_progress */
  const nonOverdue = slots.filter((s) => !isSlotOverdue(s));

  const thisWeekTodo = nonOverdue.filter(
    (s) => {
      const section = getMonteurSection(s.status);
      return (section === "todo" || section === "in_progress") &&
        s.scheduledAt >= weekMonday && s.scheduledAt <= weekSunday;
    }
  );

  const upcoming = nonOverdue.filter(
    (s) => {
      const section = getMonteurSection(s.status);
      return (section === "todo" || section === "in_progress") &&
        s.scheduledAt > weekSunday;
    }
  );

  const waiting = slots.filter((s) => getMonteurSection(s.status) === "waiting");

  const totalActive = overdue.length + thisWeekTodo.length + upcoming.length;
  const isFullyEmpty = totalActive === 0 && waiting.length === 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalActive === 0
              ? "Aucune publication en cours."
              : `${totalActive} publication${totalActive > 1 ? "s" : ""} active${totalActive > 1 ? "s" : ""}`}
          </p>
        </div>

      </div>

      {isFullyEmpty ? (
        <EmptyState
          icon={CheckCircle2}
          title="Rien à monter pour le moment"
          description="Ta file est vide. Bonne pause — les prochaines publications arriveront via le calendrier."
        />
      ) : (
        <>
      {/* Section En retard */}
      {overdue.length > 0 && (
        <WorklistSection
          title="En retard"
          slots={overdue}
          mode="monteur"
          tone="danger"
          monteurBadgesMap={monteurBadgesMap}
        />
      )}

      {/* Section Cette semaine */}
      <WorklistSection
        title="Cette semaine"
        slots={thisWeekTodo}
        mode="monteur"
        tone="default"
        emptyMessage="Aucune publication à monter cette semaine."
        monteurBadgesMap={monteurBadgesMap}
      />

      {/* Section À venir (collapsable) */}
      <WorklistSection
        title="À venir"
        slots={upcoming}
        mode="monteur"
        tone="muted"
        collapsible
        defaultOpen={false}
        monteurBadgesMap={monteurBadgesMap}
      />

      {/* Section Mes envois en attente — informatif */}
      {waiting.length > 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-600">
              Mes envois en attente client
            </h3>
            <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {waiting.length}
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Ces publications ont quitté ta file. Le CM ou le client prend la main.
          </p>
          <div className="space-y-2">
            {waiting.map((slot) => (
              <div
                key={slot.id}
                className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">
                    {slot.pattern?.label ?? slot.title ?? "Publication"}
                  </p>
                  <p className="text-[11px] text-gray-400">@{slot.account.handle}</p>
                </div>
                <span className="text-[11px] text-gray-400 shrink-0">
                  {slot.scheduledAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

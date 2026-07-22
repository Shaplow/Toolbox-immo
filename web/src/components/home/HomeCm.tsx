import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorklistSection } from "./WorklistSection";
import { TodoStrip, type TodoItem } from "./TodoStrip";
import { MiniWeekCalendar, type MiniCalItem } from "./MiniWeekCalendar";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import type { WorklistCmBadges } from "./WorklistSlotCard";
import { getPublicationPhase, PHASE_DOT } from "@/lib/slots/phase";
import {
  getCmSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  getStartOfToday,
  getEndOfToday,
  TERMINAL_STATUSES,
} from "@/types/worklist";

const CM_STATUSES: SlotStatus[] = [
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "AWAITING_CLIENT",
  "CLIENT_REVISION",
  "SCHEDULED",
  "PUBLISHED",
  // Legacy
  "READY",
  "CHECKING",
  "DONE",
];

const PUBLISHED_WINDOW_DAYS = 14;

interface HomeCmProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeCm({ userId, userName }: HomeCmProps) {
  const now = new Date();
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();
  const publishedSince = new Date(now);
  publishedSince.setDate(now.getDate() - PUBLISHED_WINDOW_DAYS);

  const rawSlots = await prisma.publicationSlot.findMany({
    where: {
      assigneeCmId: userId,
      status: { in: CM_STATUSES },
    },
    include: {
      account: { select: { id: true, handle: true, name: true } },
      pattern: { select: { label: true, coverMode: true } },
      render: {
        select: { coverFramePack: { select: { status: true, finalCoverUrl: true } } },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

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

  // ── Découpe en sections ────────────────────────────────────────────────
  // Note : slots en banque (scheduledAt === null) sont exclus des sections
  // datées du CM. À ce stade ils ne le concernent pas (le monteur les remplit
  // avant qu'ils n'arrivent en to_prepare).
  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) &&
      s.status !== "PUBLISHED" &&
      s.scheduledAt != null &&
      s.scheduledAt < now,
  );

  const nonOverdue = slots.filter((s) => !isSlotOverdue(s));

  const toPrepare = nonOverdue.filter((s) => getCmSection(s.status) === "to_prepare");
  const toPublishThisWeek = nonOverdue.filter(
    (s) =>
      getCmSection(s.status) === "to_publish" &&
      s.scheduledAt != null &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday,
  );
  const publishedRecently = slots.filter(
    (s) =>
      s.status === "PUBLISHED" && s.scheduledAt != null && s.scheduledAt >= publishedSince,
  );

  const totalActive = overdue.length + toPrepare.length + toPublishThisWeek.length;
  const isFullyEmpty = totalActive === 0 && publishedRecently.length === 0;

  const CM_STATUS_BADGES: Record<string, WorklistCmBadges> = {
    EDIT_APPROVED: {
      statusLabel: "À sous-titrer",
      statusClasses: "bg-info-50 text-info-700 border border-info-200",
    },
    CAPTIONS_PENDING: {
      statusLabel: "Captions en cours",
      statusClasses: "bg-info-50 text-info-700 border border-info-200",
    },
    READY_FOR_CM: {
      statusLabel: "Prêt à publier",
      statusClasses: "bg-success-50 text-success-700 border border-success-200",
    },
  };

  const COVER_TO_PICK_BADGE: WorklistCmBadges = {
    statusLabel: "Cover à choisir",
    statusClasses: "bg-warning-50 text-warning-700 border border-warning-200",
  };

  const coverPackBySlot = new Map<string, { status: string; finalCoverUrl: string | null } | null>(
    rawSlots.map((s) => [s.id, s.render?.coverFramePack ?? null]),
  );
  const coverModeBySlot = new Map<string, string | null>(
    rawSlots.map((s) => [s.id, s.pattern?.coverMode ?? null]),
  );

  function cmBadgeForSlot(slotId: string, status: string): WorklistCmBadges {
    const pack = coverPackBySlot.get(slotId);
    const coverMode = coverModeBySlot.get(slotId);
    if (
      coverMode &&
      coverMode !== "none" &&
      pack &&
      pack.status === "READY" &&
      !pack.finalCoverUrl
    ) {
      return COVER_TO_PICK_BADGE;
    }
    return CM_STATUS_BADGES[status] ?? {};
  }

  const cmBadgesMap = new Map<string, WorklistCmBadges>(
    toPrepare.map((s) => [s.id, cmBadgeForSlot(s.id, s.status)]),
  );

  // ── Bandeau « à faire » + mini-calendrier ──────────────────────────────────
  const startToday = getStartOfToday();
  const endToday = getEndOfToday();
  const timeLabel = (d: Date) =>
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const dueToday = nonOverdue.filter(
    (s) =>
      getCmSection(s.status) === "to_publish" &&
      s.scheduledAt != null &&
      s.scheduledAt >= startToday &&
      s.scheduledAt <= endToday,
  );

  const todoItems: TodoItem[] = [
    ...overdue.map((s) => ({
      id: s.id,
      href: `/publications/${s.id}`,
      title: s.pattern?.label ?? s.title ?? "Publication",
      subtitle: s.account ? `@${s.account.handle}` : undefined,
      urgencyLabel: "En retard",
      tone: "danger" as const,
    })),
    ...dueToday.map((s) => ({
      id: s.id,
      href: `/publications/${s.id}`,
      title: s.pattern?.label ?? s.title ?? "Publication",
      subtitle: s.account ? `@${s.account.handle}` : undefined,
      urgencyLabel: s.scheduledAt ? `Aujourd'hui ${timeLabel(s.scheduledAt)}` : "Aujourd'hui",
      tone: "default" as const,
    })),
  ];

  const calItems: MiniCalItem[] = slots
    .filter((s) => s.scheduledAt != null && s.scheduledAt >= weekMonday && s.scheduledAt <= weekSunday)
    .map((s) => ({
      id: s.id,
      href: `/publications/${s.id}`,
      title: s.pattern?.label ?? s.title ?? "Publication",
      dateIso: (s.scheduledAt as Date).toISOString(),
      timeLabel: timeLabel(s.scheduledAt as Date),
      dotClass: PHASE_DOT[getPublicationPhase(s.status)],
    }));

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {totalActive === 0
              ? "Aucune publication en cours."
              : `${totalActive} publication${totalActive > 1 ? "s" : ""} active${totalActive > 1 ? "s" : ""}`}
            {overdue.length > 0 && (
              <>
                {" · "}
                <span className="text-danger-700 tabular-nums">
                  {overdue.length} en retard
                </span>
              </>
            )}
          </p>
        </header>

        {isFullyEmpty ? (
          <EmptyState
            icon={<CheckCircle2 size={20} className="text-muted-foreground" />}
            title="Rien à publier"
            description="Aucune publication en attente."
          />
        ) : (
          <div className="space-y-8">
            <div className="space-y-4">
              <TodoStrip items={todoItems} />
              <MiniWeekCalendar items={calItems} weekStartIso={weekMonday.toISOString()} />
            </div>

            {overdue.length > 0 && (
              <WorklistSection
                title="En retard"
                slots={overdue}
                mode="cm"
                tone="danger"
              />
            )}

            <WorklistSection
              title="À préparer"
              slots={toPrepare}
              mode="cm"
              tone="default"
              emptyMessage="Aucune publication à préparer."
              cmBadgesMap={cmBadgesMap}
            />

            <WorklistSection
              title="À publier cette semaine"
              slots={toPublishThisWeek}
              mode="cm"
              tone="default"
              emptyMessage="Aucune publication prévue cette semaine."
            />

            {publishedRecently.length > 0 && (
              <WorklistSection
                title="Publications récentes (2 dernières semaines)"
                slots={publishedRecently}
                mode="cm"
                tone="muted"
                collapsible
                defaultOpen={false}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

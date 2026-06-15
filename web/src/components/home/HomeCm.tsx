import { CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorklistSection } from "./WorklistSection";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import type { WorklistCmBadges } from "./WorklistSlotCard";
import {
  getCmSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
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

  // ── Badges CM ─────────────────────────────────────────────────────────
  const CM_STATUS_BADGES: Record<string, WorklistCmBadges> = {
    EDIT_APPROVED: {
      statusLabel: "À sous-titrer",
      statusClasses: "bg-sky-50/80 text-sky-700 shadow-[inset_0_0_0_1px_rgba(77,150,191,0.22)]",
    },
    CAPTIONS_PENDING: {
      statusLabel: "Captions en cours",
      statusClasses: "bg-sky-50/80 text-sky-700 shadow-[inset_0_0_0_1px_rgba(77,150,191,0.22)]",
    },
    READY_FOR_CM: {
      statusLabel: "Prêt à publier",
      statusClasses: "bg-success-50/80 text-success-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.22)]",
    },
  };

  const COVER_TO_PICK_BADGE: WorklistCmBadges = {
    statusLabel: "Cover à choisir",
    statusClasses: "bg-peach-50/80 text-peach-700 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.22)]",
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

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Ma worklist
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {totalActive === 0
                    ? "Aucune publication en cours."
                    : `${totalActive} publication${totalActive > 1 ? "s" : ""} active${totalActive > 1 ? "s" : ""}`}
                  {overdue.length > 0 && (
                    <>
                      {" · "}
                      <span className="text-rose-700 tabular-nums">
                        {overdue.length} en retard
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                {totalActive > 0 && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
                )}
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  CM
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-5xl mx-auto space-y-8">
            {isFullyEmpty ? (
              <EmptyState
                icon={<CheckCircle2 size={20} className="text-gray-400" />}
                title="Rien à publier pour le moment"
                description="Aucune publication ne t'attend. Reviens plus tard ou consulte le calendrier pour anticiper la suite."
              />
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

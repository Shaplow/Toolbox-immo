import Link from "next/link";
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

const MONTEUR_STATUSES: SlotStatus[] = [
  "DRAFT",
  "PLANNED",
  // Fix 2026-05-31 : RUSHES_EXPECTED retiré (étape vidéaste, monteur attend).
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "AWAITING_CLIENT",
  "CLIENT_REVISION",
  "TO_DO",
  "IN_PROGRESS",
];

interface HomeMonteurProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeMonteur({ userId, userName }: HomeMonteurProps) {
  const now = new Date();
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();

  // MONTEUR_STATUSES exclut RUSHES_EXPECTED en datée mais on l'ajoute sans date
  // pour banque : le monteur veut voir la mission attribuée même en attente rushs.
  const rawSlots = await prisma.publicationSlot.findMany({
    where: {
      assigneeMonteurId: userId,
      OR: [
        { status: { in: MONTEUR_STATUSES } },
        { status: "RUSHES_EXPECTED", scheduledAt: null },
      ],
    },
    include: {
      account: { select: { id: true, handle: true, name: true } },
      pattern: { select: { label: true } },
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

  const editReviewSlotIds = slots
    .filter((s) => s.status === "EDIT_REVIEW")
    .map((s) => s.id);

  const latestVersionsBySlot = new Map<string, number>();
  if (editReviewSlotIds.length > 0) {
    const latestVersions = await prisma.publicationVersion.findMany({
      where: { slotId: { in: editReviewSlotIds }, deletedAt: null },
      select: { slotId: true, versionNumber: true },
      orderBy: { versionNumber: "desc" },
    });
    for (const v of latestVersions) {
      if (!latestVersionsBySlot.has(v.slotId)) {
        latestVersionsBySlot.set(v.slotId, v.versionNumber);
      }
    }
  }

  const monteurBadgesMap = new Map<string, WorklistSlotBadges>();
  for (const slot of slots) {
    const badges: WorklistSlotBadges = {};
    if (slot.status === "RUSHES_RECEIVED") badges.hasNewRushes = true;
    if (slot.status === "EDIT_REVIEW") {
      const vn = latestVersionsBySlot.get(slot.id);
      badges.versionPendingNumber = vn ?? null;
    }
    if (badges.hasNewRushes || badges.versionPendingNumber !== undefined) {
      monteurBadgesMap.set(slot.id, badges);
    }
  }

  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) &&
      s.scheduledAt != null &&
      s.scheduledAt < now,
  );

  const nonOverdue = slots.filter((s) => !isSlotOverdue(s));

  const thisWeekTodo = nonOverdue.filter((s) => {
    const section = getMonteurSection(s.status);
    return (
      (section === "todo" || section === "in_progress") &&
      s.scheduledAt != null &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday
    );
  });

  const upcoming = nonOverdue.filter((s) => {
    const section = getMonteurSection(s.status);
    return (
      (section === "todo" || section === "in_progress") &&
      s.scheduledAt != null &&
      s.scheduledAt > weekSunday
    );
  });

  const waiting = slots.filter((s) => getMonteurSection(s.status) === "waiting");
  const isBankActiveStatus = (status: SlotStatus): boolean => {
    if (status === "RUSHES_EXPECTED") return true;
    const section = getMonteurSection(status);
    return section === "todo" || section === "in_progress";
  };
  const bankMissions = slots.filter(
    (s) => s.scheduledAt == null && isBankActiveStatus(s.status),
  );

  const totalActive =
    overdue.length + thisWeekTodo.length + upcoming.length + bankMissions.length;
  const isFullyEmpty = totalActive === 0 && waiting.length === 0;

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
            title="Rien à monter"
            description="Aucune publication assignée."
          />
        ) : (
          <div className="space-y-8">
            {overdue.length > 0 && (
              <WorklistSection
                title="En retard"
                slots={overdue}
                mode="monteur"
                tone="danger"
                monteurBadgesMap={monteurBadgesMap}
              />
            )}

            <WorklistSection
              title="Cette semaine"
              slots={thisWeekTodo}
              mode="monteur"
              tone="default"
              emptyMessage="Aucune publication à monter cette semaine."
              monteurBadgesMap={monteurBadgesMap}
            />

            {bankMissions.length > 0 && (
              <WorklistSection
                title="Missions sans date (banque)"
                slots={bankMissions}
                mode="monteur"
                tone="default"
                monteurBadgesMap={monteurBadgesMap}
              />
            )}

            <WorklistSection
              title="À venir"
              slots={upcoming}
              mode="monteur"
              tone="muted"
              collapsible
              defaultOpen={false}
              monteurBadgesMap={monteurBadgesMap}
            />

            {waiting.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                    En attente côté CM ou client
                  </h3>
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10.5px] font-medium tabular-nums bg-muted text-muted-foreground border border-border">
                    {waiting.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {waiting.map((slot) => (
                    <Link
                      key={slot.id}
                      href={`/publications/${slot.id}`}
                      className="block rounded-md bg-card border border-border px-4 py-2.5 hover:bg-muted transition-colors focus-ring"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground truncate">
                            {slot.pattern?.label ?? slot.title ?? "Publication"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {slot.account ? `@${slot.account.handle}` : "Sans compte"}
                          </p>
                        </div>
                        <span className="text-[10.5px] text-muted-foreground font-mono tabular-nums shrink-0">
                          {slot.scheduledAt
                            ? slot.scheduledAt.toLocaleDateString("fr-FR", {
                                day: "numeric",
                                month: "short",
                              })
                            : "Banque"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

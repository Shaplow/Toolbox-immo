import Link from "next/link";
import { Video } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorklistSection } from "./WorklistSection";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import { STATUS_LABELS } from "@/types/calendar";
import {
  getVideasteSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  TERMINAL_STATUSES,
} from "@/types/worklist";

const VIDEASTE_STATUSES: SlotStatus[] = [
  "DRAFT",
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "AWAITING_CLIENT",
  "CLIENT_REVISION",
  "SCHEDULED",
  // Legacy
  "TO_DO",
];

interface HomeVideasteProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeVideaste({ userId, userName }: HomeVideasteProps) {
  const now = new Date();
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();

  const rawSlots = await prisma.publicationSlot.findMany({
    where: {
      assigneeVideasteId: userId,
      status: { in: VIDEASTE_STATUSES },
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
    assigneeVideasteId: s.assigneeVideasteId,
    patternId: s.patternId,
    account: s.account,
    pattern: s.pattern,
  }));

  // ── Découpe en sections ────────────────────────────────────────────────
  // Note : slots en banque (scheduledAt === null) ne concernent pas le
  // vidéaste — le shooting est planifié, pas stocké.
  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) &&
      getVideasteSection(s.status) === "to_shoot" &&
      s.scheduledAt != null &&
      s.scheduledAt < now,
  );

  const nonOverdue = slots.filter(
    (s) => !isSlotOverdue(s) || getVideasteSection(s.status) !== "to_shoot",
  );

  const thisWeekShoots = nonOverdue.filter((s) => {
    const section = getVideasteSection(s.status);
    return (
      section === "to_shoot" &&
      s.scheduledAt != null &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday
    );
  });

  const upcomingShoots = nonOverdue.filter((s) => {
    const section = getVideasteSection(s.status);
    return (
      section === "to_shoot" && s.scheduledAt != null && s.scheduledAt > weekSunday
    );
  });

  const delivered = slots.filter((s) => getVideasteSection(s.status) === "shooting_done");
  const inProduction = slots.filter((s) => getVideasteSection(s.status) === "in_edit");

  const totalActive = overdue.length + thisWeekShoots.length + upcomingShoots.length;
  const isFullyEmpty =
    totalActive === 0 && delivered.length === 0 && inProduction.length === 0;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {totalActive === 0
              ? "Aucun shoot à venir."
              : `${totalActive} shoot${totalActive > 1 ? "s" : ""} à faire`}
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

        <div className="space-y-8">
            {isFullyEmpty ? (
              <EmptyState
                icon={<Video size={20} className="text-muted-foreground" />}
                title="Rien à shooter"
                description="Aucune mission de tournage assignée."
              />
            ) : (
              <>
                {overdue.length > 0 && (
                  <WorklistSection
                    title="En retard"
                    slots={overdue}
                    mode="admin"
                    tone="danger"
                  />
                )}

                <WorklistSection
                  title="À shooter cette semaine"
                  slots={thisWeekShoots}
                  mode="admin"
                  tone="default"
                  emptyMessage="Aucun shoot prévu cette semaine."
                />

                <WorklistSection
                  title="À venir"
                  slots={upcomingShoots}
                  mode="admin"
                  tone="muted"
                  collapsible
                  defaultOpen={false}
                />

                {delivered.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                        Rushs livrés
                      </h3>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10.5px] font-medium tabular-nums bg-success-50 text-success-700 border border-success-200">
                        {delivered.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {delivered.map((slot) => (
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
                            <span className="text-[10.5px] text-success-700 shrink-0">
                              Rushs livrés
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {inProduction.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                        En production
                      </h3>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10.5px] font-medium tabular-nums bg-muted text-muted-foreground border border-border">
                        {inProduction.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {inProduction.slice(0, 5).map((slot) => (
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
                            <span className="text-[10.5px] text-muted-foreground shrink-0">
                              {STATUS_LABELS[slot.status] ?? slot.status}
                            </span>
                          </div>
                        </Link>
                      ))}
                      {inProduction.length > 5 && (
                        <p className="text-[11px] text-muted-foreground text-center">
                          + {inProduction.length - 5} autres
                        </p>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
        </div>
      </div>
    </div>
  );
}

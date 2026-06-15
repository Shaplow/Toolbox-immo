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
                  Mes shoots
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {totalActive === 0
                    ? "Aucun shoot à venir."
                    : `${totalActive} shoot${totalActive > 1 ? "s" : ""} à faire`}
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
                  Vidéaste
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-5xl mx-auto space-y-8">
            {isFullyEmpty ? (
              <EmptyState
                icon={<Video size={20} className="text-gray-400" />}
                title="Rien à shooter pour le moment"
                description={
                  "Tes prochaines missions de tournage apparaîtront ici dès qu'elles te seront " +
                  "assignées dans le calendrier (champ « Vidéaste » sur le slot). Si tu attendais " +
                  "une mission, vérifie avec un admin qu'elle pointe bien vers ton compte."
                }
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
                      <h3 className="text-[13px] font-semibold tracking-tight text-sage-800">
                        Shoots livrés (en attente montage)
                      </h3>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-medium tabular-nums bg-sage-50/80 text-sage-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(111,162,128,0.22)]">
                        {delivered.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {delivered.map((slot) => (
                        <Link
                          key={slot.id}
                          href={`/publications/${slot.id}`}
                          className="block rounded-xl bg-white/70 backdrop-blur-[8px] px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),0_2px_6px_rgba(15,23,42,0.06)] transition-all"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-medium text-gray-700 truncate">
                                {slot.pattern?.label ?? slot.title ?? "Publication"}
                              </p>
                              <p className="text-[11px] text-gray-400">
                                @{slot.account.handle}
                              </p>
                            </div>
                            <span className="text-[10.5px] text-sage-700 shrink-0">
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
                      <h3 className="text-[13px] font-semibold tracking-tight text-gray-600">
                        En production (suivi)
                      </h3>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-medium tabular-nums bg-gray-100/60 text-gray-500 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
                        {inProduction.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-3">
                      Tes shoots sont en montage / validation client. Aucune action requise.
                    </p>
                    <div className="space-y-2">
                      {inProduction.slice(0, 5).map((slot) => (
                        <Link
                          key={slot.id}
                          href={`/publications/${slot.id}`}
                          className="block rounded-xl bg-white/70 backdrop-blur-[8px] px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/90 transition-all"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-medium text-gray-700 truncate">
                                {slot.pattern?.label ?? slot.title ?? "Publication"}
                              </p>
                              <p className="text-[11px] text-gray-400">
                                @{slot.account.handle}
                              </p>
                            </div>
                            <span className="text-[10.5px] text-gray-400 shrink-0">
                              {STATUS_LABELS[slot.status] ?? slot.status}
                            </span>
                          </div>
                        </Link>
                      ))}
                      {inProduction.length > 5 && (
                        <p className="text-[11px] text-gray-400 italic text-center">
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
    </div>
  );
}

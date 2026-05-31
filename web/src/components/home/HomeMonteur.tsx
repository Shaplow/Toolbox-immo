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

// Statuts à inclure dans la worklist Monteur. Doit rester aligné avec
// MONTEUR_SECTION_MAP dans worklist.ts.
const MONTEUR_STATUSES: SlotStatus[] = [
  "DRAFT",
  "PLANNED",
  // Fix 2026-05-31 : RUSHES_EXPECTED retiré — le monteur ne doit pas être
  // notifié tant que les rushs ne sont pas livrés (étape vidéaste). Aligné
  // avec MONTEUR_SECTION_MAP côté worklist.ts.
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "AWAITING_CLIENT",
  "CLIENT_REVISION",
  // Legacy
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

  const rawSlots = await prisma.publicationSlot.findMany({
    where: {
      assigneeMonteurId: userId,
      status: { in: MONTEUR_STATUSES },
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

  // ── Badges contextuels monteur ─────────────────────────────────────────
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

  // ── Découpe en sections ────────────────────────────────────────────────
  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) && s.scheduledAt < now,
  );

  const nonOverdue = slots.filter((s) => !isSlotOverdue(s));

  const thisWeekTodo = nonOverdue.filter((s) => {
    const section = getMonteurSection(s.status);
    return (
      (section === "todo" || section === "in_progress") &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday
    );
  });

  const upcoming = nonOverdue.filter((s) => {
    const section = getMonteurSection(s.status);
    return (section === "todo" || section === "in_progress") && s.scheduledAt > weekSunday;
  });

  const waiting = slots.filter((s) => getMonteurSection(s.status) === "waiting");

  const totalActive = overdue.length + thisWeekTodo.length + upcoming.length;
  const isFullyEmpty = totalActive === 0 && waiting.length === 0;

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

              {/* Live pill */}
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                {totalActive > 0 && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
                )}
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  Monteur
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
                title="Rien à monter pour le moment"
                description="Ta file est vide. Bonne pause — les prochaines publications arriveront via le calendrier."
              />
            ) : (
              <>
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
                      <h3 className="text-[13px] font-semibold tracking-tight text-gray-600">
                        Mes envois en attente client
                      </h3>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-medium tabular-nums bg-gray-100/60 text-gray-500 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
                        {waiting.length}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-3">
                      Ces publications ont quitté ta file. Le CM ou le client prend la main.
                    </p>
                    <div className="space-y-2">
                      {waiting.map((slot) => (
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
                            <span className="text-[10.5px] text-gray-400 font-mono tabular-nums shrink-0">
                              {slot.scheduledAt.toLocaleDateString("fr-FR", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          </div>
                        </Link>
                      ))}
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

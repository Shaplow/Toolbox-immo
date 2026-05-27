import { Video } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorklistSection } from "./WorklistSection";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import {
  getVideasteSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  TERMINAL_STATUSES,
} from "@/types/worklist";

/**
 * Statuts à inclure dans la worklist Vidéaste.
 * - Action requise : PLANNED, RUSHES_EXPECTED (à shooter)
 * - Action terminée mais à garder visible : RUSHES_RECEIVED (shoot livré)
 * - Informatif uniquement : IN_EDIT → SCHEDULED (suivi production aval)
 *
 * Exclusions : DRAFT (pas planifié), PUBLISHED/ARCHIVED/etc (terminé, hors worklist).
 */
const VIDEASTE_STATUSES: SlotStatus[] = [
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

  // ── Découpe en sections ────────────────────────────────────────────────────

  /** En retard : shoot dans le passé encore en attente de rushs. */
  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) &&
      getVideasteSection(s.status) === "to_shoot" &&
      s.scheduledAt < now,
  );

  const nonOverdue = slots.filter((s) => !isSlotOverdue(s) || getVideasteSection(s.status) !== "to_shoot");

  /** À shooter cette semaine. */
  const thisWeekShoots = nonOverdue.filter((s) => {
    const section = getVideasteSection(s.status);
    return (
      section === "to_shoot" &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday
    );
  });

  /** À shooter à venir (après cette semaine). */
  const upcomingShoots = nonOverdue.filter((s) => {
    const section = getVideasteSection(s.status);
    return section === "to_shoot" && s.scheduledAt > weekSunday;
  });

  /** Shoots livrés (informatif — rushs uploadés, suivi monteur). */
  const delivered = slots.filter((s) => getVideasteSection(s.status) === "shooting_done");

  /** En montage et plus loin (informatif — suivi production aval). */
  const inProduction = slots.filter((s) => getVideasteSection(s.status) === "in_edit");

  const totalActive = overdue.length + thisWeekShoots.length + upcomingShoots.length;
  const isFullyEmpty =
    totalActive === 0 && delivered.length === 0 && inProduction.length === 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalActive === 0
              ? "Aucun shoot à venir."
              : `${totalActive} shoot${totalActive > 1 ? "s" : ""} à faire`}
          </p>
        </div>
      </div>

      {isFullyEmpty ? (
        <EmptyState
          icon={<Video size={20} className="text-gray-400" />}
          title="Rien à shooter pour le moment"
          description="Tes prochaines missions de tournage apparaîtront ici dès qu'elles seront planifiées."
        />
      ) : (
        <>
          {/* En retard — shoots non livrés alors que la date est passée */}
          {overdue.length > 0 && (
            <WorklistSection
              title="En retard"
              slots={overdue}
              mode="monteur"
              tone="danger"
            />
          )}

          {/* Cette semaine */}
          <WorklistSection
            title="À shooter cette semaine"
            slots={thisWeekShoots}
            mode="monteur"
            tone="default"
            emptyMessage="Aucun shoot prévu cette semaine."
          />

          {/* À venir */}
          <WorklistSection
            title="À venir"
            slots={upcomingShoots}
            mode="monteur"
            tone="muted"
            collapsible
            defaultOpen={false}
          />

          {/* Shoots livrés — informatif */}
          {delivered.length > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-emerald-800">
                  Shoots livrés (en attente montage)
                </h3>
                <span className="text-[11px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  {delivered.length}
                </span>
              </div>
              <div className="space-y-2">
                {delivered.map((slot) => (
                  <div
                    key={slot.id}
                    className="bg-white rounded-lg border border-emerald-100 px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">
                        {slot.pattern?.label ?? slot.title ?? "Publication"}
                      </p>
                      <p className="text-[11px] text-gray-400">@{slot.account.handle}</p>
                    </div>
                    <span className="text-[11px] text-emerald-700 shrink-0">
                      Rushs livrés
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* En production aval — informatif, repliable */}
          {inProduction.length > 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-600">
                  En production (suivi)
                </h3>
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {inProduction.length}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Tes shoots sont en montage / validation client. Aucune action requise.
              </p>
              <div className="space-y-2">
                {inProduction.slice(0, 5).map((slot) => (
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
                      {slot.status}
                    </span>
                  </div>
                ))}
                {inProduction.length > 5 && (
                  <p className="text-[11px] text-gray-400 italic text-center">
                    + {inProduction.length - 5} autres
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

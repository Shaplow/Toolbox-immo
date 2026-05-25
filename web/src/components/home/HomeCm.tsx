import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { WorklistSection } from "./WorklistSection";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotStatus } from "@/types/roles";
import {
  getCmSection,
  isSlotOverdue,
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  TERMINAL_STATUSES,
} from "@/types/worklist";

// Statuts à inclure dans la worklist CM.
const CM_STATUSES: SlotStatus[] = [
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "SCHEDULED",
  "PUBLISHED",
];

// Fenêtre "Publié récemment" : 14 jours glissants.
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
      account: {
        select: { id: true, handle: true, name: true, offre: true },
      },
      recipe: {
        select: { code: true, label: true },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  // Cast Prisma result → WorklistSlot.
  const slots: WorklistSlot[] = rawSlots.map((s) => ({
    id: s.id,
    title: s.title,
    scheduledAt: s.scheduledAt,
    status: s.status as SlotStatus,
    contentType: s.contentType,
    notes: s.notes,
    assigneeMonteurId: s.assigneeMonteurId,
    assigneeCmId: s.assigneeCmId,
    recipeId: s.recipeId,
    account: s.account,
    recipe: s.recipe,
  }));

  // ── Découpe en sections ────────────────────────────────────────────────────

  /** En retard : passé, non-terminal, statut CM actif (pas PUBLISHED) */
  const overdue = slots.filter(
    (s) =>
      !(TERMINAL_STATUSES as readonly string[]).includes(s.status) &&
      s.status !== "PUBLISHED" &&
      s.scheduledAt < now
  );

  const nonOverdue = slots.filter((s) => !isSlotOverdue(s));

  /** À préparer : statuts d'entrée CM (EDIT_APPROVED, CAPTIONS_PENDING, READY_FOR_CM) */
  const toPrepare = nonOverdue.filter(
    (s) => getCmSection(s.status) === "to_prepare"
  );

  /** À publier cette semaine : SCHEDULED dans [lundi, dimanche] de la semaine courante */
  const toPublishThisWeek = nonOverdue.filter(
    (s) =>
      getCmSection(s.status) === "to_publish" &&
      s.scheduledAt >= weekMonday &&
      s.scheduledAt <= weekSunday
  );

  /** Publié récemment : PUBLISHED dans les 14 derniers jours */
  const publishedRecently = slots.filter(
    (s) => s.status === "PUBLISHED" && s.scheduledAt >= publishedSince
  );

  const totalActive = overdue.length + toPrepare.length + toPublishThisWeek.length;

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

      {/* Section En retard */}
      {overdue.length > 0 && (
        <WorklistSection
          title="En retard"
          slots={overdue}
          mode="cm"
          tone="danger"
        />
      )}

      {/* Section À préparer */}
      <WorklistSection
        title="À préparer"
        slots={toPrepare}
        mode="cm"
        tone="default"
      />

      {/* Section À publier cette semaine */}
      <WorklistSection
        title="À publier cette semaine"
        slots={toPublishThisWeek}
        mode="cm"
        tone="default"
      />

      {/* Section Publié récemment */}
      {publishedRecently.length > 0 && (
        <WorklistSection
          title={`Publié récemment (${PUBLISHED_WINDOW_DAYS}j)`}
          slots={publishedRecently}
          mode="cm"
          tone="muted"
          collapsible
          defaultOpen={false}
        />
      )}

      {/* Lien vers tous les outils */}
      <div className="pt-2 border-t border-gray-100">
        <Link
          href="/tools"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 transition-colors"
        >
          Accéder à tous les outils <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import Link from "next/link";
import { CalendarDays, AlertTriangle, FileQuestion, ArrowRight, Building2, Instagram } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { SlotStatus } from "@/types/roles";
import { TERMINAL_STATUSES } from "@/types/worklist";
import { getInboxItems } from "@/lib/services/inbox/getInboxItems";
import { MiniWeekCalendar, type MiniCalItem } from "./MiniWeekCalendar";
import { getCurrentWeekMonday, getCurrentWeekSunday } from "@/types/worklist";
import { STATUS_DOT } from "@/lib/slots/statusLabels";
import { timeFr } from "@/lib/date/formatFr";
import { AdminInbox } from "./AdminInbox";

const ACTIVE_STATUSES: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "READY_FOR_CM",
  "SCHEDULED",
  "DRAFT",
  "BLOCKED",
];

interface HomeAdminProps {
  userName: string | null | undefined;
}

/**
 * HomeAdmin — cockpit admin flat shadcn.
 *
 * Header simple (titre + date), strip 2 counters (retards / sans recette),
 * Inbox unifiée, footer 3 raccourcis nav.
 */
export async function HomeAdmin({ userName }: HomeAdminProps) {
  const now = new Date();

  const [overdueCount, noPatternCount, inboxItems, accountsCount, recipesCount, weekSlots] = await Promise.all([
    prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: now, not: null },
        status: {
          in: ACTIVE_STATUSES.filter(
            (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s),
          ),
        },
      },
    }),
    prisma.publicationSlot.count({
      // Slots sans recette (ni binding, ni recette globale directe).
      where: {
        patternBindingId: null,
        patternTemplateId: null,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    getInboxItems(),
    // Checklist « Démarrer » (V3.3) — affichée tant que la base n'est pas posée.
    prisma.instagramAccount.count({ where: { id: { notIn: [...SHARED_SENTINEL_IDS] } } }),
    prisma.patternTemplate.count({ where: { isArchived: false } }),
    // « Ma semaine » (V3.3) — l'admin était le seul rôle sans vue semaine sur
    // son accueil.
    prisma.publicationSlot.findMany({
      where: {
        scheduledAt: { gte: getCurrentWeekMonday(), lte: getCurrentWeekSunday() },
        status: { notIn: [...TERMINAL_STATUSES] },
      },
      orderBy: { scheduledAt: "asc" },
      take: 60,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledAt: true,
        account: { select: { handle: true } },
      },
    }),
  ]);

  const todayLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[12px] text-muted-foreground capitalize">{todayLabel}</p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/calendar?filter=overdue"
            className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-danger-50 border border-danger-200 hover:bg-danger-100 transition-colors text-[12px] focus-ring"
            title="Publications en retard"
          >
            <AlertTriangle size={13} className="text-danger-700" />
            <span className="text-danger-700 font-semibold tabular-nums">{overdueCount}</span>
            <span className="text-danger-700">en retard</span>
          </Link>
          <Link
            href="/calendar?filter=no-pattern"
            className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-warning-50 border border-warning-200 hover:bg-warning-100 transition-colors text-[12px] focus-ring"
            title="Publications sans recette"
          >
            <FileQuestion size={13} className="text-warning-700" />
            <span className="text-warning-700 font-semibold tabular-nums">{noPatternCount}</span>
            <span className="text-warning-700">sans recette</span>
          </Link>
        </div>

        <AdminInbox items={inboxItems} accountsCount={accountsCount} recipesCount={recipesCount} />

        <div>
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground mb-2">
            La semaine
          </h2>
          <MiniWeekCalendar
            items={weekSlots
              .filter((s) => s.scheduledAt)
              .map((s): MiniCalItem => ({
                id: s.id,
                href: `/publications/${s.id}`,
                title: s.title ?? (s.account ? `@${s.account.handle}` : "Sans titre"),
                dateIso: (s.scheduledAt as Date).toISOString(),
                timeLabel: timeFr(s.scheduledAt as Date),
                dotClass: STATUS_DOT[s.status as SlotStatus] ?? "bg-gray-400",
                subtitle: s.account ? `@${s.account.handle}` : undefined,
              }))}
            weekStartIso={getCurrentWeekMonday().toISOString()}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Link
            href="/calendar"
            className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-card border border-border hover:bg-muted transition-colors text-[13px] text-foreground font-medium group focus-ring"
          >
            <CalendarDays size={14} className="text-muted-foreground shrink-0" />
            Calendrier
            <ArrowRight
              size={12}
              className="ml-auto text-muted-foreground group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
          <Link
            href="/admin/accounts"
            className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-card border border-border hover:bg-muted transition-colors text-[13px] text-foreground focus-ring"
          >
            <Instagram size={14} className="text-muted-foreground shrink-0" />
            Comptes Instagram
          </Link>
          <Link
            href="/admin/clients"
            className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-card border border-border hover:bg-muted transition-colors text-[13px] text-foreground focus-ring"
          >
            <Building2 size={14} className="text-muted-foreground shrink-0" />
            Clients
          </Link>
        </div>
      </div>
    </div>
  );
}

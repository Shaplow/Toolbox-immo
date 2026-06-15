import Link from "next/link";
import { CalendarDays, AlertTriangle, FileQuestion, ArrowRight, Building2, Instagram } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { SlotStatus } from "@/types/roles";
import { TERMINAL_STATUSES } from "@/types/worklist";
import { getInboxItems } from "@/lib/services/inbox/getInboxItems";
import { AdminInbox } from "./AdminInbox";

// Statuts considérés comme "actifs" (non-terminaux) pour le calcul des retards.
const ACTIVE_STATUSES: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "SCHEDULED",
  "DRAFT",
  "BLOCKED",
];

interface HomeAdminProps {
  userName: string | null | undefined;
}

/**
 * Tableau de bord Admin — refonte V4 MID Liquid Glass (cohérence avec
 * /calendar et /publications/[id]).
 *
 * Affiche des métriques globales utiles pour l'orchestrateur (slots en
 * retard, slots sans pattern, versions à valider) avec liens directs vers
 * /calendar, /admin/clients, /admin/accounts. L'Admin reste principalement
 * sur /calendar pour l'orchestration détaillée — utiliser Cmd+K pour la
 * recherche transverse.
 */
export async function HomeAdmin({ userName }: HomeAdminProps) {
  const now = new Date();

  // V8 Phase 4 — Cockpit Inbox : unifie les 6 queries éparpillées dans un
  // service dédié + 2 mini-counters retenus pour la rétrocompat des KPI
  // deeplinks (?filter=overdue, ?filter=no-pattern) depuis le strip header.
  const [overdueCount, noPatternCount, inboxItems] = await Promise.all([
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
      where: {
        patternId: null,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    getInboxItems(),
  ]);

  // Formater la date du jour en français
  const todayLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen">
      {/* Wrapper outer pastel — cohérent avec /calendar et fiche publication */}
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Header glass — eyebrow + h1 + date */}
            <header className="rounded-2xl bg-white/55 backdrop-blur-[12px] backdrop-saturate-150 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Tableau de bord
              </p>
              <h1 className="mt-1 text-[28px] sm:text-[32px] font-semibold tracking-tight text-gray-950">
                Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
              </h1>
              <p className="mt-1 text-[12px] text-gray-500 capitalize">{todayLabel}</p>
            </header>

            {/* Strip 2 mini-counters — rétrocompat KPI deeplinks (?filter=).
                Compact (5 lignes max) au-dessus de l'Inbox pour le scan
                rapide "X en retard" / "Y sans recette" sans encombrer. */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/calendar?filter=overdue"
                className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-rose-50/70 hover:bg-rose-50 transition-colors text-[12px] focus-ring"
                title="Voir les publications en retard"
              >
                <AlertTriangle size={13} className="text-rose-700" />
                <span className="text-rose-900 font-medium">
                  {overdueCount}
                </span>
                <span className="text-rose-700/80">en retard</span>
              </Link>
              <Link
                href="/calendar?filter=no-pattern"
                className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-peach-50/70 hover:bg-peach-50 transition-colors text-[12px] focus-ring"
                title="Voir les publications sans recette"
              >
                <FileQuestion size={13} className="text-peach-700" />
                <span className="text-peach-900 font-medium">
                  {noPatternCount}
                </span>
                <span className="text-peach-700/80">sans recette</span>
              </Link>
            </div>

            {/* Cockpit Inbox — liste unifiée triée par priorité, avec tabs
                filtres et actions inline (Phase 4). */}
            <AdminInbox items={inboxItems} />

            {/* Footer compact : lien Calendrier + menus Admin */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link
                href="/calendar"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-b from-sage-50/85 to-sage-50/45 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.20)] hover:from-sage-50/95 hover:to-sage-50/55 transition-colors text-[12.5px] text-sage-900 font-medium group"
              >
                <CalendarDays size={14} className="text-sage-700 shrink-0" />
                Calendrier éditorial
                <ArrowRight
                  size={12}
                  className="ml-auto text-sage-600 group-hover:translate-x-0.5 transition-transform"
                />
              </Link>
              <Link
                href="/admin/accounts"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700"
              >
                <Instagram size={14} className="text-gray-500 shrink-0" />
                Comptes Instagram
              </Link>
              <Link
                href="/admin/clients"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700"
              >
                <Building2 size={14} className="text-gray-500 shrink-0" />
                Clients
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


import Link from "next/link";
import { CalendarDays, AlertTriangle, FileQuestion, UserX, ArrowRight, CalendarClock, Building2, Film } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { SlotStatus } from "@/types/roles";
import { TERMINAL_STATUSES } from "@/types/worklist";

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
 * Tableau de bord Admin.
 *
 * Affiche des métriques globales utiles pour l'orchestrateur (slots en
 * retard, slots sans pattern, versions à valider) avec liens directs vers
 * /calendar, /admin/clients, /admin/accounts. L'Admin reste principalement
 * sur /calendar pour l'orchestration détaillée — utiliser Cmd+K pour la
 * recherche transverse.
 */
export async function HomeAdmin({ userName }: HomeAdminProps) {
  const now = new Date();

  const [overdueCount, noPatternCount, noMonteurCount, editReviewSlots] = await Promise.all([
    prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: now },
        status: { in: ACTIVE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)) },
      },
    }),
    prisma.publicationSlot.count({
      where: {
        patternId: null,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    // B10 — Slots actifs sans monteur assigné. Sans cette assignation, ils
    // n'apparaissent dans la worklist d'aucun monteur (filtrage par
    // assigneeMonteurId) → invisibles tant que l'ADMIN ne les voit pas ici.
    prisma.publicationSlot.count({
      where: {
        assigneeMonteurId: null,
        status: { in: ACTIVE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)) },
      },
    }),
    // Slots en EDIT_REVIEW = version livrée, attend validation admin
    prisma.publicationSlot.findMany({
      where: { status: "EDIT_REVIEW" },
      select: {
        id: true,
        title: true,
        pattern: { select: { label: true } },
        account: { select: { handle: true, name: true } },
        versions: {
          where: { deletedAt: null },
          select: { versionNumber: true, createdAt: true },
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  // Formater la date du jour en français
  const todayLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-gray-500 mt-1 capitalize">{todayLabel}</p>
      </div>

      {/* Métriques globales */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className={`rounded-xl border p-4 flex flex-col gap-1 ${
            overdueCount > 0
              ? "border-red-200 bg-red-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle
              size={15}
              className={overdueCount > 0 ? "text-red-500" : "text-gray-400"}
            />
            <span className="text-xs font-medium text-gray-600">
              Slots en retard
            </span>
          </div>
          <p
            className={`text-3xl font-bold mt-1 ${
              overdueCount > 0 ? "text-red-700" : "text-gray-400"
            }`}
          >
            {overdueCount}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 flex flex-col gap-1 ${
            noPatternCount > 0
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <FileQuestion
              size={15}
              className={noPatternCount > 0 ? "text-amber-500" : "text-gray-400"}
            />
            <span className="text-xs font-medium text-gray-600">
              Sans pattern
            </span>
          </div>
          <p
            className={`text-3xl font-bold mt-1 ${
              noPatternCount > 0 ? "text-amber-700" : "text-gray-400"
            }`}
          >
            {noPatternCount}
          </p>
        </div>

        {/* B10 — Slots sans monteur assigné (sinon invisibles côté monteur) */}
        <div
          className={`rounded-xl border p-4 flex flex-col gap-1 ${
            noMonteurCount > 0
              ? "border-orange-200 bg-orange-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <UserX
              size={15}
              className={noMonteurCount > 0 ? "text-orange-500" : "text-gray-400"}
            />
            <span className="text-xs font-medium text-gray-600">
              Sans monteur
            </span>
          </div>
          <p
            className={`text-3xl font-bold mt-1 ${
              noMonteurCount > 0 ? "text-orange-700" : "text-gray-400"
            }`}
          >
            {noMonteurCount}
          </p>
        </div>
      </div>

      {/* Widget "Versions à valider" */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Film size={15} className="text-blue-600 shrink-0" />
          <h2 className="text-sm font-semibold text-blue-800">Versions à valider</h2>
          {editReviewSlots.length > 0 && (
            <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium bg-blue-200 text-blue-800">
              {editReviewSlots.length}
            </span>
          )}
        </div>

        {editReviewSlots.length === 0 ? (
          <p className="text-xs text-blue-500 italic">Toutes les versions sont à jour.</p>
        ) : (
          <div className="space-y-2">
            {editReviewSlots.map((slot) => {
              const latestVersion = slot.versions[0];
              const versionLabel = latestVersion ? `V${latestVersion.versionNumber}` : "Version";
              const uploadDate = latestVersion
                ? new Date(latestVersion.createdAt).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                  })
                : null;

              return (
                <Link
                  key={slot.id}
                  href={`/publications/${slot.id}`}
                  className="flex items-center justify-between bg-white rounded-lg border border-blue-100 px-3 py-2 hover:border-blue-300 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {slot.pattern?.label ?? slot.title ?? "Publication"}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      @{slot.account.handle}
                      {slot.account.name !== slot.account.handle && (
                        <span className="text-gray-400"> · {slot.account.name}</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 ml-3">
                    <span className="text-[11px] font-medium text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                      {versionLabel} en attente
                    </span>
                    {uploadDate && (
                      <span className="text-[10px] text-gray-400 hidden sm:block">{uploadDate}</span>
                    )}
                    <ArrowRight size={12} className="text-blue-400 group-hover:text-blue-600 transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Lien principal vers le calendrier */}
      <Link
        href="/calendar"
        className="flex items-center justify-between p-4 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <CalendarDays size={18} className="text-indigo-600" />
          <div>
            <p className="text-sm font-semibold text-indigo-800">
              Ouvrir le calendrier éditorial
            </p>
            <p className="text-xs text-indigo-500 mt-0.5">
              Planification, assignation, statuts complets
            </p>
          </div>
        </div>
        <ArrowRight size={16} className="text-indigo-400 group-hover:text-indigo-600 transition-colors" />
      </Link>

      {/* Liens secondaires */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/admin/accounts"
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors text-sm text-gray-700"
        >
          <CalendarClock size={14} className="text-gray-400 shrink-0" />
          Gérer les comptes Instagram
        </Link>
        <Link
          href="/admin/clients"
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors text-sm text-gray-700"
        >
          <Building2 size={14} className="text-gray-400 shrink-0" />
          Gérer les clients
        </Link>
      </div>
    </div>
  );
}

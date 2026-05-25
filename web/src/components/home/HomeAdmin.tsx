import Link from "next/link";
import { CalendarDays, AlertTriangle, FileQuestion, ArrowRight } from "lucide-react";
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
 * Tableau de bord Admin simplifié pour Phase 1.2.
 *
 * Affiche deux métriques globales utiles pour l'orchestrateur :
 *  - Slots en retard (scheduledAt < now, statut non-terminal)
 *  - Slots sans recipe (recipeId null, statut actif)
 *
 * La version complète avec worklist riche viendra lors d'une phase ultérieure.
 * L'Admin reste principalement sur /calendar pour l'orchestration détaillée.
 */
export async function HomeAdmin({ userName }: HomeAdminProps) {
  const now = new Date();

  const [overdueCount, noRecipeCount] = await Promise.all([
    prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: now },
        status: { in: ACTIVE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)) },
      },
    }),
    prisma.publicationSlot.count({
      where: {
        recipeId: null,
        status: { in: ACTIVE_STATUSES },
      },
    }),
  ]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Tableau de bord{userName ? ` · ${userName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Vue d&apos;ensemble de la pipeline éditoriale.
        </p>
      </div>

      {/* Métriques globales */}
      <div className="grid grid-cols-2 gap-4">
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
            noRecipeCount > 0
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <FileQuestion
              size={15}
              className={noRecipeCount > 0 ? "text-amber-500" : "text-gray-400"}
            />
            <span className="text-xs font-medium text-gray-600">
              Sans recipe
            </span>
          </div>
          <p
            className={`text-3xl font-bold mt-1 ${
              noRecipeCount > 0 ? "text-amber-700" : "text-gray-400"
            }`}
          >
            {noRecipeCount}
          </p>
        </div>
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
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/tools"
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors text-sm text-gray-700"
        >
          <ArrowRight size={14} className="text-gray-400" />
          Outils
        </Link>
        <Link
          href="/admin/recipes"
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors text-sm text-gray-700"
        >
          <ArrowRight size={14} className="text-gray-400" />
          Recipes
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS } from "@/types/calendar";
import { SlotDetailPanel } from "@/components/calendar/SlotDetailPanel";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";
import type { WorklistSlot } from "@/types/worklist";
import type { PublicationSlot } from "@/types/calendar";
import { isSlotOverdue } from "@/types/worklist";
import type { SlotStatus as WorklistSlotStatus } from "@/types/roles";

interface WorklistSlotCardProps {
  slot: WorklistSlot;
  mode: SlotDetailPanelMode;
}

/**
 * Adapte un WorklistSlot (objet Prisma natif avec Date) vers le format
 * PublicationSlot attendu par SlotDetailPanel (ISO strings, structure API).
 *
 * SlotDetailPanel est un composant client issu du calendrier et attend des strings
 * pour les dates. Cette adaptation est locale à la card pour ne pas contaminer
 * le typage serveur.
 */
function toPublicationSlot(slot: WorklistSlot): PublicationSlot {
  return {
    id: slot.id,
    accountId: slot.account.id,
    account: slot.account,
    scheduledAt: slot.scheduledAt.toISOString(),
    contentType: slot.contentType,
    status: slot.status,
    title: slot.title,
    caption: null,
    notes: slot.notes,
    fields: {},
    fieldSchema: [],
    templateId: null,
    template: null,
    render: null,
    isAuto: false,
    createdAt: slot.scheduledAt.toISOString(),
    updatedAt: slot.scheduledAt.toISOString(),
    assigneeMonteurId: slot.assigneeMonteurId,
    assigneeCmId: slot.assigneeCmId,
    recipeId: slot.recipeId,
    recipe: slot.recipe,
  };
}

/**
 * Formate une date pour l'affichage dans les worklists.
 * Exemple : "mer. 28 mai · 10h00"
 */
function formatScheduledAt(date: Date): string {
  const datePart = date.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const timePart = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

export function WorklistSlotCard({ slot, mode }: WorklistSlotCardProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [liveSlot, setLiveSlot] = useState<WorklistSlot>(slot);

  const overdue = isSlotOverdue(liveSlot);
  const adaptedSlot = toPublicationSlot(liveSlot);

  function handleUpdated(updated: PublicationSlot) {
    // Réconcilie les champs mis à jour dans le panel avec le WorklistSlot local.
    // Le cast est sûr : PublicationSlot.status inclut des statuts legacy (DONE, etc.)
    // qui ne peuvent pas apparaître sur un WorklistSlot issu de la pipeline active.
    setLiveSlot((prev) => ({
      ...prev,
      status: updated.status as WorklistSlotStatus,
      notes: updated.notes,
      title: updated.title,
    }));
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start gap-3 hover:border-gray-300 transition-colors">
        {/* Indicateur "EN RETARD" */}
        {overdue && (
          <div className="shrink-0 mt-0.5" title="En retard">
            <AlertCircle size={15} className="text-red-500" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Titre / fallback sur type de contenu */}
          <p className="text-sm font-medium text-gray-900 truncate">
            {liveSlot.title ?? liveSlot.contentType}
          </p>

          {/* Compte */}
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            @{liveSlot.account.handle}
            {liveSlot.account.name !== liveSlot.account.handle && (
              <span className="text-gray-400"> · {liveSlot.account.name}</span>
            )}
          </p>

          {/* Date */}
          <p className={`text-xs mt-1 ${overdue ? "text-red-500 font-medium" : "text-gray-400"}`}>
            {formatScheduledAt(liveSlot.scheduledAt)}
            {overdue && <span className="ml-1 font-semibold uppercase text-red-600 text-[10px]">EN RETARD</span>}
          </p>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          {/* Badge statut */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_COLORS[liveSlot.status]}`}
          >
            {STATUS_LABELS[liveSlot.status]}
          </span>

          {/* Bouton Ouvrir */}
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            Ouvrir <ExternalLink size={11} />
          </button>
        </div>
      </div>

      {/* SlotDetailPanel en mode rôle-aware */}
      {panelOpen && (
        <SlotDetailPanel
          slot={adaptedSlot}
          mode={mode}
          onUpdated={handleUpdated}
          onDeleted={() => setPanelOpen(false)}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink } from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS } from "@/types/calendar";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";
import type { WorklistSlot } from "@/types/worklist";
import { isSlotOverdue } from "@/types/worklist";

interface WorklistSlotCardProps {
  slot: WorklistSlot;
  mode: SlotDetailPanelMode;
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

export function WorklistSlotCard({ slot }: WorklistSlotCardProps) {
  const router = useRouter();
  const overdue = isSlotOverdue(slot);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/publications/${slot.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/publications/${slot.id}`); }}
      className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start gap-3 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer"
    >
      {/* Indicateur "EN RETARD" */}
      {overdue && (
        <div className="shrink-0 mt-0.5" title="En retard">
          <AlertCircle size={15} className="text-red-500" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Titre / fallback sur type de contenu */}
        <p className="text-sm font-medium text-gray-900 truncate">
          {slot.title ?? slot.contentType}
        </p>

        {/* Compte */}
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          @{slot.account.handle}
          {slot.account.name !== slot.account.handle && (
            <span className="text-gray-400"> · {slot.account.name}</span>
          )}
        </p>

        {/* Date */}
        <p className={`text-xs mt-1 ${overdue ? "text-red-500 font-medium" : "text-gray-400"}`}>
          {formatScheduledAt(slot.scheduledAt)}
          {overdue && <span className="ml-1 font-semibold uppercase text-red-600 text-[10px]">EN RETARD</span>}
        </p>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">
        {/* Badge statut */}
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_COLORS[slot.status]}`}
        >
          {STATUS_LABELS[slot.status]}
        </span>

        {/* Indicateur navigation */}
        <span className="flex items-center gap-1 text-xs text-indigo-600">
          Voir la fiche <ExternalLink size={11} />
        </span>
      </div>
    </div>
  );
}

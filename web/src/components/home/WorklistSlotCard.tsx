"use client";

/**
 * WorklistSlotCard — card slot d'une worklist home (refonte MID Liquid Glass).
 *
 * Row card horizontale, blanche opaque avec shadow franche (matière forte
 * pour ressortir sur le fond pastel du wrapper). Hover lift -translate-y-px.
 * Click → navigate vers la fiche complète.
 *
 * Phases overdue : surlignée avec ring inset rose.
 */

import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight } from "lucide-react";
import { STATUS_LABELS } from "@/types/calendar";
import { getPublicationPhase } from "@/lib/slots/phase";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";
import type { WorklistSlot } from "@/types/worklist";
import { isSlotOverdue } from "@/types/worklist";

/**
 * Badges contextuels optionnels pour les monteurs.
 */
export interface WorklistSlotBadges {
  /** True si le slot vient de recevoir des nouveaux rushes (RUSHES_RECEIVED). */
  hasNewRushes?: boolean;
  /** Numéro de la dernière version livrée en attente de validation. */
  versionPendingNumber?: number | null;
}

/**
 * Badges contextuels optionnels pour les CM.
 */
export interface WorklistCmBadges {
  /** Label de statut affiché sur la card CM. */
  statusLabel?: string;
  /** Classes Tailwind pour le badge (bg + text + border). */
  statusClasses?: string;
}

interface WorklistSlotCardProps {
  slot: WorklistSlot;
  mode: SlotDetailPanelMode;
  monteurBadges?: WorklistSlotBadges;
  cmBadges?: WorklistCmBadges;
}

// Dot couleur par phase (cohérent SlotCard calendar).
const PHASE_DOT_COLOR: Record<ReturnType<typeof getPublicationPhase>, string> = {
  planned: "bg-gray-400",
  shooting: "bg-peach-500",
  production: "bg-stone-500",
  admin_review: "bg-peach-500",
  cm_review: "bg-sky-500",
  publishing: "bg-info-500",
  published: "bg-success-500",
  terminated: "bg-gray-300",
};

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

export function WorklistSlotCard({ slot, monteurBadges, cmBadges }: WorklistSlotCardProps) {
  const router = useRouter();
  const overdue = isSlotOverdue(slot);
  const phase = getPublicationPhase(slot.status);
  const phaseDotColor = PHASE_DOT_COLOR[phase];

  const showNewRushes = monteurBadges?.hasNewRushes === true;
  const versionPendingN = monteurBadges?.versionPendingNumber ?? null;
  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(`/publications/${slot.id}`);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/publications/${slot.id}`)}
      onKeyDown={handleKeyDown}
      className={[
        "group relative w-full text-left rounded-2xl px-4 py-3 cursor-pointer transition-all",
        "bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.14)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_8px_rgba(15,23,42,0.06),0_12px_28px_-12px_rgba(15,23,42,0.22)]",
        "hover:-translate-y-px",
        "focus:outline-none focus-visible:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]",
        overdue
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(201,113,133,0.4),0_2px_4px_rgba(15,23,42,0.04),0_10px_24px_-12px_rgba(201,113,133,0.3)]"
          : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex items-start gap-3">
        {/* Indicateur overdue ou dot phase */}
        <div className="shrink-0 mt-1.5">
          {overdue ? (
            <AlertCircle size={14} className="text-rose-600" />
          ) : (
            <span
              className={`inline-block h-2 w-2 rounded-full ${phaseDotColor}`}
              aria-hidden
            />
          )}
        </div>

        {/* Contenu principal */}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-gray-950 truncate leading-tight">
            {title}
          </p>
          <p className="mt-0.5 text-[12px] text-gray-500 truncate">
            @{slot.account.handle}
            {slot.account.name !== slot.account.handle && (
              <span className="text-gray-400"> · {slot.account.name}</span>
            )}
          </p>
          <p
            className={`mt-1 text-[11px] font-mono tabular-nums ${
              overdue ? "text-rose-700 font-medium" : "text-gray-400"
            }`}
          >
            {slot.scheduledAt ? (
              formatScheduledAt(slot.scheduledAt)
            ) : (
              <span className="uppercase tracking-widest text-[10px] font-semibold text-stone-500">
                En banque · sans date
              </span>
            )}
            {overdue && (
              <span className="ml-1.5 font-semibold uppercase text-rose-700 text-[10px] tracking-widest">
                En retard
              </span>
            )}
          </p>

          {/* Badges contextuels monteur */}
          {(showNewRushes || versionPendingN !== null) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {showNewRushes && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-peach-50/80 text-peach-700 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.2)]">
                  Nouveaux rushes
                </span>
              )}
              {versionPendingN !== null && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100/80 text-gray-600 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
                  V{versionPendingN} en révision admin
                </span>
              )}
            </div>
          )}

          {/* Badge contextuel CM */}
          {cmBadges?.statusLabel && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  cmBadges.statusClasses ??
                  "bg-gray-100 text-gray-600 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
                }`}
              >
                {cmBadges.statusLabel}
              </span>
            </div>
          )}
        </div>

        {/* Status badge + chevron */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-gray-50/80 text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
            {STATUS_LABELS[slot.status]}
          </span>
          <ChevronRight
            size={14}
            className="text-gray-300 group-hover:text-gray-700 transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * WorklistSection — section regroupée de slots dans une worklist home.
 *
 * Style MID Liquid Glass : header eyebrow + titre + count badge. Tone subtle
 * (juste la couleur du compteur change). Pas de bordure colorée saturée.
 * Collapsible optionnel (chevron leading), empty state minimal.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { WorklistSlotCard } from "./WorklistSlotCard";
import type { WorklistSlotBadges, WorklistCmBadges } from "./WorklistSlotCard";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";

interface WorklistSectionProps {
  title: string;
  slots: WorklistSlot[];
  mode: SlotDetailPanelMode;
  /**
   * Tonalité visuelle du compteur.
   * - "danger"  : rose (sections "En retard")
   * - "default" : neutre (sections principales)
   * - "muted"   : très léger (sections informatives / collapsibles)
   */
  tone?: "danger" | "default" | "muted";
  collapsible?: boolean;
  defaultOpen?: boolean;
  emptyMessage?: string;
  monteurBadgesMap?: Map<string, WorklistSlotBadges>;
  cmBadgesMap?: Map<string, WorklistCmBadges>;
}

const TONE_COUNT_CLS: Record<NonNullable<WorklistSectionProps["tone"]>, string> = {
  danger:  "bg-danger-50 text-danger-700 border border-danger-200",
  default: "bg-muted text-foreground border border-border",
  muted:   "bg-muted text-muted-foreground border border-border",
};

const TONE_TITLE_CLS: Record<NonNullable<WorklistSectionProps["tone"]>, string> = {
  danger:  "text-danger-700",
  default: "text-foreground",
  muted:   "text-muted-foreground",
};

export function WorklistSection({
  title,
  slots,
  mode,
  tone = "default",
  collapsible = false,
  defaultOpen = true,
  emptyMessage,
  monteurBadgesMap,
  cmBadgesMap,
}: WorklistSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <div
        className={[
          "flex items-center gap-2 mb-3",
          collapsible ? "cursor-pointer select-none" : "",
        ].filter(Boolean).join(" ")}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? open : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        {collapsible && (
          <span className="text-muted-foreground shrink-0">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        <h3 className={`text-[13px] font-semibold tracking-tight ${TONE_TITLE_CLS[tone]}`}>
          {title}
        </h3>
        <span
          className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[10.5px] font-medium tabular-nums ${TONE_COUNT_CLS[tone]}`}
        >
          {slots.length}
        </span>
      </div>

      {(!collapsible || open) && (
        <div className="space-y-2.5">
          {slots.length === 0 ? (
            collapsible ? (
              <p className="text-[11px] text-muted-foreground py-2">Aucune publication</p>
            ) : (
              <div className="inline-flex items-center gap-2.5 rounded-md bg-success-50 border border-success-200 px-4 py-3">
                <CheckCircle2 size={16} className="text-success-600 shrink-0" />
                <p className="text-[12.5px] text-success-700">
                  {emptyMessage ?? "Rien à traiter."}
                </p>
              </div>
            )
          ) : (
            slots.map((slot) => (
              <WorklistSlotCard
                key={slot.id}
                slot={slot}
                mode={mode}
                monteurBadges={monteurBadgesMap?.get(slot.id)}
                cmBadges={cmBadgesMap?.get(slot.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

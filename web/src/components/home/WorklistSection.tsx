"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { WorklistSlotCard } from "./WorklistSlotCard";
import type { WorklistSlot } from "@/types/worklist";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";

interface WorklistSectionProps {
  title: string;
  slots: WorklistSlot[];
  mode: SlotDetailPanelMode;
  /**
   * Tonalité visuelle du header de section.
   * - "danger"  : rouge (sections "En retard")
   * - "default" : indigo/neutre (sections d'action principale)
   * - "muted"   : gris clair (sections informatives ou secondaires)
   */
  tone?: "danger" | "default" | "muted";
  /**
   * Si true, la section peut être repliée. Par défaut false.
   * Utilisé pour "À venir" (default collapsed).
   */
  collapsible?: boolean;
  /** Si `collapsible` est true, contrôle l'état ouvert/fermé initial. Default: true (ouvert). */
  defaultOpen?: boolean;
}

const TONE_STYLES = {
  danger: {
    header: "text-red-700 font-semibold",
    count: "bg-red-100 text-red-700",
    divider: "border-red-100",
  },
  default: {
    header: "text-gray-800 font-semibold",
    count: "bg-indigo-100 text-indigo-700",
    divider: "border-gray-100",
  },
  muted: {
    header: "text-gray-500 font-medium",
    count: "bg-gray-100 text-gray-500",
    divider: "border-gray-100",
  },
};

export function WorklistSection({
  title,
  slots,
  mode,
  tone = "default",
  collapsible = false,
  defaultOpen = true,
}: WorklistSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const styles = TONE_STYLES[tone];

  return (
    <section>
      {/* Header */}
      <div
        className={`flex items-center gap-2 mb-2 ${collapsible ? "cursor-pointer select-none" : ""}`}
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
          <span className="text-gray-400">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        <h3 className={`text-sm ${styles.header}`}>{title}</h3>
        <span className={`ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium ${styles.count}`}>
          {slots.length}
        </span>
      </div>

      {/* Contenu */}
      {(!collapsible || open) && (
        <div className="space-y-2">
          {slots.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-2">Aucune publication</p>
          ) : (
            slots.map((slot) => (
              <WorklistSlotCard key={slot.id} slot={slot} mode={mode} />
            ))
          )}
        </div>
      )}

      <div className={`mt-4 mb-1 border-t ${styles.divider}`} />
    </section>
  );
}

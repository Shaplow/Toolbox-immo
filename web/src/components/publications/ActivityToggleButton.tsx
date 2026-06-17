"use client";

/**
 * ActivityToggleButton — V8 Phase 8.
 *
 * Bouton "📊 Voir l'activité" qui ouvre la timeline en modale, au lieu de
 * la rendre toujours visible en bas de la fiche. Gain : récupère ~25% de
 * viewport quand on n'en a pas besoin, et ne charge pas le DOM par défaut.
 *
 * Préserve la timeline existante (ActivityTimeline) — c'est juste un wrapper.
 */

import { useState } from "react";
import { Activity } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ActivityTimeline } from "./ActivityTimeline";
import type { ActivityItem } from "./ActivityTimeline";

interface Props {
  slotId: string;
  initialActivities: ActivityItem[];
  initialHasMore: boolean;
}

export function ActivityToggleButton({
  slotId,
  initialActivities,
  initialHasMore,
}: Props) {
  const [open, setOpen] = useState(false);
  const count = initialActivities.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border  hover:bg-white/85 transition-colors text-[12.5px] text-foreground focus-ring"
        title="Voir l'activité"
      >
        <Activity size={14} className="text-muted-foreground shrink-0" />
        <span>Activité</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded bg-muted/80 text-muted-foreground text-[10px] font-medium">
            {count}
            {initialHasMore && "+"}
          </span>
        )}
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} size="lg">
          <div className="p-5">
            <ActivityTimeline
              slotId={slotId}
              initialActivities={initialActivities}
              initialHasMore={initialHasMore}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

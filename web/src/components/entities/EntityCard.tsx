"use client";

import { useRouter } from "next/navigation";
import { Film, Clapperboard } from "lucide-react";
import { timeFr } from "@/lib/date/formatFr";
import {
  ENTITY_STATUS_BADGE,
  ENTITY_STATUS_DOT,
  ENTITY_STATUS_LABELS,
  type EntitySummary,
} from "@/types/entities";

/**
 * EntityCard — carte compacte d'une fiche à planning (ex-EventCard) dans le
 * calendrier de fiches. Click → fiche /fiches/[id]. Composant pur (pas de
 * DnD/bulk).
 */
export function EntityCard({ entity }: { entity: EntitySummary }) {
  const router = useRouter();
  const time = entity.scheduledAt ? timeFr(entity.scheduledAt) : "";
  const status = entity.status ?? "PLANNED";

  return (
    <button
      type="button"
      onClick={() => router.push(`/fiches/${entity.id}`)}
      className="w-full text-left rounded-md bg-card border border-border hover:bg-muted transition-colors px-2.5 py-2 focus-ring"
    >
      <div className="flex items-center gap-1.5">
        <span className={["shrink-0 w-2 h-2 rounded-full", ENTITY_STATUS_DOT[status]].join(" ")} />
        {time && <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{time}</span>}
        <span className="text-[12.5px] font-medium text-foreground truncate">{entity.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-3.5">
        {entity.account && (
          <span className="text-[11px] text-muted-foreground truncate">@{entity.account.handle}</span>
        )}
        <span
          className={[
            "ml-auto shrink-0 text-[10px] rounded px-1 py-0.5 border",
            ENTITY_STATUS_BADGE[status],
          ].join(" ")}
        >
          {ENTITY_STATUS_LABELS[status]}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 pl-3.5 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Film size={11} /> {entity._count.shootSlots} reel{entity._count.shootSlots > 1 ? "s" : ""}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clapperboard size={11} /> {entity._count.rushes} rush{entity._count.rushes > 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

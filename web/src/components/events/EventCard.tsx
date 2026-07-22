"use client";

import { useRouter } from "next/navigation";
import { Film, Clapperboard } from "lucide-react";
import {
  EVENT_STATUS_BADGE,
  EVENT_STATUS_DOT,
  EVENT_STATUS_LABELS,
  type ShootEventSummary,
} from "@/types/events";

/**
 * EventCard — carte compacte d'un événement de tournage dans le calendrier
 * d'événements. Click → fiche /events/[id]. Composant pur (pas de DnD/bulk).
 */
export function EventCard({ event }: { event: ShootEventSummary }) {
  const router = useRouter();
  const time = new Date(event.scheduledAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      type="button"
      onClick={() => router.push(`/events/${event.id}`)}
      className="w-full text-left rounded-md bg-card border border-border hover:bg-muted transition-colors px-2.5 py-2 focus-ring"
    >
      <div className="flex items-center gap-1.5">
        <span className={["shrink-0 w-2 h-2 rounded-full", EVENT_STATUS_DOT[event.status]].join(" ")} />
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{time}</span>
        <span className="text-[12.5px] font-medium text-foreground truncate">{event.title}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-3.5">
        {event.account && (
          <span className="text-[11px] text-muted-foreground truncate">@{event.account.handle}</span>
        )}
        <span
          className={[
            "ml-auto shrink-0 text-[10px] rounded px-1 py-0.5 border",
            EVENT_STATUS_BADGE[event.status],
          ].join(" ")}
        >
          {EVENT_STATUS_LABELS[event.status]}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 pl-3.5 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Film size={11} /> {event.reelsCount} reel{event.reelsCount > 1 ? "s" : ""}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clapperboard size={11} /> {event.rushesCount} rush{event.rushesCount > 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

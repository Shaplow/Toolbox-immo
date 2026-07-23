"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { EventCard } from "./EventCard";
import { CreateEventModal } from "./CreateEventModal";
import type { ShootEventSummary } from "@/types/events";

interface Option {
  id: string;
  name: string;
}

export interface EventsCalendarProps {
  initialEvents: ShootEventSummary[];
  initialWeekStartIso: string;
  isAdmin: boolean;
  accounts: { id: string; name: string; handle: string }[];
  properties: { id: string; label: string }[];
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

export function EventsCalendar({
  initialEvents,
  initialWeekStartIso,
  isAdmin,
  accounts,
  properties,
  videastes,
  monteurs,
  cms,
}: EventsCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => new Date(initialWeekStartIso));
  const [events, setEvents] = useState<ShootEventSummary[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Les events de la semaine initiale viennent du SSR — on ne refetch qu'au
  // changement de semaine.
  const didMountRef = useRef(false);
  // Séquencement : on annule le fetch précédent et on ignore toute réponse qui
  // n'est pas celle de la dernière requête (évite d'afficher une semaine périmée
  // sur double-clic / réponses hors-ordre).
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);

  const load = useCallback(async (monday: Date) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const from = new Date(monday);
      const to = addDays(monday, 6);
      to.setHours(23, 59, 59, 999);
      const res = await fetch(
        `/api/shoot-events?dateFrom=${from.toISOString()}&dateTo=${to.toISOString()}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: ShootEventSummary[] };
      if (seq === reqSeqRef.current) setEvents(data.events);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast.error("Impossible de charger les événements de cette semaine.");
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip le premier render (events déjà fournis en SSR).
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void load(weekStart);
  }, [weekStart, load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  const weekLabel = `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${addDays(
    weekStart,
    6,
  ).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Événements de tournage</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Planifiez un tournage, puis accrochez-y des reels au fil de l&apos;eau.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-card">
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="px-2 py-1.5 hover:bg-muted rounded-l-md focus-ring"
              aria-label="Semaine précédente"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(mondayOf(new Date()))}
              className="px-2.5 py-1.5 text-[12px] hover:bg-muted border-x border-border focus-ring"
            >
              Aujourd&apos;hui
            </button>
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="px-2 py-1.5 hover:bg-muted rounded-r-md focus-ring"
              aria-label="Semaine suivante"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          {isAdmin && (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Nouvel événement
            </Button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <CalendarClock size={14} />
        <span className="tabular-nums">{weekLabel}</span>
        {loading && <span className="text-[11px]">· chargement…</span>}
      </div>

      {events.length === 0 && !loading ? (
        <EmptyState
          icon={<CalendarClock size={20} className="text-muted-foreground" />}
          title="Aucun événement cette semaine"
          description={isAdmin ? "Créez un événement de tournage pour lancer une mission vidéaste." : "Aucun tournage planifié."}
          {...(isAdmin ? { cta: { label: "Nouvel événement", onClick: () => setCreateOpen(true) } } : {})}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {days.map((day, i) => {
            const isToday = sameDay(day, now);
            const dayEvents = events
              .filter((e) => sameDay(new Date(e.scheduledAt), day))
              .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
            return (
              <div key={i} className="min-h-[120px]">
                <div className="flex items-baseline gap-1.5 mb-1.5 px-0.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {DAY_LABELS[i].slice(0, 3)}
                  </span>
                  <span className={["text-[13px] tabular-nums", isToday ? "font-semibold text-primary" : "text-foreground"].join(" ")}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {dayEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <CreateEventModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          accounts={accounts}
          properties={properties}
          videastes={videastes}
          monteurs={monteurs}
          cms={cms}
        />
      )}
    </div>
  );
}

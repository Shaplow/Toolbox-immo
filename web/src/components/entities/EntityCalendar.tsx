"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { EntityCard } from "./EntityCard";
import { CreateEntityModal } from "./CreateEntityModal";
import type { EntitySummary, EntityTypeSummary } from "@/types/entities";

interface Option {
  id: string;
  name: string;
}

export interface EntityCalendarProps {
  type: EntityTypeSummary;
  isAdmin: boolean;
  accounts: { id: string; name: string; handle: string }[];
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

/**
 * EntityCalendar — vue planning hebdomadaire d'un type de fiche à planning
 * (ex-EventsCalendar « Tournage »). Port généralisé : plus de filtrage
 * dateFrom/dateTo côté serveur (listEntities n'en a pas — take 500), le
 * filtrage par semaine se fait client-side après un fetch unique par type.
 */
export function EntityCalendar({ type, isAdmin, accounts, videastes, monteurs, cms }: EntityCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/entities?typeId=${type.id}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entities: EntitySummary[] };
      if (seq === reqSeqRef.current) setEntities(data.entities);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast.error("Impossible de charger les fiches.");
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }, [type.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = new Date();

  const weekLabel = `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${addDays(
    weekStart,
    6,
  ).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;

  const typeNamePlural = type.namePlural ?? type.name;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{typeNamePlural}</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Planning hebdomadaire — {typeNamePlural.toLowerCase()} planifié(e)s.
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
              Nouvelle fiche
            </Button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <CalendarClock size={14} />
        <span className="tabular-nums">{weekLabel}</span>
        {loading && <span className="text-[11px]">· chargement…</span>}
      </div>

      {entities.length === 0 && !loading ? (
        <EmptyState
          icon={<CalendarClock size={20} className="text-muted-foreground" />}
          title={`Aucune fiche « ${type.name} »`}
          description={isAdmin ? "Créez une fiche pour lancer une mission." : "Aucune fiche planifiée."}
          {...(isAdmin ? { cta: { label: "Nouvelle fiche", onClick: () => setCreateOpen(true) } } : {})}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
          {days.map((day, i) => {
            const isToday = sameDay(day, now);
            const dayEntities = entities
              .filter((e) => e.scheduledAt && sameDay(new Date(e.scheduledAt), day))
              .sort(
                (a, b) =>
                  new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime(),
              );
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
                  {dayEntities.map((entity) => (
                    <EntityCard key={entity.id} entity={entity} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <CreateEntityModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            void load();
          }}
          type={type}
          accounts={accounts}
          videastes={videastes}
          monteurs={monteurs}
          cms={cms}
        />
      )}
    </div>
  );
}

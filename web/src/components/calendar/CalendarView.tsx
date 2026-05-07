"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Calendar } from "lucide-react";
import { DAY_LABELS, type PublicationSlot } from "@/types/calendar";
import { SlotCard } from "./SlotCard";
import { SlotDetailPanel } from "./SlotDetailPanel";
import { AddSlotModal } from "./AddSlotModal";
import { CalendarFilters, type CalendarFiltersState } from "./CalendarFilters";

interface Account {
  id: string;
  name: string;
  handle: string;
  offre: string;
}

interface CalendarViewProps {
  accounts: Account[];
}

/** Returns Monday of the week containing `date`. */
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function CalendarView({ accounts }: CalendarViewProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [slots, setSlots] = useState<PublicationSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicationSlot | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addDefaultDate, setAddDefaultDate] = useState<string | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [filters, setFilters] = useState<CalendarFiltersState>({
    accountId: "",
    status: "",
    contentType: "",
  });

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dateFrom = weekStart;
  const dateTo = addDays(weekStart, 6);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const dateToEnd = new Date(dateTo);
      dateToEnd.setHours(23, 59, 59, 999);
      const params = new URLSearchParams({
        dateFrom: dateFrom.toISOString(),
        dateTo: dateToEnd.toISOString(),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.contentType ? { contentType: filters.contentType } : {}),
      });
      const res = await fetch(`/api/calendar/slots?${params.toString()}`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      setSlots(await res.json() as PublicationSlot[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, filters]);

  useEffect(() => { void load(); }, [load]);

  function prevWeek() { setWeekStart((d) => addDays(d, -7)); }
  function nextWeek() { setWeekStart((d) => addDays(d, 7)); }
  function goToday() { setWeekStart(getMondayOf(new Date())); }

  function slotsForDay(day: Date) {
    return slots
      .filter((s) => isSameDay(new Date(s.scheduledAt), day))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  async function handleGenerate() {
    if (!confirm(`Générer les slots auto pour la semaine du ${weekStart.toLocaleDateString("fr-FR")} ?`)) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/calendar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom.toISOString(),
          dateTo: addDays(weekStart, 6).toISOString(),
        }),
      });
      if (!res.ok) throw new Error("Erreur lors de la génération");
      const result = await res.json() as { created: number; skipped: number };
      alert(`${result.created} slot(s) créé(s), ${result.skipped} ignoré(s) (existaient déjà).`);
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setGenerating(false);
    }
  }

  function handleSlotUpdated(updated: PublicationSlot) {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedSlot(updated);
  }

  function handleSlotDeleted(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
    setSelectedSlot(null);
  }

  function handleSlotCreated(slot: PublicationSlot) {
    setSlots((prev) => [...prev, slot]);
    setShowAdd(false);
  }

  const weekLabel = `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} – ${addDays(weekStart, 6).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;

  const today = new Date();

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Calendar size={13} /> Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={nextWeek}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <span className="text-sm font-medium text-gray-800">{weekLabel}</span>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <CalendarFilters accounts={accounts} filters={filters} onChange={setFilters} />

          <button
            type="button"
            onClick={() => { void load(); }}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            title="Rafraîchir"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>

          <button
            type="button"
            onClick={() => { void handleGenerate(); }}
            disabled={generating}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {generating ? "Génération…" : "Générer la semaine"}
          </button>

          <button
            type="button"
            onClick={() => { setAddDefaultDate(undefined); setShowAdd(true); }}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <Plus size={13} /> Slot
          </button>
        </div>
      </div>

      {/* Error */}
      {loadError && (
        <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
          {loadError}
        </div>
      )}

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {/* Day headers */}
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            const daySlots = slotsForDay(day);
            return (
              <div key={i} className="flex flex-col gap-2">
                {/* Header */}
                <div className={`text-center pb-2 border-b ${isToday ? "border-indigo-400" : "border-gray-200"}`}>
                  <p className={`text-xs font-medium ${isToday ? "text-indigo-600" : "text-gray-500"}`}>
                    {DAY_LABELS[i]}
                  </p>
                  <p className={`text-lg font-semibold ${isToday ? "text-indigo-700" : "text-gray-800"}`}>
                    {day.getDate()}
                  </p>
                  {daySlots.length > 0 && (
                    <p className="text-[10px] text-gray-400">{daySlots.length} slot{daySlots.length > 1 ? "s" : ""}</p>
                  )}
                </div>

                {/* Slots */}
                <div className="flex flex-col gap-2">
                  {daySlots.map((slot) => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      onClick={() => setSelectedSlot(slot)}
                    />
                  ))}

                  {/* Add button inline per day */}
                  <button
                    type="button"
                    onClick={() => {
                      setAddDefaultDate(day.toISOString().slice(0, 10));
                      setShowAdd(true);
                    }}
                    className="w-full text-center text-xs text-gray-300 hover:text-indigo-400 py-1.5 border border-dashed border-gray-200 hover:border-indigo-200 rounded-lg transition-colors"
                  >
                    <Plus size={12} className="inline" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Slot detail panel */}
      {selectedSlot && (
        <SlotDetailPanel
          slot={selectedSlot}
          onUpdated={handleSlotUpdated}
          onDeleted={handleSlotDeleted}
          onClose={() => setSelectedSlot(null)}
        />
      )}

      {/* Add slot modal */}
      {showAdd && (
        <AddSlotModal
          accounts={accounts}
          defaultDate={addDefaultDate}
          onCreated={handleSlotCreated}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

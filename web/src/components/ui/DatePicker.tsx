"use client";

/**
 * DatePicker — calendrier custom Liquid Glass (zero-dep).
 *
 * Doctrine :
 * - Trigger : ticket sans bandeau coloré (look uniforme glass).
 * - Popover calendar : surface-glass-strong + shadow-glass-popover + ring.
 * - Navigation mois (chevron < >), aujourd'hui dot signature, jour
 *   sélectionné = bulle blanche pressée (cohérent Pagination active).
 * - Cellules hover : glass tinted subtle.
 * - Respecte min/max : cellules hors plage = disabled.
 *
 * Format ISO YYYY-MM-DD pour la value (cohérent avec inputs natifs).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const MONTHS_FR_SHORT = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "aoû", "sep", "oct", "nov", "déc"];
const MONTHS_FR_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DOW_FR = ["L", "M", "M", "J", "V", "S", "D"]; // lundi-dimanche

// ─── Date helpers (zero-dep) ───────────────────────────────────────────────

function parseISO(iso: string): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

// Day-of-week with Monday=0..Sunday=6 (convention France).
function dowMondayFirst(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

// Build 42 days (6 weeks × 7) starting from Monday of the week containing the 1st.
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const firstDow = dowMondayFirst(first);
  const start = new Date(year, month, 1 - firstDow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// ─── Picker ────────────────────────────────────────────────────────────────

export function DatePicker({
  value,
  onChange,
  min,
  max,
  error,
  placeholder = "Choisir une date",
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() => parseISO(value) ?? new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const parsed = parseISO(value);
  const minDate = min ? parseISO(min) : null;
  const maxDate = max ? parseISO(max) : null;

  // Sync viewDate to value when value changes externally.
  useEffect(() => {
    const d = parseISO(value);
    if (d) setViewDate(d);
  }, [value]);

  // Close on outside click / ESC.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function selectDate(date: Date) {
    onChange(formatISO(date));
    setOpen(false);
    triggerRef.current?.focus();
  }

  const triggerBase =
    "relative inline-flex items-stretch h-10 w-fit min-w-[11rem] rounded-lg overflow-hidden transition-all cursor-pointer text-left";
  const triggerBg =
    "bg-gradient-to-b from-white to-white/85 backdrop-blur-[12px] backdrop-saturate-150";
  const triggerState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.55)]"
    : open
      ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.22),0_0_0_3px_rgba(10,10,10,0.1)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.05),0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.16),0_2px_6px_rgba(15,23,42,0.08)]";
  const triggerDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <div ref={containerRef} className={["relative w-fit", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[triggerBase, triggerBg, triggerState, triggerDisabled].filter(Boolean).join(" ")}
      >
        {/* Icône calendar leading */}
        <span className="shrink-0 flex items-center justify-center pl-2.5 pr-2 text-gray-500">
          <CalendarIcon size={14} />
        </span>

        {/* Divider */}
        <span className="self-stretch w-px bg-gray-200/50 my-2" aria-hidden />

        {parsed ? (
          <>
            <span className="shrink-0 flex items-center justify-center px-2.5 min-w-[2rem]">
              <span className="text-[15px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
                {String(parsed.getDate()).padStart(2, "0")}
              </span>
            </span>
            <span className="self-stretch w-px bg-gray-200/50 my-2" aria-hidden />
            <span className="flex-1 flex flex-col items-start justify-center px-2.5 min-w-[3rem]">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-800 leading-none">
                {MONTHS_FR_SHORT[parsed.getMonth()]}
              </span>
              <span className="text-[9px] text-gray-500 mt-0.5 leading-none tabular-nums">
                {parsed.getFullYear()}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 flex items-center justify-start px-2.5 text-[12px] text-gray-400 leading-none">
            {placeholder}
          </span>
        )}

        <span className="shrink-0 flex items-center justify-center pr-2.5 pl-1 text-gray-400">
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <CalendarPopover
          viewDate={viewDate}
          onViewDateChange={setViewDate}
          selectedDate={parsed}
          minDate={minDate}
          maxDate={maxDate}
          onSelect={selectDate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Calendar popover ──────────────────────────────────────────────────────

function CalendarPopover({
  viewDate,
  onViewDateChange,
  selectedDate,
  minDate,
  maxDate,
  onSelect,
}: {
  viewDate: Date;
  onViewDateChange: (d: Date) => void;
  selectedDate: Date | null;
  minDate: Date | null;
  maxDate: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const days = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const today = new Date();

  function prevMonth() {
    onViewDateChange(new Date(year, month - 1, 1));
  }
  function nextMonth() {
    onViewDateChange(new Date(year, month + 1, 1));
  }
  function isDisabled(d: Date): boolean {
    if (minDate && d < startOfDay(minDate)) return true;
    if (maxDate && d > startOfDay(maxDate)) return true;
    return false;
  }

  return (
    <div
      role="dialog"
      aria-label="Calendrier"
      className={[
        "absolute top-full left-0 mt-2 z-50 w-72 rounded-xl p-3",
        "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_6px_-1px_rgba(15,23,42,0.08),0_24px_56px_-12px_rgba(15,23,42,0.2)]",
      ].join(" ")}
    >
      {/* Header — mois année + nav */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Mois précédent"
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-gray-600 hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-all focus-ring"
        >
          <ChevronLeft size={14} />
        </button>
        <p className="text-[13px] font-semibold tracking-tight text-gray-950 leading-none">
          {MONTHS_FR_LONG[month]} <span className="tabular-nums text-gray-500 font-normal">{year}</span>
        </p>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Mois suivant"
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-gray-600 hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-all focus-ring"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* DOW header */}
      <div className="grid grid-cols-7 gap-0.5 mb-1.5 px-0.5">
        {DOW_FR.map((d, i) => (
          <span key={i} className="inline-flex items-center justify-center h-6 text-[10px] uppercase tracking-widest font-medium text-gray-400 select-none">
            {d}
          </span>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5 px-0.5">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isSelected = selectedDate ? isSameDay(d, selectedDate) : false;
          const isCurrentDay = isSameDay(d, today);
          const disabled = isDisabled(d);

          return (
            <button
              key={i}
              type="button"
              onClick={() => !disabled && onSelect(d)}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-current={isCurrentDay ? "date" : undefined}
              className={[
                "relative inline-flex items-center justify-center h-8 w-8 rounded-full text-[12px] font-medium tabular-nums transition-all focus-ring",
                isSelected
                  ? "bg-gradient-to-b from-white to-white/85 text-gray-950 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(15,23,42,0.1),0_2px_4px_rgba(15,23,42,0.08)]"
                  : disabled
                    ? "text-gray-300 cursor-not-allowed"
                    : !inMonth
                      ? "text-gray-300 hover:text-gray-500"
                      : "text-gray-700 hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
              ].join(" ")}
            >
              {d.getDate()}
              {isCurrentDay && !isSelected && (
                <span className="absolute bottom-1 h-0.5 w-0.5 rounded-full bg-peach-500" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer "Aujourd'hui" */}
      <div className="mt-3 pt-3 border-t border-white/40 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => {
            onSelect(new Date());
          }}
          className="text-[11px] font-medium text-gray-600 hover:text-gray-950 transition-colors"
        >
          Aujourd&apos;hui
        </button>
        {selectedDate && (
          <button
            type="button"
            onClick={() => {
              // Clear value via select empty — appel direct du parent.
              onSelect(selectedDate);
            }}
            className="text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors invisible"
          >
            Effacer
          </button>
        )}
      </div>
    </div>
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

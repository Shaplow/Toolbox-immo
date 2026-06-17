"use client";

/**
 * DatePicker — calendrier custom flat shadcn (zero-dep).
 *
 * Trigger : bouton bg-card border-input, layout "icon · jour · mois/année".
 * Popover : bg-popover border-border shadow-lg.
 * Jour sélectionné : bg-primary text-primary-foreground.
 * Aujourd'hui : dot primary.
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
const DOW_FR = ["L", "M", "M", "J", "V", "S", "D"];

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

function dowMondayFirst(date: Date): number {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

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

  useEffect(() => {
    const d = parseISO(value);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (d) setViewDate(d);
  }, [value]);

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

  const triggerState = error
    ? "border-danger-600 focus:ring-2 focus:ring-danger-600/30"
    : open
      ? "border-primary ring-2 ring-primary/30"
      : "border-input hover:border-zinc-300 focus:border-primary focus:ring-2 focus:ring-primary/30";

  return (
    <div ref={containerRef} className={["relative w-fit", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[
          "relative inline-flex items-stretch h-10 w-fit min-w-[11rem] rounded-md overflow-hidden transition-colors cursor-pointer text-left bg-card border",
          triggerState,
          disabled ? "opacity-60 cursor-not-allowed" : "",
        ].filter(Boolean).join(" ")}
      >
        <span className="shrink-0 flex items-center justify-center pl-2.5 pr-2 text-muted-foreground">
          <CalendarIcon size={14} />
        </span>
        <span className="self-stretch w-px bg-border my-2" aria-hidden />
        {parsed ? (
          <>
            <span className="shrink-0 flex items-center justify-center px-2.5 min-w-[2rem]">
              <span className="text-[15px] font-semibold tracking-tight text-foreground leading-none tabular-nums">
                {String(parsed.getDate()).padStart(2, "0")}
              </span>
            </span>
            <span className="self-stretch w-px bg-border my-2" aria-hidden />
            <span className="flex-1 flex flex-col items-start justify-center px-2.5 min-w-[3rem]">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground leading-none">
                {MONTHS_FR_SHORT[parsed.getMonth()]}
              </span>
              <span className="text-[9px] text-muted-foreground mt-0.5 leading-none tabular-nums">
                {parsed.getFullYear()}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 flex items-center justify-start px-2.5 text-[12px] text-muted-foreground leading-none">
            {placeholder}
          </span>
        )}
        <span className="shrink-0 flex items-center justify-center pr-2.5 pl-1 text-muted-foreground">
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
      className="absolute top-full left-0 mt-2 z-50 w-72 rounded-md p-3 bg-popover text-popover-foreground border border-border shadow-lg"
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Mois précédent"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-ring"
        >
          <ChevronLeft size={14} />
        </button>
        <p className="text-[13px] font-semibold tracking-tight text-foreground leading-none">
          {MONTHS_FR_LONG[month]} <span className="tabular-nums text-muted-foreground font-normal">{year}</span>
        </p>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Mois suivant"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-ring"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1.5 px-0.5">
        {DOW_FR.map((d, i) => (
          <span key={i} className="inline-flex items-center justify-center h-6 text-[10px] uppercase tracking-widest font-medium text-muted-foreground select-none">
            {d}
          </span>
        ))}
      </div>

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
                "relative inline-flex items-center justify-center h-8 w-8 rounded-md text-[12px] font-medium tabular-nums transition-colors focus-ring",
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : disabled
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : !inMonth
                      ? "text-muted-foreground/60 hover:text-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              {d.getDate()}
              {isCurrentDay && !isSelected && (
                <span className="absolute bottom-1 h-0.5 w-0.5 rounded-full bg-primary" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelect(new Date())}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Aujourd&apos;hui
        </button>
      </div>
    </div>
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

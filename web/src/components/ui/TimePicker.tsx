"use client";

/**
 * TimePicker — sélecteur d'heure flat shadcn (zero-dep).
 *
 * Trigger : bouton bg-card border-input.
 * Popover : bg-popover, 2 colonnes scrollables (heures + minutes).
 * Cellule sélectionnée : bg-primary text-primary-foreground.
 *
 * Format HH:MM (24h). Step minute configurable (5 / 15 / 30 / 60).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
  min?: string;
  max?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function parseHM(time: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function format(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hmToMinutes(h: number, m: number): number {
  return h * 60 + m;
}

export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  min,
  max,
  error,
  placeholder = "Heure",
  disabled = false,
  className,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoursListRef = useRef<HTMLDivElement>(null);
  const minutesListRef = useRef<HTMLDivElement>(null);

  const parsed = parseHM(value);
  const minHM = min ? parseHM(min) : null;
  const maxHM = max ? parseHM(max) : null;

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(
    () => Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep),
    [minuteStep]
  );

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

  useEffect(() => {
    if (!open || !parsed) return;
    const hEl = hoursListRef.current?.querySelector(`[data-h="${parsed.h}"]`) as HTMLElement | null;
    const mEl = minutesListRef.current?.querySelector(`[data-m="${parsed.m}"]`) as HTMLElement | null;
    hEl?.scrollIntoView({ block: "center" });
    mEl?.scrollIntoView({ block: "center" });
  }, [open, parsed]);

  function pickHour(h: number) {
    const current = parsed ?? { h: 0, m: 0 };
    if (isAllowed(h, current.m)) {
      onChange(format(h, current.m));
    } else {
      onChange(format(h, 0));
    }
  }
  function pickMinute(m: number) {
    const current = parsed ?? { h: 0, m: 0 };
    if (isAllowed(current.h, m)) {
      onChange(format(current.h, m));
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function isAllowed(h: number, m: number): boolean {
    const total = hmToMinutes(h, m);
    if (minHM && total < hmToMinutes(minHM.h, minHM.m)) return false;
    if (maxHM && total > hmToMinutes(maxHM.h, maxHM.m)) return false;
    return true;
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
          "relative inline-flex items-stretch h-10 w-fit min-w-[9rem] rounded-md overflow-hidden transition-colors cursor-pointer text-left bg-card border",
          triggerState,
          disabled ? "opacity-60 cursor-not-allowed" : "",
        ].filter(Boolean).join(" ")}
      >
        <span className="shrink-0 flex items-center justify-center pl-2.5 pr-2 text-muted-foreground">
          <Clock size={14} />
        </span>
        <span className="self-stretch w-px bg-border my-2" aria-hidden />

        {parsed ? (
          <span className="flex-1 inline-flex items-center justify-start px-2.5">
            <span className="text-[15px] font-semibold tracking-tight text-foreground leading-none tabular-nums">
              {String(parsed.h).padStart(2, "0")}
            </span>
            <span className="px-1 text-[15px] font-semibold text-muted-foreground leading-none" aria-hidden>:</span>
            <span className="text-[15px] font-semibold tracking-tight text-foreground leading-none tabular-nums">
              {String(parsed.m).padStart(2, "0")}
            </span>
          </span>
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
        <div
          role="dialog"
          aria-label="Sélecteur d'heure"
          className="absolute top-full left-0 mt-2 z-50 rounded-md p-2 bg-popover text-popover-foreground border border-border shadow-lg"
        >
          <div className="flex gap-1">
            <div className="flex flex-col">
              <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground text-center mb-1.5 select-none">
                Heure
              </p>
              <div
                ref={hoursListRef}
                className="h-56 w-14 overflow-y-auto [scrollbar-width:thin] space-y-0.5 pr-1"
              >
                {hours.map((h) => {
                  const isSel = parsed?.h === h;
                  const allowed = isAllowed(h, parsed?.m ?? 0);
                  return (
                    <button
                      key={h}
                      type="button"
                      data-h={h}
                      onClick={() => pickHour(h)}
                      disabled={!allowed}
                      className={cellCls(isSel, allowed)}
                    >
                      {String(h).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
            </div>

            <span className="self-stretch w-px bg-border my-6" aria-hidden />

            <div className="flex flex-col">
              <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground text-center mb-1.5 select-none">
                Min
              </p>
              <div
                ref={minutesListRef}
                className="h-56 w-14 overflow-y-auto [scrollbar-width:thin] space-y-0.5 pl-1"
              >
                {minutes.map((m) => {
                  const isSel = parsed?.m === m;
                  const allowed = isAllowed(parsed?.h ?? 0, m);
                  return (
                    <button
                      key={m}
                      type="button"
                      data-m={m}
                      onClick={() => pickMinute(m)}
                      disabled={!allowed}
                      className={cellCls(isSel, allowed)}
                    >
                      {String(m).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function cellCls(isSelected: boolean, allowed: boolean): string {
  return [
    "block w-full h-7 px-2 rounded-md text-[12px] font-medium tabular-nums transition-colors focus-ring",
    isSelected
      ? "bg-primary text-primary-foreground font-semibold"
      : !allowed
        ? "text-muted-foreground/50 cursor-not-allowed"
        : "text-foreground hover:bg-accent hover:text-accent-foreground",
  ].join(" ");
}

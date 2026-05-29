"use client";

/**
 * TimePicker — sélecteur d'heure custom Liquid Glass (zero-dep).
 *
 * Doctrine :
 * - Trigger : ticket sans bandeau coloré.
 * - Popover : 2 colonnes scrollables (heures + minutes), cellules glass.
 * - Heure / minute sélectionnée = bulle blanche pressée (cohérent picker).
 * - Cohérent visuellement avec DatePicker (mêmes shadows, mêmes hovers).
 *
 * Format HH:MM (24h). Step minute configurable (5 / 15 / 30 / 60).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Granularité minutes (5 / 15 / 30 / 60). Default 5. */
  minuteStep?: number;
  /** Min / max au format HH:MM (inclus). */
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

  // Scroll vers la valeur courante à l'ouverture.
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
      // Fallback à 00 minutes si combinaison illégale.
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

  const triggerBase =
    "relative inline-flex items-stretch h-10 w-fit min-w-[9rem] rounded-lg overflow-hidden transition-all cursor-pointer text-left";
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
        <span className="shrink-0 flex items-center justify-center pl-2.5 pr-2 text-gray-500">
          <Clock size={14} />
        </span>
        <span className="self-stretch w-px bg-gray-200/50 my-2" aria-hidden />

        {parsed ? (
          <span className="flex-1 inline-flex items-center justify-start px-2.5">
            <span className="text-[15px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
              {String(parsed.h).padStart(2, "0")}
            </span>
            <span className="px-1 text-[15px] font-semibold text-gray-300 leading-none" aria-hidden>
              :
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
              {String(parsed.m).padStart(2, "0")}
            </span>
          </span>
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
        <div
          role="dialog"
          aria-label="Sélecteur d'heure"
          className={[
            "absolute top-full left-0 mt-2 z-50 rounded-xl p-2",
            "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150",
            "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_6px_-1px_rgba(15,23,42,0.08),0_24px_56px_-12px_rgba(15,23,42,0.2)]",
          ].join(" ")}
        >
          <div className="flex gap-1">
            {/* Heures */}
            <div className="flex flex-col">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-400 text-center mb-1.5 select-none">
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

            <span className="self-stretch w-px bg-gray-200/50 my-6" aria-hidden />

            {/* Minutes */}
            <div className="flex flex-col">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-400 text-center mb-1.5 select-none">
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
    "block w-full h-7 px-2 rounded-md text-[12px] font-medium tabular-nums transition-all focus-ring",
    isSelected
      ? "bg-gradient-to-b from-white to-white/85 text-gray-950 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_-1px_0_rgba(15,23,42,0.1),0_2px_4px_rgba(15,23,42,0.08)]"
      : !allowed
        ? "text-gray-300 cursor-not-allowed"
        : "text-gray-700 hover:bg-white/60 hover:text-gray-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
  ].join(" ");
}

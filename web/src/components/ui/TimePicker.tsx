"use client";

/**
 * TimePicker — sélecteur d'heure format "ticket horloge".
 *
 * Doctrine Liquid Glass v2 — signature DA cohérente DatePicker :
 * - Bandeau sky vertical à gauche (signature froide pour temps planifié).
 * - Bloc HEURES (18px semibold).
 * - Bloc : (séparateur visuel).
 * - Bloc MINUTES (18px semibold).
 * - Chevron à droite.
 * - Click n'importe où ouvre le picker natif.
 *
 * Format affiché : HH:MM (24h).
 *
 * Props : value (HH:MM), onChange, step? (seconds), min?, max?, error?.
 */

import { useRef, type InputHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

interface TimePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: string;
  max?: string;
  error?: string;
  /** Placeholder si value vide. Default "Heure". */
  placeholder?: string;
}

function parseTime(time: string): { hours: string; minutes: string } | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const hours = m[1].padStart(2, "0");
  const minutes = m[2];
  return { hours, minutes };
}

export function TimePicker({
  value,
  onChange,
  step = 60,
  min,
  max,
  error,
  placeholder = "Heure",
  disabled,
  className,
  ...rest
}: TimePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseTime(value);

  const wrapperBase =
    "relative inline-flex items-stretch h-12 w-fit min-w-[10rem] rounded-lg overflow-hidden transition-all cursor-pointer";
  const wrapperBg =
    "bg-gradient-to-b from-white to-white/85 backdrop-blur-[12px] backdrop-saturate-150";
  const wrapperState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.55),0_1px_2px_rgba(220,38,38,0.1)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.7),0_0_0_3px_rgba(220,38,38,0.2)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.05),0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.16),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_6px_rgba(15,23,42,0.08)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.45)]";
  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <label
      className={[wrapperBase, wrapperBg, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}
    >
      {/* Bandeau sky signature à gauche — adouci, sans bord visible. */}
      <span
        className="shrink-0 w-1.5 bg-gradient-to-b from-sky-100 via-sky-200 to-sky-300"
        aria-hidden
      />

      {parsed ? (
        <span className="flex-1 inline-flex items-center justify-start px-3">
          {/* HEURES */}
          <span className="text-[18px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
            {parsed.hours}
          </span>
          {/* Separator ":" stylisé */}
          <span className="px-1.5 text-[18px] font-semibold text-gray-300 leading-none" aria-hidden>
            :
          </span>
          {/* MINUTES */}
          <span className="text-[18px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
            {parsed.minutes}
          </span>
        </span>
      ) : (
        /* État vide : placeholder unique, pas de blocs séparés ni dashes. */
        <span className="flex-1 flex items-center justify-start px-3 text-[13px] text-gray-400 leading-none">
          {placeholder}
        </span>
      )}

      {/* Chevron indicator */}
      <span className="shrink-0 flex items-center justify-center px-3 text-gray-400 group-focus-within:text-gray-700 transition-colors">
        <ChevronDown size={14} />
      </span>

      {/* Input natif overlay */}
      <input
        ref={inputRef}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        {...rest}
      />
    </label>
  );
}

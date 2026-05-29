"use client";

/**
 * DatePicker — sélecteur de date format "ticket calendrier".
 *
 * Doctrine Liquid Glass v2 — signature DA :
 * - Bandeau peach vertical à gauche (matière chaude signature).
 * - Bloc JOUR (semibold 18px tabular).
 * - Bloc MOIS / ANNÉE (11px gray, 2 lignes).
 * - Chevron à droite (indique sélecteur natif).
 * - Click n'importe où ouvre le picker natif (input opacity-0 en overlay).
 *
 * Native picker du navigateur → zero dep, a11y maximale, fonctionne offline.
 *
 * Props : value (ISO YYYY-MM-DD), onChange, min?, max?, error?, placeholder?.
 */

import { useRef, type InputHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  error?: string;
  /** Placeholder affiché si value est vide. Default "Choisir une date". */
  placeholder?: string;
}

const MONTHS_FR_SHORT = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "aoû", "sep", "oct", "nov", "déc"];

function parseISODate(iso: string): { day: string; month: string; year: string } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = m[3];
  if (monthIdx < 0 || monthIdx > 11) return null;
  return { day, month: MONTHS_FR_SHORT[monthIdx], year };
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  error,
  placeholder = "Choisir une date",
  disabled,
  className,
  ...rest
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseISODate(value);

  const wrapperBase =
    "relative inline-flex items-stretch h-12 w-fit min-w-[12rem] rounded-lg overflow-hidden transition-all cursor-pointer";
  const wrapperBg =
    "bg-gradient-to-b from-white to-white/85 backdrop-blur-[12px] backdrop-saturate-150";
  const wrapperState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.55),0_1px_2px_rgba(220,38,38,0.1)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.7),0_0_0_3px_rgba(220,38,38,0.2)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.05),0_1px_3px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.16),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_6px_rgba(15,23,42,0.08)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(245,158,107,0.4),0_0_0_3px_rgba(255,208,168,0.45)]";
  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <label
      className={[wrapperBase, wrapperBg, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}
    >
      {/* Bandeau peach signature à gauche. */}
      <span
        className="shrink-0 w-1.5 bg-gradient-to-b from-peach-200 to-peach-500 shadow-[inset_-1px_0_0_rgba(15,23,42,0.04)]"
        aria-hidden
      />

      {/* Bloc JOUR */}
      <span className="shrink-0 flex flex-col items-center justify-center px-3 min-w-[2.5rem]">
        {parsed ? (
          <span className="text-[18px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">
            {parsed.day}
          </span>
        ) : (
          <span className="text-[14px] text-gray-400 leading-none">—</span>
        )}
      </span>

      {/* Divider subtle */}
      <span className="self-stretch w-px bg-gray-200/50 my-2" aria-hidden />

      {/* Bloc MOIS / ANNÉE */}
      <span className="flex-1 flex flex-col items-start justify-center px-3 min-w-[3rem]">
        {parsed ? (
          <>
            <span className="text-[12px] font-semibold uppercase tracking-widest text-gray-800 leading-none">
              {parsed.month}
            </span>
            <span className="text-[10px] text-gray-500 mt-1 leading-none tabular-nums">
              {parsed.year}
            </span>
          </>
        ) : (
          <span className="text-[12px] text-gray-400 leading-none">{placeholder}</span>
        )}
      </span>

      {/* Chevron indicator */}
      <span className="shrink-0 flex items-center justify-center pr-3 pl-1.5 text-gray-400 group-focus-within:text-gray-700 transition-colors">
        <ChevronDown size={14} />
      </span>

      {/* Input natif overlay — opacity 0, full-area pour click partout. */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

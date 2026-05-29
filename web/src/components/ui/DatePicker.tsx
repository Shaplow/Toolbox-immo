"use client";

/**
 * DatePicker — sélecteur de date wrappé autour de `<input type="date">`.
 *
 * Doctrine Liquid Glass v2 :
 * - Look identique à Input default (bg sky-50/40 + ring inset + halo focus).
 * - Native picker du navigateur pour la sélection (zero-dep, a11y maximale).
 * - Format affiché : YYYY-MM-DD (HTML standard).
 * - Pour un picker calendrier custom plus riche, voir Phase 4 (TBD).
 *
 * Props : value (ISO string YYYY-MM-DD), onChange, min?, max?.
 */

import type { InputHTMLAttributes } from "react";
import { Calendar } from "lucide-react";

interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  error?: string;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  error,
  className,
  disabled,
  ...rest
}: DatePickerProps) {
  const wrapperBase =
    "group/dp flex items-center gap-2 w-full h-8 rounded-md px-2.5 transition-colors";
  const wrapperBg =
    "bg-sky-50/40 backdrop-blur-[10px] backdrop-saturate-150";
  const wrapperState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.55),0_1px_2px_rgba(220,38,38,0.1)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.7),0_0_0_3px_rgba(220,38,38,0.2)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)] hover:bg-sky-50/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.12)] focus-within:bg-sky-50/65 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]";
  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  return (
    <label className={[wrapperBase, wrapperBg, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
      <Calendar
        size={14}
        className="shrink-0 text-gray-400 group-focus-within/dp:text-gray-700 transition-colors"
      />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className="flex-1 min-w-0 bg-transparent text-[13px] text-gray-950 placeholder:text-gray-400 outline-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
        {...rest}
      />
    </label>
  );
}

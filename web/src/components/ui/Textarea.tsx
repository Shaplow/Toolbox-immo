"use client";

import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea — même esthétique que <Input>, sans icône (pas standard
 * sur les textareas), avec resize-y.
 */
interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function Textarea({ value, onChange, error, className, disabled, ...rest }: TextareaProps) {
  const base =
    "w-full rounded-md border bg-white px-2.5 py-2 text-[13px] text-gray-950 placeholder:text-gray-400 resize-y outline-none transition-colors";
  const stateClass = error
    ? "border-danger-600 focus:shadow-[var(--shadow-focus-ring-danger)]"
    : "border-gray-300 hover:border-gray-400 focus:border-gray-400 focus:shadow-[var(--shadow-focus-ring)]";
  const disabledClass = disabled ? "bg-gray-50 opacity-60 cursor-not-allowed" : "";

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      className={[base, stateClass, disabledClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

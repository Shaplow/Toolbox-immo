"use client";

import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea — même esthétique que <Input>, sans icône (pas standard
 * sur les textareas), avec resize-y.
 *
 * `variant?: "default" | "glass"` (Liquid Glass v2) — `glass` rend
 * la textarea transparente + halo pastel sky au focus. Pour formulaires
 * sur surface glass/tinted. Défaut "default" inchangé.
 */
interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  variant?: "default" | "glass";
}

export function Textarea({ value, onChange, error, variant = "default", className, disabled, ...rest }: TextareaProps) {
  const base =
    "w-full rounded-md border px-2.5 py-2 text-[13px] text-gray-950 placeholder:text-gray-400 resize-y outline-none transition-colors";

  const variantBase =
    variant === "glass"
      ? "bg-[var(--surface-glass-medium)] backdrop-blur-[8px] backdrop-saturate-150"
      : "bg-white";

  const stateClass = error
    ? "border-danger-600 focus:shadow-[var(--shadow-focus-ring-danger)]"
    : variant === "glass"
      ? "border-white/40 hover:border-sky-200 focus:border-sky-300 focus:shadow-[0_0_0_3px_rgba(169,209,230,0.32)]"
      : "border-gray-300 hover:border-gray-400 focus:border-gray-400 focus:shadow-[var(--shadow-focus-ring)]";

  const disabledClass = disabled ? "bg-gray-50 opacity-60 cursor-not-allowed" : "";

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      className={[base, variantBase, stateClass, disabledClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

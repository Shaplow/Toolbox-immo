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
    "w-full rounded-md px-2.5 py-2 text-[13px] text-gray-950 placeholder:text-gray-400 resize-y outline-none transition-colors";

  // Default = semi-verre. Glass = transparent + halo sky.
  const variantBase =
    variant === "glass"
      ? "bg-[var(--surface-glass-medium)] backdrop-blur-[8px] backdrop-saturate-150 border border-white/40"
      : "bg-gradient-to-b from-white to-white/85 backdrop-blur-[8px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.04)]";

  const stateClass = error
    ? variant === "glass"
      ? "border-danger-600 focus:shadow-[var(--shadow-focus-ring-danger)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.6),0_1px_2px_rgba(220,38,38,0.12)] focus:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(220,38,38,0.8),0_0_0_3px_rgba(220,38,38,0.22)]"
    : variant === "glass"
      ? "hover:border-sky-200 focus:border-sky-300 focus:shadow-[0_0_0_3px_rgba(169,209,230,0.32)]"
      : "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_1px_2px_rgba(15,23,42,0.05)] focus:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.2),0_0_0_3px_rgba(10,10,10,0.12)]";

  const disabledClass = disabled ? "opacity-60 cursor-not-allowed" : "";

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

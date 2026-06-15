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
  // v3 big bang DA — flat shadcn. Variant glass mappé vers default.
  void variant;

  const base =
    "w-full rounded-md px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground resize-y outline-none transition-colors bg-card border";

  const stateClass = error
    ? "border-danger-600 focus:ring-2 focus:ring-danger-600/30"
    : "border-input hover:border-zinc-300 focus:border-primary focus:ring-2 focus:ring-primary/30";

  const disabledClass = disabled ? "opacity-60 cursor-not-allowed" : "";

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

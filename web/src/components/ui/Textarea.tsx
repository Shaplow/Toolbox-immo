"use client";

import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea du design system. Même API que <Input> + resize-y.
 */
interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function Textarea({ value, onChange, error, className, ...rest }: TextareaProps) {
  const base =
    "w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-950 placeholder:text-gray-400 resize-y transition-colors disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed";
  const stateClass = error
    ? "border-danger-600 focus-ring-danger"
    : "border-gray-300 hover:border-gray-400 focus-ring";

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      className={[base, stateClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

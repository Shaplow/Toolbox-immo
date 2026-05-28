"use client";

import type { InputHTMLAttributes } from "react";

/**
 * Input texte du design system.
 *
 * - API contrôlée : `value` (string) + `onChange(value: string)`.
 * - `error?: string` → ring danger + border danger. La phrase d'erreur
 *   est rendue par <FormField>, pas ici.
 * - Focus : utility globale `focus-ring` (brand) ou `focus-ring-danger`
 *   si erreur. Pas de `focus:ring-2` ad hoc.
 */
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function Input({ value, onChange, error, className, ...rest }: InputProps) {
  const base =
    "w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-950 placeholder:text-gray-400 transition-colors disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed";
  const stateClass = error
    ? "border-danger-600 focus-ring-danger"
    : "border-gray-300 hover:border-gray-400 focus-ring";

  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      className={[base, stateClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

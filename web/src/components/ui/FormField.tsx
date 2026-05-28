"use client";

import type { ReactNode } from "react";

/**
 * Wrapper de champ formulaire — label + obligatoire + aide + erreur.
 *
 * - Label en text-xs gray-700, asterisk danger si required.
 * - Help texte gray-500 sous le champ (caché si error présent).
 * - Error texte danger-600 sous le champ.
 */
interface FormFieldProps {
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
}

export function FormField({ label, required = false, help, error, children }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-gray-700 font-medium">
        {label}
        {required && <span className="text-danger-600 ml-0.5" aria-hidden>*</span>}
      </span>
      {children}
      {help && !error && <span className="text-[11px] text-gray-500">{help}</span>}
      {error && (
        <span className="text-[11px] text-danger-600" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

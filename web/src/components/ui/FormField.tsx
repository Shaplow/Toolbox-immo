"use client";

import type { ReactNode } from "react";

/**
 * Wrapper de champ formulaire — pattern Linear : label eyebrow tiny
 * uppercase, gap serré, help/error en text micro.
 *
 * - Label en text-[10px] uppercase tracking-widest gray-500 font-medium.
 * - Required : petit point danger sans asterisk (plus sobre).
 * - Help : text-[11px] gray-500, caché si error.
 * - Error : text-[11px] danger-600, role=alert.
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
    <label className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
        {label}
        {required && (
          <span
            className="inline-block h-1 w-1 rounded-full bg-danger-600"
            aria-hidden
            title="Requis"
          />
        )}
      </span>
      {children}
      {help && !error && <span className="text-[11px] text-muted-foreground">{help}</span>}
      {error && (
        <span className="text-[11px] text-danger-600" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

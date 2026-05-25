"use client";

import type { ReactNode } from "react";

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
      <span className="text-xs text-gray-600 font-medium">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
      {help && !error && <span className="text-xs text-gray-400">{help}</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </label>
  );
}

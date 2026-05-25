"use client";

import type { InputHTMLAttributes } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;  // si présent → ring rouge
}

export function Input({ value, onChange, error, className, ...rest }: InputProps) {
  const base = "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed";
  const stateClass = error
    ? "border-red-300 focus:ring-red-300"
    : "border-gray-200 focus:ring-indigo-300";

  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[base, stateClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

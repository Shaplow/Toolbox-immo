"use client";

import type { TextareaHTMLAttributes } from "react";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function Textarea({ value, onChange, error, className, ...rest }: TextareaProps) {
  const base =
    "w-full rounded-lg border px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed";
  const stateClass = error
    ? "border-red-300 focus:ring-red-300"
    : "border-gray-200 focus:ring-indigo-300";

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={[base, stateClass, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

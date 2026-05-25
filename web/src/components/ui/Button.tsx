"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed";

  const sizeClasses = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";

  const variantClasses = {
    primary:   "bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-400",
    secondary: "bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 focus:ring-indigo-300",
    ghost:     "bg-transparent hover:bg-gray-100 text-gray-700 focus:ring-gray-300",
    danger:    "bg-red-600 hover:bg-red-700 text-white focus:ring-red-400",
  }[variant];

  const iconSize = size === "sm" ? 12 : 14;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[base, sizeClasses, variantClasses, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon ? <Icon size={iconSize} /> : null}
      {children}
    </button>
  );
}

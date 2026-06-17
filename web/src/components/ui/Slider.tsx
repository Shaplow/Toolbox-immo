"use client";

import type { CSSProperties } from "react";

/**
 * Slider — input range stylé flat shadcn.
 *
 * Track gradient primary (filled) / muted (rest). Thumb white rounded-full.
 * La prop `accent` (legacy v2) est mappée vers primary.
 */
type SliderProps = {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  showValue?: boolean;
  accent?: "default" | "peach" | "sage" | "sky";
  className?: string;
};

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  showValue = true,
  accent: _accent = "default",
  className,
}: SliderProps) {
  void _accent;
  const pct = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct}%, var(--color-muted) ${pct}%, var(--color-muted) 100%)`,
  };

  const displayValue = step < 1 ? value.toFixed(2) : String(Math.round(value));

  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      {label && (
        <span className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={trackStyle}
          className={[
            "flex-1 h-2 rounded-full appearance-none cursor-pointer focus-ring",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-white",
            "[&::-webkit-slider-thumb]:cursor-pointer",
            "[&::-webkit-slider-thumb]:shadow-sm",
            "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border",
            "[&::-webkit-slider-thumb]:transition-transform",
            "hover:[&::-webkit-slider-thumb]:scale-110",
            "active:[&::-webkit-slider-thumb]:scale-105",
            "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-white",
            "[&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border",
            "[&::-moz-range-thumb]:cursor-pointer",
            "[&::-moz-range-thumb]:shadow-sm",
            disabled ? "opacity-50 cursor-not-allowed [&::-webkit-slider-thumb]:cursor-not-allowed" : "",
          ].filter(Boolean).join(" ")}
        />
        {showValue && (
          <span className="text-[12px] font-mono text-foreground tabular-nums min-w-[3rem] text-right select-none">
            {displayValue}{unit ?? ""}
          </span>
        )}
      </div>
    </div>
  );
}

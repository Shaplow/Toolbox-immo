"use client";

import type { CSSProperties } from "react";

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
  className,
}: SliderProps) {
  const pct = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`,
  };

  const displayValue = step < 1 ? value.toFixed(2) : String(Math.round(value));

  return (
    <div className={["flex flex-col gap-1", className].filter(Boolean).join(" ")}>
      {label && (
        <span className="text-xs font-medium text-gray-600">{label}</span>
      )}
      <div className="flex items-center gap-2">
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
            "flex-1 h-1.5 rounded-full appearance-none cursor-pointer",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-indigo-600",
            "[&::-webkit-slider-thumb]:cursor-pointer",
            "[&::-webkit-slider-thumb]:shadow-sm",
            "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-indigo-600",
            "[&::-moz-range-thumb]:border-0",
            "[&::-moz-range-thumb]:cursor-pointer",
            disabled ? "opacity-50 cursor-not-allowed [&::-webkit-slider-thumb]:cursor-not-allowed" : "",
          ].filter(Boolean).join(" ")}
        />
        {showValue && (
          <span className="text-xs font-mono text-gray-700 tabular-nums min-w-[3rem] text-right select-none">
            {displayValue}{unit ?? ""}
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";

/**
 * Slider — input range stylé mono.
 *
 * Track gradient gray-950 (filled) / gray-200 (rest). Thumb gray-950
 * rounded-full. Focus ring mono.
 *
 * - `label?` : libellé optionnel (Geist text-xs uppercase eyebrow).
 * - `value` / `onChange` : contrôlé.
 * - `min`/`max`/`step` : standard.
 * - `unit?` : suffixe affiché à droite (ex: "px", "s", "%").
 * - `showValue` : afficher la valeur numérique (default true).
 * - `accent?: "default" | "peach" | "sage" | "sky"` (Liquid Glass v2) —
 *   track filled passe en gradient soft de la teinte pastel choisie.
 *   Défaut "default" (graphite) inchangé.
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

const ACCENT_FILLED: Record<NonNullable<SliderProps["accent"]>, string> = {
  default: "#1f2937",
  peach:   "#f59e6b",
  sage:    "#6fa280",
  sky:     "#4d96bf",
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
  accent = "default",
  className,
}: SliderProps) {
  const pct = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const filledColor = ACCENT_FILLED[accent];
  // CSS var consommée par les pseudo-elements via arbitrary value Tailwind.
  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, ${filledColor} 0%, ${filledColor} ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`,
    ["--slider-thumb-bg" as string]: filledColor,
  };

  const displayValue = step < 1 ? value.toFixed(2) : String(Math.round(value));

  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      {label && (
        <span className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
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
            // Ring inset signature autour du track (rail glass).
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),inset_0_-1px_0_rgba(15,23,42,0.06),inset_0_0_0_1px_rgba(15,23,42,0.05)]",
            // Thumb webkit — bouton blanc liquid avec ring inset spéculaire
            // + ombre proche forte (relief tactile macOS).
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-white",
            "[&::-webkit-slider-thumb]:cursor-pointer",
            "[&::-webkit-slider-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.1),0_1px_2px_rgba(15,23,42,0.18),0_2px_6px_-1px_rgba(15,23,42,0.16)]",
            "[&::-webkit-slider-thumb]:border-0",
            "[&::-webkit-slider-thumb]:transition-transform",
            "hover:[&::-webkit-slider-thumb]:scale-110",
            "active:[&::-webkit-slider-thumb]:scale-105",
            // Thumb firefox.
            "[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-white",
            "[&::-moz-range-thumb]:border-0",
            "[&::-moz-range-thumb]:cursor-pointer",
            "[&::-moz-range-thumb]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.18),0_2px_6px_-1px_rgba(15,23,42,0.16)]",
            disabled ? "opacity-50 cursor-not-allowed [&::-webkit-slider-thumb]:cursor-not-allowed" : "",
          ].filter(Boolean).join(" ")}
        />
        {showValue && (
          <span className="text-[12px] font-mono text-gray-700 tabular-nums min-w-[3rem] text-right select-none">
            {displayValue}{unit ?? ""}
          </span>
        )}
      </div>
    </div>
  );
}

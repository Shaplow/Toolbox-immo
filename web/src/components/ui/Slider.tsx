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
  /**
   * Rend la valeur saisissable au clavier au lieu d'un simple affichage.
   * Utile quand la plage utile du curseur est plus resserrée que la plage
   * réellement autorisée : le curseur sert au réglage au doigt, le champ
   * donne accès aux valeurs exactes ou extrêmes.
   */
  editable?: boolean;
  /** Bornes du champ de saisie. Par défaut celles du curseur. */
  inputMin?: number;
  inputMax?: number;
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
  editable = false,
  inputMin,
  inputMax,
}: SliderProps) {
  void _accent;
  const pct = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const boundMin = inputMin ?? min;
  const boundMax = inputMax ?? max;
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
        {showValue && (editable ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <input
              type="number"
              min={boundMin}
              max={boundMax}
              step={step}
              value={value}
              disabled={disabled}
              aria-label={label}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isNaN(next)) return;
                onChange(Math.min(boundMax, Math.max(boundMin, next)));
              }}
              className="w-14 rounded-md border border-input bg-card px-1.5 py-0.5 text-[12px] font-mono text-foreground tabular-nums text-right focus-ring disabled:opacity-50"
            />
            {unit && <span className="text-[11px] text-muted-foreground select-none">{unit}</span>}
          </div>
        ) : (
          <span className="text-[12px] font-mono text-foreground tabular-nums min-w-[3rem] text-right select-none">
            {displayValue}{unit ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

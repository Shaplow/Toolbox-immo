"use client";

/**
 * Progress — indicateur de progression linéaire ou circulaire.
 *
 * Doctrine Liquid Glass v2 :
 * - Track ring inset signature glass.
 * - Fill : gradient color + highlight intérieur subtle (matière).
 * - Variant linear (default) : barre horizontale.
 * - Variant circular : SVG cercle stroke avec backdrop-blur du label.
 * - Accent : default (gray-800 graphite), peach, sage, sky (Coastal Studio).
 * - Indeterminate : shimmer animé pour les jobs sans % connu.
 *
 * Sizes : sm (h-1 / 24px circ) | md (h-1.5 / 32px circ) | lg (h-2 / 48px circ).
 */

import type { CSSProperties } from "react";

type Accent = "default" | "peach" | "sage" | "sky";
type Variant = "linear" | "circular";
type Size = "sm" | "md" | "lg";

interface ProgressProps {
  value?: number;
  max?: number;
  variant?: Variant;
  size?: Size;
  accent?: Accent;
  indeterminate?: boolean;
  /** Affiche la valeur (linear: à droite ; circular: au centre). */
  showValue?: boolean;
  className?: string;
}

const ACCENT_FILL: Record<Accent, string> = {
  default: "#1f2937",
  peach:   "#f59e6b",
  sage:    "#6fa280",
  sky:     "#4d96bf",
};

const ACCENT_LIGHT: Record<Accent, string> = {
  default: "#374151",
  peach:   "#fdcfa3",
  sage:    "#a5cdaf",
  sky:     "#85bcd9",
};

const LINEAR_HEIGHT: Record<Size, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const CIRCULAR_PX: Record<Size, number> = {
  sm: 24,
  md: 32,
  lg: 48,
};

const CIRCULAR_STROKE: Record<Size, number> = {
  sm: 2.5,
  md: 3,
  lg: 4,
};

export function Progress({
  value = 0,
  max = 100,
  variant = "linear",
  size = "md",
  accent = "default",
  indeterminate = false,
  showValue = false,
  className,
}: ProgressProps) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  if (variant === "circular") {
    return (
      <CircularProgress
        pct={pct}
        size={size}
        accent={accent}
        indeterminate={indeterminate}
        showValue={showValue}
        className={className}
      />
    );
  }

  // ─── Linear ──────────────────────────────────────────────────────────────

  const fill = ACCENT_FILL[accent];
  const fillLight = ACCENT_LIGHT[accent];

  const fillStyle: CSSProperties = indeterminate
    ? {
        background: `linear-gradient(90deg, transparent 0%, ${fillLight} 30%, ${fill} 50%, ${fillLight} 70%, transparent 100%)`,
        backgroundSize: "200% 100%",
      }
    : {
        width: `${pct}%`,
        background: `linear-gradient(180deg, ${fillLight} 0%, ${fill} 100%)`,
      };

  return (
    <div className={["flex items-center gap-3", className ?? ""].filter(Boolean).join(" ")}>
      <div
        className={[
          "flex-1 rounded-full overflow-hidden",
          "bg-white/40 backdrop-blur-[6px]",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04)]",
          LINEAR_HEIGHT[size],
        ].join(" ")}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={[
            "h-full rounded-full",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
            indeterminate ? "animate-[shimmer_1.6s_ease-in-out_infinite] w-full" : "transition-all",
          ].join(" ")}
          style={fillStyle}
        />
      </div>
      {showValue && !indeterminate && (
        <span className="shrink-0 text-[11px] font-mono text-gray-700 tabular-nums min-w-[3rem] text-right">
          {Math.round(pct)}%
        </span>
      )}
      <style jsx>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

function CircularProgress({
  pct,
  size,
  accent,
  indeterminate,
  showValue,
  className,
}: {
  pct: number;
  size: Size;
  accent: Accent;
  indeterminate: boolean;
  showValue: boolean;
  className?: string;
}) {
  const px = CIRCULAR_PX[size];
  const stroke = CIRCULAR_STROKE[size];
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const fill = ACCENT_FILL[accent];
  const fillLight = ACCENT_LIGHT[accent];

  return (
    <span
      className={["relative inline-flex items-center justify-center", className ?? ""].filter(Boolean).join(" ")}
      style={{ width: px, height: px }}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={px} height={px} className={indeterminate ? "animate-spin" : ""} style={{ animationDuration: "1.4s" }}>
        <defs>
          <linearGradient id={`prog-grad-${accent}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={fillLight} />
            <stop offset="100%" stopColor={fill} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          stroke="rgba(15,23,42,0.08)"
          strokeWidth={stroke}
        />
        {/* Fill */}
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          stroke={`url(#prog-grad-${accent})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={indeterminate ? circumference * 0.7 : dashOffset}
          transform={`rotate(-90 ${px / 2} ${px / 2})`}
          className="transition-all"
        />
      </svg>
      {showValue && !indeterminate && (
        <span className="absolute text-[10px] font-mono text-gray-700 tabular-nums">
          {Math.round(pct)}
        </span>
      )}
    </span>
  );
}

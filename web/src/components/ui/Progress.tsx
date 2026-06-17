"use client";

/**
 * Progress — indicateur de progression linéaire ou circulaire.
 *
 * Track bg-muted, fill bg-primary (unique accent en DA v3).
 * Indeterminate : shimmer animé pour jobs sans % connu.
 *
 * Sizes : sm (h-1 / 24px circ) | md (h-1.5 / 32px circ) | lg (h-2 / 48px circ).
 * La prop `accent` est legacy et mappée vers primary.
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
  showValue?: boolean;
  className?: string;
}

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
  accent: _accent = "default",
  indeterminate = false,
  showValue = false,
  className,
}: ProgressProps) {
  void _accent;
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  if (variant === "circular") {
    return (
      <CircularProgress
        pct={pct}
        size={size}
        indeterminate={indeterminate}
        showValue={showValue}
        className={className}
      />
    );
  }

  const fillStyle: CSSProperties = indeterminate
    ? {}
    : { width: `${pct}%` };

  return (
    <div className={["flex items-center gap-3", className ?? ""].filter(Boolean).join(" ")}>
      <div
        className={["flex-1 rounded-full overflow-hidden bg-muted", LINEAR_HEIGHT[size]].join(" ")}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={[
            "h-full rounded-full bg-primary",
            indeterminate ? "animate-pulse w-1/3" : "transition-all",
          ].join(" ")}
          style={fillStyle}
        />
      </div>
      {showValue && !indeterminate && (
        <span className="shrink-0 text-[11px] font-mono text-muted-foreground tabular-nums min-w-[3rem] text-right">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}

function CircularProgress({
  pct,
  size,
  indeterminate,
  showValue,
  className,
}: {
  pct: number;
  size: Size;
  indeterminate: boolean;
  showValue: boolean;
  className?: string;
}) {
  const px = CIRCULAR_PX[size];
  const stroke = CIRCULAR_STROKE[size];
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

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
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={stroke}
        />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          className="stroke-primary"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={indeterminate ? circumference * 0.7 : dashOffset}
          transform={`rotate(-90 ${px / 2} ${px / 2})`}
          style={{ transition: "stroke-dashoffset 0.3s ease" }}
        />
      </svg>
      {showValue && !indeterminate && (
        <span className="absolute text-[10px] font-mono text-foreground tabular-nums">
          {Math.round(pct)}
        </span>
      )}
    </span>
  );
}

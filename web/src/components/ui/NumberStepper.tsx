"use client";

/**
 * NumberStepper — input numérique avec boutons +/− latéraux.
 *
 * Use cases : nudge de frame (builder), durée (transcription), quantité.
 * Density Linear : h-8, padding serré, dividers visibles.
 */

import { useRef } from "react";
import { Minus, Plus } from "lucide-react";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  error,
  className,
}: NumberStepperProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function clamp(v: number): number {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  }

  function increment() {
    onChange(clamp(value + step));
  }

  function decrement() {
    onChange(clamp(value - step));
  }

  const canDecrement = !disabled && (min === undefined || value > min);
  const canIncrement = !disabled && (max === undefined || value < max);

  const wrapperState = error
    ? "border-danger-600 focus-within:ring-2 focus-within:ring-danger-600/30"
    : "border-input hover:border-zinc-300 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30";

  const stepBtnCls =
    "shrink-0 h-full w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent focus-ring transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div
      className={[
        "flex items-center w-fit h-8 rounded-md transition-colors bg-card border",
        wrapperState,
        disabled ? "opacity-60 cursor-not-allowed" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        onClick={decrement}
        disabled={!canDecrement}
        aria-label="Diminuer"
        className={stepBtnCls + " rounded-l-md"}
      >
        <Minus size={12} />
      </button>
      <span className="h-4 w-px bg-border" aria-hidden />
      <input
        ref={inputRef}
        type="number"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v));
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className="w-14 h-full bg-transparent text-center text-[13px] text-foreground font-medium tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {unit && (
        <>
          <span className="h-4 w-px bg-border" aria-hidden />
          <span className="shrink-0 pl-2 pr-2 text-[11px] font-mono text-muted-foreground select-none">{unit}</span>
        </>
      )}
      <span className="h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={increment}
        disabled={!canIncrement}
        aria-label="Augmenter"
        className={stepBtnCls + " rounded-r-md"}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

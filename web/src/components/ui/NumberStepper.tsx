"use client";

/**
 * NumberStepper — input numérique avec boutons +/− latéraux.
 *
 * Use cases : nudge de frame (builder), durée (transcription), quantité,
 * paramètres avec unité (px, s, %, °).
 *
 * Doctrine Liquid Glass v2 :
 * - Wrapper : look identique à Input default (bg sky-50/40 + ring inset).
 * - Boutons − / + : ButtonIcon glass intégrés latéralement, séparés du
 *   champ par un divider subtle.
 * - Champ central : centered text + tabular-nums.
 * - Unité affichée à droite si fournie (px, s, %, etc.).
 * - Keyboard : arrow up/down dans le champ pour step.
 */

import { useRef } from "react";
import { Minus, Plus } from "lucide-react";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Unité affichée à droite (ex: "px", "s", "%", "°"). */
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

  const wrapperBase =
    "group/ns flex items-center w-fit h-8 rounded-md transition-colors";
  const wrapperBg =
    "bg-sky-50/40 backdrop-blur-[10px] backdrop-saturate-150";
  const wrapperState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.55)]"
    : "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]";
  const wrapperDisabled = disabled ? "opacity-60 cursor-not-allowed" : "";

  const stepBtnCls =
    "shrink-0 h-full w-7 inline-flex items-center justify-center text-gray-600 hover:text-gray-950 hover:bg-white/50 focus-ring transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div className={[wrapperBase, wrapperBg, wrapperState, wrapperDisabled, className ?? ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        onClick={decrement}
        disabled={!canDecrement}
        aria-label="Diminuer"
        className={stepBtnCls + " rounded-l-md"}
      >
        <Minus size={12} />
      </button>
      <span className="h-4 w-px bg-gray-200/60" aria-hidden />
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
        className="w-14 h-full bg-transparent text-center text-[13px] text-gray-950 font-medium tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {unit && (
        <>
          <span className="h-4 w-px bg-gray-200/60" aria-hidden />
          <span className="shrink-0 pl-2 pr-2 text-[11px] font-mono text-gray-500 select-none">{unit}</span>
        </>
      )}
      <span className="h-4 w-px bg-gray-200/60" aria-hidden />
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

"use client";

/**
 * Stepper — chaîne de production / progression à étapes.
 *
 * Factorise le pattern ProductionChain (web/src/components/publications)
 * en composant réutilisable. Use cases : fiche pub, onboarding, wizard
 * formulaire, status d'un job.
 *
 * Doctrine Liquid Glass v2 :
 * - Variant `linear` (default) : étapes connectées par ligne, dot signé.
 * - Variant `glass` : étapes posées sur surface-glass-soft, dot avec
 *   ring inset spéculaire.
 * - Variant `compact` : version minimaliste pour Drawer / panel latéral.
 * - Orientation horizontal | vertical.
 * - Status par étape : todo | in_progress | done | blocked.
 *
 * Pas d'API onClick par défaut (les steps sont informatives). Pour rendre
 * cliquable, passer onClickStep.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Circle, AlertCircle, Loader2 } from "lucide-react";

export type StepStatus = "todo" | "in_progress" | "done" | "blocked";

export interface Step {
  id: string;
  label: ReactNode;
  description?: string;
  status?: StepStatus;
  icon?: LucideIcon;
}

type Variant = "linear" | "glass" | "compact";
type Orientation = "horizontal" | "vertical";

interface StepperProps {
  steps: Step[];
  variant?: Variant;
  orientation?: Orientation;
  /** Index ou id de l'étape active (override le status par étape). */
  active?: string | number;
  /** Click handler — si fourni, les steps deviennent cliquables. */
  onClickStep?: (step: Step) => void;
  className?: string;
}

const STATUS_DOT: Record<StepStatus, string> = {
  todo:        "bg-white/70 text-gray-400",
  in_progress: "bg-sky-100/80 text-sky-700",
  done:        "bg-sage-100/80 text-sage-700",
  blocked:     "bg-rose-100/80 text-rose-700",
};

const STATUS_DOT_RING: Record<StepStatus, string> = {
  todo:        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]",
  in_progress: "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)]",
  done:        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.32)]",
  blocked:     "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.32)]",
};

const STATUS_LABEL: Record<StepStatus, string> = {
  todo:        "text-gray-600",
  in_progress: "text-gray-950 font-medium",
  done:        "text-gray-950 font-medium",
  blocked:     "text-rose-700 font-medium",
};

const STATUS_LINE: Record<StepStatus, string> = {
  todo:        "bg-gray-200/60",
  in_progress: "bg-gradient-to-r from-sky-300 to-gray-200/60",
  done:        "bg-sage-300/70",
  blocked:     "bg-rose-300/70",
};

function StatusIcon({ status, fallback: Fallback, size = 12 }: { status: StepStatus; fallback?: LucideIcon; size?: number }) {
  if (status === "done") return <Check size={size} strokeWidth={2.5} />;
  if (status === "in_progress") return <Loader2 size={size} className="animate-spin" strokeWidth={2} />;
  if (status === "blocked") return <AlertCircle size={size} />;
  if (Fallback) return <Fallback size={size} />;
  return <Circle size={size} strokeWidth={1.5} />;
}

export function Stepper({
  steps,
  variant = "linear",
  orientation = "horizontal",
  active,
  onClickStep,
  className,
}: StepperProps) {
  // Résolution de l'index actif (override par "in_progress" sur ce step).
  const activeIdx = (() => {
    if (active === undefined) return -1;
    if (typeof active === "number") return active;
    return steps.findIndex((s) => s.id === active);
  })();

  const resolveStatus = (step: Step, idx: number): StepStatus => {
    if (idx === activeIdx) return "in_progress";
    if (activeIdx >= 0 && idx < activeIdx) return "done";
    return step.status ?? "todo";
  };

  if (orientation === "vertical") {
    return (
      <VerticalStepper
        steps={steps}
        variant={variant}
        resolveStatus={resolveStatus}
        onClickStep={onClickStep}
        className={className}
      />
    );
  }
  return (
    <HorizontalStepper
      steps={steps}
      variant={variant}
      resolveStatus={resolveStatus}
      onClickStep={onClickStep}
      className={className}
    />
  );
}

// ─── Horizontal ────────────────────────────────────────────────────────────

function HorizontalStepper({
  steps,
  variant,
  resolveStatus,
  onClickStep,
  className,
}: {
  steps: Step[];
  variant: Variant;
  resolveStatus: (step: Step, idx: number) => StepStatus;
  onClickStep?: (step: Step) => void;
  className?: string;
}) {
  const containerCls =
    variant === "glass"
      ? "surface-glass-soft rounded-xl p-4"
      : "";

  const dotSize = variant === "compact" ? "h-5 w-5" : "h-7 w-7";
  const dotIconSize = variant === "compact" ? 10 : 14;

  return (
    <div className={[containerCls, className ?? ""].filter(Boolean).join(" ")}>
      <ol className="flex items-start gap-2">
        {steps.map((step, i) => {
          const status = resolveStatus(step, i);
          const isLast = i === steps.length - 1;
          const interactive = !!onClickStep;
          return (
            <li key={step.id} className="flex-1 min-w-0 flex items-start gap-2">
              <div className="flex flex-col items-start min-w-0 flex-1">
                <button
                  type="button"
                  disabled={!interactive}
                  onClick={() => onClickStep?.(step)}
                  className={[
                    "shrink-0 inline-flex items-center justify-center rounded-full backdrop-blur-[8px] transition-all",
                    dotSize,
                    STATUS_DOT[status],
                    STATUS_DOT_RING[status],
                    interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
                  ].join(" ")}
                  aria-current={status === "in_progress" ? "step" : undefined}
                >
                  <StatusIcon status={status} fallback={step.icon} size={dotIconSize} />
                </button>
                {variant !== "compact" && (
                  <div className="mt-2 min-w-0">
                    <p className={`text-[11px] uppercase tracking-widest font-medium ${STATUS_LABEL[status]}`}>
                      {step.label}
                    </p>
                    {step.description && (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">
                        {step.description}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {!isLast && (
                <span
                  className={`shrink-0 h-px self-center min-w-[2rem] flex-1 rounded-full ${STATUS_LINE[status]}`}
                  style={{ marginTop: variant === "compact" ? "0" : "10px" }}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Vertical ──────────────────────────────────────────────────────────────

function VerticalStepper({
  steps,
  variant,
  resolveStatus,
  onClickStep,
  className,
}: {
  steps: Step[];
  variant: Variant;
  resolveStatus: (step: Step, idx: number) => StepStatus;
  onClickStep?: (step: Step) => void;
  className?: string;
}) {
  const containerCls =
    variant === "glass"
      ? "surface-glass-soft rounded-xl p-4"
      : "";

  const dotSize = variant === "compact" ? "h-5 w-5" : "h-7 w-7";
  const dotIconSize = variant === "compact" ? 10 : 14;

  return (
    <div className={[containerCls, className ?? ""].filter(Boolean).join(" ")}>
      <ol className="space-y-1">
        {steps.map((step, i) => {
          const status = resolveStatus(step, i);
          const isLast = i === steps.length - 1;
          const interactive = !!onClickStep;
          return (
            <li key={step.id} className="relative pl-10 pb-3">
              {!isLast && (
                <span
                  className={`absolute left-3 top-7 bottom-0 w-px rounded-full ${STATUS_LINE[status]}`}
                  aria-hidden
                />
              )}
              <button
                type="button"
                disabled={!interactive}
                onClick={() => onClickStep?.(step)}
                className={[
                  "absolute left-0 top-0 inline-flex items-center justify-center rounded-full backdrop-blur-[8px] transition-all",
                  dotSize,
                  STATUS_DOT[status],
                  STATUS_DOT_RING[status],
                  interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
                ].join(" ")}
                aria-current={status === "in_progress" ? "step" : undefined}
              >
                <StatusIcon status={status} fallback={step.icon} size={dotIconSize} />
              </button>
              <div className="min-w-0 pt-0.5">
                <p className={`text-[13px] leading-tight ${STATUS_LABEL[status]}`}>{step.label}</p>
                {step.description && (
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

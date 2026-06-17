"use client";

/**
 * Stepper — chaîne de production / progression à étapes.
 *
 * Use cases : fiche pub, onboarding, wizard, status job.
 *
 * Variants :
 * - `linear` (default) : cards horizontales connectées.
 * - `glass` (legacy v2) : mappé vers linear.
 * - `compact` : dots-only, pour Drawer / panel latéral.
 *
 * Status par étape : todo | in_progress | done | blocked.
 * onClickStep optionnel pour rendre cliquable.
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
  active?: string | number;
  onClickStep?: (step: Step) => void;
  className?: string;
}

const STATUS_DOT: Record<StepStatus, string> = {
  todo:        "bg-card text-muted-foreground border border-border",
  in_progress: "bg-primary/10 text-primary border border-primary/30",
  done:        "bg-success-50 text-success-700 border border-success-200",
  blocked:     "bg-danger-50 text-danger-700 border border-danger-200",
};

const STATUS_LABEL: Record<StepStatus, string> = {
  todo:        "text-muted-foreground",
  in_progress: "text-foreground font-medium",
  done:        "text-foreground font-medium",
  blocked:     "text-danger-700 font-medium",
};

const STATUS_LINE: Record<StepStatus, string> = {
  todo:        "bg-border",
  in_progress: "bg-primary/40",
  done:        "bg-success-600/60",
  blocked:     "bg-danger-600/60",
};

const STATUS_CARD_CLS: Record<StepStatus, string> = {
  todo:        "bg-card border border-border",
  in_progress: "bg-primary/5 border border-primary/30",
  done:        "bg-success-50 border border-success-200",
  blocked:     "bg-danger-50 border border-danger-200",
};

const STATUS_CARD_HOVER: Record<StepStatus, string> = {
  todo:        "hover:bg-muted",
  in_progress: "hover:bg-primary/10",
  done:        "hover:bg-success-50",
  blocked:     "hover:bg-danger-50",
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
  const activeIdx = (() => {
    if (active === undefined) return -1;
    if (typeof active === "number") return active;
    return steps.findIndex((s) => s.id === active);
  })();

  const resolveStatus = (step: Step): StepStatus => step.status ?? "todo";
  const isActiveAt = (idx: number) => idx === activeIdx;

  if (orientation === "vertical") {
    return (
      <VerticalStepper
        steps={steps}
        variant={variant}
        resolveStatus={resolveStatus}
        isActiveAt={isActiveAt}
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
      isActiveAt={isActiveAt}
      onClickStep={onClickStep}
      className={className}
    />
  );
}

function HorizontalStepper({
  steps,
  variant,
  resolveStatus,
  isActiveAt,
  onClickStep,
  className,
}: {
  steps: Step[];
  variant: Variant;
  resolveStatus: (step: Step) => StepStatus;
  isActiveAt: (idx: number) => boolean;
  onClickStep?: (step: Step) => void;
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <CompactDots
        steps={steps}
        resolveStatus={resolveStatus}
        isActiveAt={isActiveAt}
        onClickStep={onClickStep}
        className={className}
      />
    );
  }

  const interactive = !!onClickStep;

  return (
    <div className={className}>
      <ol className="flex items-stretch">
        {steps.map((step, i) => {
          const status = resolveStatus(step);
          const active = isActiveAt(i);
          const isLast = i === steps.length - 1;
          return (
            <li key={step.id} className="flex-1 min-w-0 flex items-stretch">
              <button
                type="button"
                disabled={!interactive}
                onClick={() => onClickStep?.(step)}
                aria-current={active ? "step" : undefined}
                className={[
                  "flex-1 flex flex-col items-start gap-2 p-3 rounded-md text-left transition-colors",
                  STATUS_CARD_CLS[status],
                  interactive ? `cursor-pointer ${STATUS_CARD_HOVER[status]} focus-ring` : "cursor-default",
                  active && "ring-2 ring-primary/40",
                ].filter(Boolean).join(" ")}
              >
                <div className="flex items-center gap-2 w-full">
                  <span
                    className={[
                      "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full",
                      STATUS_DOT[status],
                    ].join(" ")}
                  >
                    <StatusIcon status={status} fallback={step.icon} size={12} />
                  </span>
                  {active && (
                    <span
                      className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="min-w-0 w-full">
                  <p className={`text-[13px] font-semibold leading-tight ${STATUS_LABEL[status]}`}>
                    {step.label}
                  </p>
                  {step.description && (
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {step.description}
                    </p>
                  )}
                </div>
              </button>
              {!isLast && <CardConnector status={status} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CardConnector({ status }: { status: StepStatus }) {
  return (
    <div className="flex items-center px-1.5 shrink-0" aria-hidden>
      <span className={`h-px w-4 rounded-full ${STATUS_LINE[status]}`} />
    </div>
  );
}

function CompactDots({
  steps,
  resolveStatus,
  isActiveAt,
  onClickStep,
  className,
}: {
  steps: Step[];
  resolveStatus: (step: Step) => StepStatus;
  isActiveAt: (idx: number) => boolean;
  onClickStep?: (step: Step) => void;
  className?: string;
}) {
  const interactive = !!onClickStep;
  return (
    <ol className={["flex items-center gap-2", className ?? ""].filter(Boolean).join(" ")}>
      {steps.map((step, i) => {
        const status = resolveStatus(step);
        const active = isActiveAt(i);
        const isLast = i === steps.length - 1;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!interactive}
              onClick={() => onClickStep?.(step)}
              aria-label={typeof step.label === "string" ? step.label : undefined}
              aria-current={active ? "step" : undefined}
              className={[
                "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors",
                STATUS_DOT[status],
                interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
                active && "ring-2 ring-primary/40",
              ].filter(Boolean).join(" ")}
            >
              <StatusIcon status={status} fallback={step.icon} size={10} />
            </button>
            {!isLast && (
              <span
                className={`shrink-0 h-px w-8 rounded-full ${STATUS_LINE[status]}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function VerticalStepper({
  steps,
  variant: _variant,
  resolveStatus,
  isActiveAt,
  onClickStep,
  className,
}: {
  steps: Step[];
  variant: Variant;
  resolveStatus: (step: Step) => StepStatus;
  isActiveAt: (idx: number) => boolean;
  onClickStep?: (step: Step) => void;
  className?: string;
}) {
  void _variant;
  const dotSize = "h-7 w-7";
  const dotIconSize = 14;

  return (
    <div className={className}>
      <ol className="space-y-1">
        {steps.map((step, i) => {
          const status = resolveStatus(step);
          const active = isActiveAt(i);
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
                  "absolute left-0 top-0 inline-flex items-center justify-center rounded-full transition-colors",
                  dotSize,
                  STATUS_DOT[status],
                  interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
                  active && "ring-2 ring-primary/40",
                ].filter(Boolean).join(" ")}
                aria-current={active ? "step" : undefined}
              >
                <StatusIcon status={status} fallback={step.icon} size={dotIconSize} />
              </button>
              <div className="min-w-0 pt-0.5">
                <p className={`text-[13px] leading-tight ${STATUS_LABEL[status]}`}>{step.label}</p>
                {step.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
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

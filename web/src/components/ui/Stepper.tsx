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

  // Fix 2026-05-31 : on ne force PLUS "done" pour les steps avant l'actif
  // ni "in_progress" sur l'actif lui-même. Le status réel passé en prop
  // décide de l'icône + couleur ; le step actif est juste matérialisé
  // par un ring/halo séparé (cf. `isActive` plus bas).
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

// ─── Horizontal ────────────────────────────────────────────────────────────

// Card variant — chaque step est une mini-card glass tintée par status.
const STATUS_CARD_CLS: Record<StepStatus, string> = {
  todo:
    "bg-white/45 border border-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.04),inset_0_-1px_0_rgba(15,23,42,0.04)]",
  in_progress:
    // Halo glow signature pour le step actif.
    "bg-sky-50/65 border border-sky-200/50 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.22),inset_0_-1px_0_rgba(77,150,191,0.1),0_2px_8px_-2px_rgba(77,150,191,0.22),0_8px_24px_-8px_rgba(77,150,191,0.28)]",
  done:
    "bg-sage-50/60 border border-sage-200/45 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.16),inset_0_-1px_0_rgba(111,162,128,0.08)]",
  blocked:
    "bg-rose-50/60 border border-rose-200/45 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.18),inset_0_-1px_0_rgba(201,113,133,0.1)]",
};

const STATUS_CARD_HOVER: Record<StepStatus, string> = {
  todo:        "hover:bg-white/65 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.04)]",
  in_progress: "hover:bg-sky-50/75 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.3),0_2px_8px_-2px_rgba(77,150,191,0.28),0_12px_28px_-8px_rgba(77,150,191,0.34)]",
  done:        "hover:bg-sage-50/75 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.22)]",
  blocked:     "hover:bg-rose-50/75 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.24)]",
};

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
  // Compact = dots-only (inchangé), pas de cards.
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

  const wrapperCls =
    variant === "glass"
      ? "surface-glass-soft rounded-xl p-3"
      : "";

  const interactive = !!onClickStep;

  return (
    <div className={[wrapperCls, className ?? ""].filter(Boolean).join(" ")}>
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
                  "flex-1 flex flex-col items-start gap-2 p-3 rounded-lg text-left transition-all",
                  "backdrop-blur-[12px] backdrop-saturate-150",
                  STATUS_CARD_CLS[status],
                  interactive ? `cursor-pointer ${STATUS_CARD_HOVER[status]} focus-ring` : "cursor-default",
                  // Active step : ring sky inset + halo glow doux, indépendant
                  // du status réel. Pas de ring-offset (casse le rendu glass).
                  active && "!shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.55),0_4px_16px_-4px_rgba(77,150,191,0.32),0_12px_28px_-12px_rgba(77,150,191,0.28)]",
                ].filter(Boolean).join(" ")}
              >
                <div className="flex items-center gap-2 w-full">
                  <span
                    className={[
                      "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-[6px]",
                      STATUS_DOT[status],
                      STATUS_DOT_RING[status],
                    ].join(" ")}
                  >
                    <StatusIcon status={status} fallback={step.icon} size={12} />
                  </span>
                  {active && (
                    <span
                      className="shrink-0 h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse shadow-[0_0_0_3px_rgba(169,209,230,0.4)]"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="min-w-0 w-full">
                  <p className={`text-[13px] font-semibold leading-tight ${STATUS_LABEL[status]}`}>
                    {step.label}
                  </p>
                  {step.description && (
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
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

// Connecteur subtle entre cards — petite ligne horizontale à mi-hauteur
// gradient color du status de gauche.
function CardConnector({ status }: { status: StepStatus }) {
  return (
    <div className="flex items-center px-1.5 shrink-0" aria-hidden>
      <span
        className={`h-px w-4 rounded-full ${
          status === "done"        ? "bg-gradient-to-r from-sage-300 to-sage-200/40"
          : status === "in_progress" ? "bg-gradient-to-r from-sky-300 to-gray-200/40"
          : status === "blocked"     ? "bg-gradient-to-r from-rose-300 to-rose-200/40"
          :                            "bg-gray-200/50"
        }`}
      />
    </div>
  );
}

// Compact variant — extracted to keep HorizontalStepper readable.
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
                "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full backdrop-blur-[8px] transition-all",
                STATUS_DOT[status],
                STATUS_DOT_RING[status],
                interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
              ].join(" ")}
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

// ─── Vertical ──────────────────────────────────────────────────────────────

function VerticalStepper({
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
                  "absolute left-0 top-0 inline-flex items-center justify-center rounded-full backdrop-blur-[8px] transition-all",
                  dotSize,
                  STATUS_DOT[status],
                  STATUS_DOT_RING[status],
                  interactive ? "cursor-pointer hover:scale-105 focus-ring" : "cursor-default",
                  active && "ring-2 ring-sky-300/60 ring-offset-1 ring-offset-white",
                ].filter(Boolean).join(" ")}
                aria-current={active ? "step" : undefined}
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

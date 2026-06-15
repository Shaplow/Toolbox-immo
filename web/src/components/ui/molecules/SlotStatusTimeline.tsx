/**
 * SlotStatusTimeline — 5 étapes narratives pour visualiser l'avancement
 * d'un slot indépendamment des 17 statuts techniques.
 *
 * Use-cases :
 * 1. Header fiche publication — vue d'ensemble cross-rôle.
 * 2. (futur) SlotCard calendrier — version "sm" sans labels.
 * 3. (futur) WorklistSlotCard — version "sm" pour densité tabulaire.
 *
 * Layout : 5 dots connectés. Dot courant en peach, passés en sage, futurs
 * en gray. Statuts "blocked" (REJECTED/CANCELLED/BLOCKED) → bandeau rose à
 * la place de la timeline normale.
 */

import { Check, AlertCircle } from "lucide-react";
import type { SlotStatus } from "@/types/calendar";
import { getMacroStep, MACRO_STEPS, MACRO_STEP_ORDER } from "@/lib/slots/macroStep";

interface SlotStatusTimelineProps {
  status: SlotStatus;
  size?: "sm" | "md";
  className?: string;
}

export function SlotStatusTimeline({
  status,
  size = "md",
  className = "",
}: SlotStatusTimelineProps) {
  const current = getMacroStep(status);

  if (current === "blocked") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-3 py-1 text-[12px] font-medium ${className}`}
      >
        <AlertCircle size={14} />
        <span>Publication bloquée</span>
      </div>
    );
  }

  const currentOrder = MACRO_STEPS[current].order;
  const isSmall = size === "sm";
  const dotSize = isSmall ? "w-2 h-2" : "w-2.5 h-2.5";
  const connectorH = isSmall ? "h-px" : "h-px";
  const wrapGap = isSmall ? "gap-1" : "gap-1.5";

  return (
    <div className={`inline-flex items-center ${wrapGap} ${className}`}>
      {MACRO_STEP_ORDER.map((stepKey, i) => {
        const step = MACRO_STEPS[stepKey];
        const isPast = step.order < currentOrder;
        const isCurrent = step.order === currentOrder;
        const isLast = i === MACRO_STEP_ORDER.length - 1;

        const dotCls = isCurrent
          ? "bg-peach-500 ring-2 ring-peach-200"
          : isPast
            ? "bg-sage-500"
            : "bg-gray-200";

        return (
          <div key={stepKey} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 ${isSmall ? "" : "flex-col"}`}
              title={`${step.label}${isCurrent ? " (étape courante)" : isPast ? " (terminée)" : ""}`}
            >
              <span
                className={`relative ${dotSize} rounded-full transition-colors ${dotCls}`}
              >
                {isPast && !isSmall && (
                  <Check
                    size={8}
                    strokeWidth={3}
                    className="absolute inset-0 m-auto text-white"
                  />
                )}
              </span>
              {!isSmall && (
                <span
                  className={`text-[10px] font-medium uppercase tracking-wider ${
                    isCurrent
                      ? "text-peach-700"
                      : isPast
                        ? "text-sage-700"
                        : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              )}
            </div>
            {!isLast && (
              <span
                className={`w-6 ${connectorH} ${
                  isPast ? "bg-sage-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

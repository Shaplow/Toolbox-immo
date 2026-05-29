"use client";

/**
 * ProductionChain — visualisation colorée des steps de la chaîne de production.
 *
 * Doctrine UX : d'un coup d'œil on doit savoir où en est la publication.
 * Chaque step est coloré selon son état :
 *
 *   - DONE       → vert (success)
 *   - NEXT/proc. → bleu vif (info-600 = couleur d'action attendue)
 *   - QUEUED     → ambre (en attente externe)
 *   - BLOCKED    → rouge (danger)
 *   - FAILED     → rouge (danger)
 *   - TODO       → gris discret (à venir, pas urgent)
 *
 * Layout : cards horizontales avec scroll mobile, wrap en desktop.
 * Click sur une card → scroll vers la section correspondante de la fiche.
 */

import { Check, X, Loader2, Clock, Ban, Circle } from "lucide-react";
import type { PublicationStep, StepStatus } from "@/lib/publications/steps";
import type { UserRole } from "@/types/roles";

export interface ProductionChainProps {
  steps: PublicationStep[];
  /** Si fourni, filtre les steps pour le rôle concerné (sauf ADMIN). */
  viewerRole?: UserRole;
}

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  todo: "À faire",
  queued: "En attente",
  processing: "En cours",
  done: "Fait",
  failed: "Échec",
  blocked: "Bloqué",
};

type StepTheme = {
  card: string;
  icon: string;
  index: string;
  label: string;
  badge: string;
};

function getStepTheme(status: StepStatus, isNext: boolean): StepTheme {
  // Step "next action" : bleu vif quel que soit le statut sous-jacent.
  if (isNext && status !== "done" && status !== "failed" && status !== "blocked") {
    return {
      card: "border-info-200 bg-info-50",
      icon: "bg-info-600 text-white shadow-sm",
      index: "text-info-700",
      label: "text-info-900 font-semibold",
      badge: "text-info-700 font-medium",
    };
  }
  switch (status) {
    case "done":
      return {
        card: "border-success-200 bg-success-50",
        icon: "bg-success-600 text-white",
        index: "text-success-700/80",
        label: "text-success-900 font-medium",
        badge: "text-success-700 font-medium",
      };
    case "processing":
      return {
        card: "border-info-200 bg-info-50",
        icon: "bg-info-600 text-white",
        index: "text-info-700/80",
        label: "text-info-900 font-medium",
        badge: "text-info-700 font-medium",
      };
    case "queued":
      return {
        card: "border-amber-200 bg-amber-50",
        icon: "bg-amber-500 text-white",
        index: "text-amber-700/80",
        label: "text-amber-900 font-medium",
        badge: "text-amber-700 font-medium",
      };
    case "failed":
    case "blocked":
      return {
        card: "border-danger-200 bg-danger-50",
        icon: "bg-danger-600 text-white",
        index: "text-danger-700/80",
        label: "text-danger-900 font-medium",
        badge: "text-danger-700 font-medium",
      };
    case "todo":
    default:
      return {
        card: "border-gray-200 bg-white",
        icon: "bg-white border border-gray-300 text-gray-400",
        index: "text-gray-400",
        label: "text-gray-700",
        badge: "text-gray-500",
      };
  }
}

function StepIcon({ status }: { status: StepStatus }) {
  const cls = "h-3.5 w-3.5";
  switch (status) {
    case "done":
      return <Check className={cls} strokeWidth={2.5} />;
    case "failed":
      return <X className={cls} strokeWidth={2.5} />;
    case "processing":
      return <Loader2 className={`${cls} animate-spin`} strokeWidth={2.5} />;
    case "queued":
      return <Clock className={cls} strokeWidth={2.5} />;
    case "blocked":
      return <Ban className={cls} strokeWidth={2.5} />;
    case "todo":
    default:
      return <Circle className={cls} strokeWidth={2} />;
  }
}

const STEP_TO_SECTION: Record<string, string> = {
  rushes: "rushes",
  render: "render",
  edit: "versions",
  cover: "cover",
  captions: "captions",
  description: "description",
  publish: "publish",
};

function scrollToSection(stepKey: string) {
  const sectionId = STEP_TO_SECTION[stepKey];
  if (!sectionId) return;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("pub:open-section", { detail: { sectionId } }),
    );
  }
  setTimeout(() => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

export function ProductionChain({ steps, viewerRole }: ProductionChainProps) {
  const visibleSteps = steps.filter((s) => {
    if (!s.visible) return false;
    if (!viewerRole) return true;
    if (viewerRole === "ADMIN") return true;
    return s.roles.includes(viewerRole);
  });

  if (visibleSteps.length === 0) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-[0.14em]">
          Chaîne de production
          {viewerRole && viewerRole !== "ADMIN" && (
            <span className="ml-2 normal-case tracking-normal text-gray-400 font-normal">
              · tes étapes
            </span>
          )}
        </h2>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {visibleSteps.map((step, idx) => {
          const isNext = step.nextAction;
          const theme = getStepTheme(step.status, isNext);
          const tooltip =
            step.key === "validation"
              ? `${step.label} — fonctionnalité à venir`
              : `Aller à : ${step.label}`;

          return (
            <button
              key={step.key}
              type="button"
              onClick={() => scrollToSection(step.key)}
              className={`group flex-shrink-0 sm:flex-shrink flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all text-left focus-ring hover:-translate-y-0.5 hover:shadow-sm ${theme.card}`}
              title={tooltip}
            >
              <span className={`text-[10px] font-mono w-3 text-center select-none ${theme.index}`}>
                {idx + 1}
              </span>
              <span
                className={`h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 ${theme.icon}`}
              >
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0 flex flex-col items-start gap-0.5 pr-1">
                <span className={`text-[12px] leading-tight ${theme.label}`}>
                  {step.label}
                </span>
                <span className={`text-[10px] leading-none uppercase tracking-[0.08em] ${theme.badge}`}>
                  {STEP_STATUS_LABELS[step.status]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

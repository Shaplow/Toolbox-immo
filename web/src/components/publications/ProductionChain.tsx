"use client";

/**
 * ProductionChain — visualisation des steps de la fiche publication.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - Palette ramenée de 6 couleurs (indigo next + green done + red failed
 *   + yellow processing/queued + purple blocked + gray todo) à 4 :
 *   gray-950 (next, mono dark — sélection doctrine) + success done +
 *   danger failed + default todo/queued/processing. "Blocked" hors
 *   doctrine purple → danger soft.
 * - Cards passent en bg-white border-gray-200 (au lieu de bg-pastel/border-
 *   pastel par status). Le statut est lu sur l'icône et le badge interne,
 *   pas sur le fond de card — beaucoup plus lisible dans une fiche dense.
 * - StepIcon SVG inline custom → icônes Lucide (Check, X, Loader2 anim-
 *   spin, Clock, Ban, Circle). Cohérence + perf (pas de SVG path inline
 *   répétés, Lucide tree-shaken).
 * - Badge inline status → Badge primitive avec variant sémantique.
 * - Conteneur : rounded-xl shadow-sm → rounded-lg (cohérent fiche).
 * - Title eyebrow text-xs → text-[10px] uppercase tracking-widest (doctrine).
 */

import {
  Check,
  X,
  Loader2,
  Clock,
  Ban,
  Circle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
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

function getStepBadgeVariant(
  status: StepStatus,
): "default" | "success" | "danger" | "info" {
  if (status === "done") return "success";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "processing") return "info";
  return "default";
}

function StepIcon({ status }: { status: StepStatus }) {
  const cls = "h-3.5 w-3.5";
  switch (status) {
    case "done":
      return <Check className={cls} />;
    case "failed":
      return <X className={cls} />;
    case "processing":
      return <Loader2 className={`${cls} animate-spin`} />;
    case "queued":
      return <Clock className={cls} />;
    case "blocked":
      return <Ban className={cls} />;
    case "todo":
    default:
      return <Circle className={cls} />;
  }
}

function getCardClasses(status: StepStatus, isNext: boolean): string {
  // Pattern : carte mono sobre + accent uniquement pour le "next" via
  // border-gray-950. Le statut est porté par l'icône et le badge, pas
  // par le fond.
  if (isNext) {
    return "border-2 border-gray-950 bg-white";
  }
  if (status === "done") return "border border-gray-200 bg-gray-50/40";
  if (status === "failed" || status === "blocked")
    return "border border-danger-100 bg-danger-50/40";
  return "border border-gray-200 bg-white";
}

function getIconWrapperClasses(status: StepStatus, isNext: boolean): string {
  if (isNext) return "bg-gray-950 text-white";
  if (status === "done") return "bg-success-100 text-success-700";
  if (status === "failed" || status === "blocked")
    return "bg-danger-100 text-danger-700";
  if (status === "processing") return "bg-info-100 text-info-700";
  return "bg-gray-100 text-gray-500";
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
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3">
        Chaîne de production
        {viewerRole && viewerRole !== "ADMIN" && (
          <span className="ml-2 normal-case tracking-normal text-gray-400">
            · tes étapes
          </span>
        )}
      </h2>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {visibleSteps.map((step, idx) => {
          const isNext = step.nextAction;
          const cardCls = getCardClasses(step.status, isNext);
          const iconWrapCls = getIconWrapperClasses(step.status, isNext);
          const tooltip =
            step.key === "validation"
              ? `${step.label} — fonctionnalité à venir`
              : `Aller à la section : ${step.label}`;

          return (
            <button
              key={step.key}
              type="button"
              onClick={() => scrollToSection(step.key)}
              className={`flex-shrink-0 sm:flex-shrink flex items-center gap-2 px-3 py-1.5 rounded-md transition-all text-left focus-ring ${cardCls} hover:bg-gray-50`}
              title={tooltip}
            >
              <span className="text-[10px] text-gray-400 font-mono w-3.5 text-center select-none">
                {idx + 1}
              </span>
              <span
                className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${iconWrapCls}`}
              >
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0 flex flex-col items-start gap-0.5">
                <span
                  className={`text-[12px] leading-tight ${
                    isNext ? "text-gray-950 font-semibold" : "text-gray-800 font-medium"
                  }`}
                >
                  {step.label}
                </span>
                <Badge size="sm" variant={getStepBadgeVariant(step.status)}>
                  {STEP_STATUS_LABELS[step.status]}
                </Badge>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

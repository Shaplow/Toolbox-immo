"use client";

import type { PublicationStep, StepStatus } from "@/lib/publications/steps";

export interface ProductionChainProps {
  steps: PublicationStep[];
}

// ---------------------------------------------------------------------------
// Labels FR pour les statuts de step
// ---------------------------------------------------------------------------

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  todo: "À faire",
  queued: "En attente",
  processing: "En cours",
  done: "Fait",
  failed: "Échec",
  blocked: "Bloqué",
};

// ---------------------------------------------------------------------------
// Couleurs par statut
// ---------------------------------------------------------------------------

function getStepColors(status: StepStatus, isNext: boolean) {
  if (isNext) {
    return {
      card: "border-2 border-indigo-400 bg-indigo-50",
      icon: "bg-indigo-100 text-indigo-600",
      label: "text-indigo-800 font-semibold",
      badge: "bg-indigo-100 text-indigo-700",
    };
  }

  switch (status) {
    case "done":
      return {
        card: "border border-green-200 bg-green-50",
        icon: "bg-green-100 text-green-600",
        label: "text-green-800 font-medium",
        badge: "bg-green-100 text-green-700",
      };
    case "failed":
      return {
        card: "border border-red-200 bg-red-50",
        icon: "bg-red-100 text-red-600",
        label: "text-red-800 font-medium",
        badge: "bg-red-100 text-red-700",
      };
    case "processing":
    case "queued":
      return {
        card: "border border-yellow-200 bg-yellow-50",
        icon: "bg-yellow-100 text-yellow-600",
        label: "text-yellow-800 font-medium",
        badge: "bg-yellow-100 text-yellow-700",
      };
    case "blocked":
      return {
        card: "border border-purple-200 bg-purple-50",
        icon: "bg-purple-100 text-purple-600",
        label: "text-purple-800 font-medium",
        badge: "bg-purple-100 text-purple-700",
      };
    case "todo":
    default:
      return {
        card: "border border-gray-200 bg-gray-50",
        icon: "bg-gray-100 text-gray-500",
        label: "text-gray-700 font-medium",
        badge: "bg-gray-100 text-gray-500",
      };
  }
}

// ---------------------------------------------------------------------------
// Icône de statut (SVG inline minimal — pas de dépendance supplémentaire)
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "done":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "failed":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "processing":
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-4 h-4 animate-spin"
        >
          <circle cx="10" cy="10" r="7" strokeDasharray="44" strokeDashoffset="11" />
        </svg>
      );
    case "queued":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "blocked":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M13.477 14.89A6 6 0 015.11 6.524L13.477 14.89zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "todo":
    default:
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z"
            clipRule="evenodd"
          />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// ProductionChain
// ---------------------------------------------------------------------------

// B5 — Mapping step.key → SectionKey utilisé par CollapsibleSection.
// `edit` n'a pas de section DOM dédiée (le step couvre les rushes+versions),
// on scroll vers "versions". `validation` n'a pas encore de section (placeholder
// Phase 2), donc cliquer dessus n'a aucun effet — c'est intentionnel.
const STEP_TO_SECTION: Record<string, string> = {
  render: "render",
  edit: "versions",
  cover: "cover",
  captions: "captions",
  description: "description",
  publish: "publish",
};

export function ProductionChain({ steps }: ProductionChainProps) {
  const visibleSteps = steps.filter((s) => s.visible);

  function scrollToSection(stepKey: string) {
    const sectionId = STEP_TO_SECTION[stepKey];
    if (!sectionId) return; // step sans section dédiée (ex: "validation")

    // B5 — Force d'abord l'ouverture de la CollapsibleSection cible (event
    // intercepté par CollapsibleSection.tsx) avant de scroller, pour éviter
    // que le scroll arrive sur un bandeau replié.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pub:open-section", { detail: { sectionId } }),
      );
    }

    // Petit délai pour laisser le state React se propager avant scroll.
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Chaîne de production
      </h2>

      {/* Scroll horizontal sur mobile, flex wrap sur desktop */}
      {(() => {
        const total = visibleSteps.length;
        const done = visibleSteps.filter((s) => s.status === "done").length;
        const nextStep = visibleSteps.find((s) => s.nextAction);
        if (total === 0) return null;
        return (
          <div className="flex items-center justify-between text-[11px] text-gray-500 -mt-2 mb-2 gap-3 flex-wrap">
            <span>
              {done}/{total} étape{total > 1 ? "s" : ""} terminée{done > 1 ? "s" : ""}
            </span>
            {nextStep && (
              <button
                type="button"
                onClick={() => scrollToSection(nextStep.key)}
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Étape en cours : {nextStep.label} →
              </button>
            )}
          </div>
        );
      })()}

      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        {visibleSteps.map((step, idx) => {
          const colors = getStepColors(step.status, step.nextAction);

          // F1.11 — Le step validation est un placeholder Phase 2 : tooltip
          // explicite "À venir" pour ne pas laisser croire à une action possible.
          const tooltip = step.key === "validation"
            ? `${step.label} — fonctionnalité à venir`
            : `Aller à la section : ${step.label}`;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => scrollToSection(step.key)}
              className={`flex-shrink-0 sm:flex-shrink flex items-center gap-2 px-3 py-2 rounded-lg transition-all cursor-pointer text-left ${colors.card} hover:opacity-80`}
              title={tooltip}
            >
              {/* Numéro de position */}
              <span className="text-xs text-gray-400 font-mono w-4 text-center select-none">
                {idx + 1}
              </span>

              {/* Icône statut */}
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
                <StepIcon status={step.status} />
              </span>

              {/* Texte */}
              <span className="min-w-0">
                <span className={`block text-sm ${colors.label} leading-tight`}>
                  {step.label}
                </span>
                <span className={`block text-xs mt-0.5 ${colors.badge} px-1.5 py-0.5 rounded-full w-fit`}>
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

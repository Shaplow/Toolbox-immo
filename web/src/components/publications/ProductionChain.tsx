"use client";

/**
 * ProductionChain — chaîne de production de la fiche publication.
 *
 * Wrapper léger autour de la molécule `Stepper variant="glass"`. Filtre les
 * steps visibles pour le rôle viewer, mappe `PublicationStep.status` →
 * `StepStatus`, identifie le step actif (nextAction), et dispatche
 * `pub:open-section` au click pour scroller vers la section correspondante
 * (consommé par les molécules `Section` côté fiche).
 */

import { Stepper, type Step as StepperStep, type StepStatus as StepperStatus } from "@/components/ui/Stepper";
import type { PublicationStep, StepStatus } from "@/lib/publications/steps";
import type { UserRole } from "@/types/roles";

export interface ProductionChainProps {
  steps: PublicationStep[];
  /** Si fourni, filtre les steps pour le rôle concerné (sauf ADMIN). */
  viewerRole?: UserRole;
}

/** Map PublicationStep.status → Stepper StepStatus. */
function mapStatus(status: StepStatus): StepperStatus {
  switch (status) {
    case "done":
      return "done";
    case "processing":
    case "queued":
      return "in_progress";
    case "failed":
    case "blocked":
      return "blocked";
    case "waiting":
    case "todo":
    default:
      return "todo";
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

  // Map PublicationStep → Stepper Step. On garde le key d'origine dans `id`
  // pour pouvoir router vers la section au click. V8.5 — quand le step est
  // en `waiting` avec un `waitingFor`, on personnalise la description pour
  // dire de quelle étape précisément il attend.
  const stepperSteps: StepperStep[] = visibleSteps.map((s) => ({
    id: String(s.key),
    label: s.label,
    description:
      s.status === "waiting" && s.waitingFor
        ? `En attente de ${s.waitingFor.toLowerCase()}`
        : STEP_STATUS_LABELS[s.status],
    status: mapStatus(s.status),
  }));

  // Step actif = celui marqué nextAction (override le status sous-jacent).
  const activeStep = visibleSteps.find((s) => s.nextAction);
  const active = activeStep ? String(activeStep.key) : undefined;

  return (
    <Stepper
      variant="linear"
      steps={stepperSteps}
      active={active}
      onClickStep={(s) => scrollToSection(s.id)}
    />
  );
}

// Friction MED #14 du audit UX : avant, `waiting` (étape future, upstream
// pas fini) et `todo` (action attendue MAINTENANT) étaient rendus à
// l'identique avec le label "En attente". Désormais les labels disent
// clairement la différence — le Stepper mappe les 2 sur le même état
// visuel "todo" mais la description précise le contexte.
const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  todo: "Action attendue",
  waiting: "En attente de l'étape précédente",
  queued: "En file d'attente",
  processing: "En cours",
  done: "Fait",
  failed: "Échec",
  blocked: "Bloqué",
};

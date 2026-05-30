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
  // pour pouvoir router vers la section au click.
  const stepperSteps: StepperStep[] = visibleSteps.map((s) => ({
    id: String(s.key),
    label: s.label,
    description: STEP_STATUS_LABELS[s.status],
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

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  todo: "À faire",
  queued: "En attente",
  processing: "En cours",
  done: "Fait",
  failed: "Échec",
  blocked: "Bloqué",
};

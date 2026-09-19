"use client";

/**
 * ProductionChain — la chaîne d'étapes, au-dessus de la molécule `Stepper`.
 *
 * Sert les DEUX fiches. Rien ici ne parle de publication : la table
 * « étape → section » arrive en prop, parce que c'est la seule chose qui
 * changeait d'une surface à l'autre.
 *
 * Filtre les étapes visibles pour le rôle, mappe leur statut vers celui du
 * Stepper, désigne l'étape active (`nextAction`), et émet `fiche:open-section`
 * au clic pour déplier la section correspondante et y amener.
 */

import { Stepper, type Step as StepperStep, type StepStatus as StepperStatus } from "@/components/ui/Stepper";
import type { ChainStep, StepStatus } from "@/lib/steps/engine";
import type { UserRole } from "@/types/roles";
import { emitOpenSection } from "@/components/fiches/openSectionEvent";

export interface ProductionChainProps {
  steps: ChainStep<string>[];
  /** Si fourni, filtre les steps pour le rôle concerné (sauf ADMIN). */
  viewerRole?: UserRole;
  /**
   * Étape → id de la section à déplier au clic. Une clé absente rend l'étape
   * non cliquable, en silence — c'est le défaut sur une chaîne sans sections.
   */
  stepToSection?: Record<string, string>;
}

/** Map le statut d'étape → statut du Stepper. */
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

/** La table de la fiche publication — son défaut, pas une fatalité. */
export const PUBLICATION_STEP_TO_SECTION: Record<string, string> = {
  rushes: "rushes",
  render: "render",
  edit: "versions",
  cover: "cover",
  captions: "captions",
  description: "description",
  // UX-auditor #4 (2026-06-01) : sans cette entrée, le clic sur le step
  // "Validation client" dans le Stepper tombait dans un return silencieux
  // (sectionId = undefined). Le step était actionnable sans cible scroll.
  validation: "clientValidation",
  publish: "publish",
};

export function ProductionChain({
  steps,
  viewerRole,
  stepToSection = PUBLICATION_STEP_TO_SECTION,
}: ProductionChainProps) {
  function scrollToSection(stepKey: string) {
    const sectionId = stepToSection[stepKey];
    if (!sectionId) return;
    emitOpenSection(sectionId);
  }

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
        : (s.hint ?? STEP_STATUS_LABELS[s.status]),
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

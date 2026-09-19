/**
 * La chaîne d'étapes d'un TOURNAGE : planifié → confirmé → tourné → publications.
 *
 * Pendant de `lib/publications/steps.ts`, sur le même moteur
 * (`lib/steps/engine`). Ce fichier ne contient que la définition — aucune
 * mécanique.
 *
 * ## Pourquoi « tourné » absorbe les rushs
 *
 * Il y a deux chemins vers le même fait, et ils ne sont pas d'accord : déposer
 * le premier rush force `PLANNED → SHOT` côté serveur
 * (`api/entities/[id]/rushes/upload-complete`), alors que « Marquer réalisé »
 * donne `SHOT` avec zéro rush. En faire deux étapes obligerait à afficher
 * « rushs déposés » comme faite sans aucun rush, ou « tourné » comme à faire
 * alors que des rushs sont déjà là. Une seule étape, et le décompte des rushs
 * passe en description.
 *
 * ## Ce qui n'existe pas côté fiche
 *
 * Aucun équivalent de `pattern` pour piloter la visibilité : ce sont les
 * capacités du TYPE (`hasPlanning`, `hasAssignees`) qui décident. Et aucun
 * « nombre de rushs attendus », donc aucune façon de savoir si un dépôt est
 * complet — d'où un décompte, jamais un objectif.
 */

import { resolveChain, type ChainStep, type RawStep, type StepStatus } from "@/lib/steps/engine";
import { needsVideasteAnswer } from "@/lib/entityAvailability";
import { TERMINAL_STATUSES } from "@/types/roles";

export type ShootStepKey = "planned" | "confirmed" | "shot" | "published";

export type ShootStep = ChainStep<ShootStepKey>;

export interface ShootStepsInput {
  /** Capacités du type de fiche. */
  hasPlanning: boolean;
  hasAssignees: boolean;
  isArchived: boolean;
  /** `null` vaut `PLANNED`, comme partout ailleurs. */
  status: string | null;
  validationStatus: string | null;
  scheduledAt: string | null;
  assigneeVideasteId: string | null;
  videasteConfirmation: "CONFIRMED" | "DECLINED" | null;
  rushCount: number;
  /** Les publications rattachées à ce tournage (`shootEntityId`). */
  slotStatuses: string[];
}

const isTerminal = (status: string) =>
  (TERMINAL_STATUSES as readonly string[]).includes(status);

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

export function computeShootSteps(input: ShootStepsInput): ShootStep[] {
  const status = input.status ?? "PLANNED";
  const isShot = status === "SHOT" || status === "DONE";

  // ── Planifié ────────────────────────────────────────────────────────────
  const plannedStep: RawStep<ShootStepKey> = {
    key: "planned",
    label: "Planification",
    action: "Poser la date du tournage",
    visible: input.hasPlanning,
    status: input.scheduledAt ? "done" : "todo",
    roles: ["ADMIN"],
    ...(input.scheduledAt ? {} : { hint: "Aucune date posée" }),
  };

  // ── Disponibilité du vidéaste ───────────────────────────────────────────
  // `needsVideasteAnswer` plutôt qu'une condition réécrite : c'est la même
  // question que le bandeau de la fiche et que l'inbox, et sa docstring
  // raconte le bug né d'une recopie sur trois sites.
  const answerPending = needsVideasteAnswer({
    hasPlanning: input.hasPlanning,
    status: input.status,
    isArchived: input.isArchived,
    validationStatus: input.validationStatus,
    videasteConfirmation: input.videasteConfirmation,
  });
  const confirmedStatus: StepStatus = !input.assigneeVideasteId
    ? "todo"
    : input.videasteConfirmation === "CONFIRMED"
      ? "done"
      : input.videasteConfirmation === "DECLINED"
        ? "failed" // le cas le plus urgent : personne ne sera là
        : answerPending
          ? "todo"
          : "done"; // question fermée sans réponse : le tournage a eu lieu
  const confirmedStep: RawStep<ShootStepKey> = {
    key: "confirmed",
    label: "Disponibilité",
    action: input.assigneeVideasteId
      ? "Obtenir la réponse du vidéaste"
      : "Assigner un vidéaste",
    visible: input.hasPlanning && input.hasAssignees,
    status: confirmedStatus,
    roles: ["ADMIN", "VIDEASTE"],
    ...(input.assigneeVideasteId ? {} : { hint: "Aucun vidéaste assigné" }),
  };

  // ── Tourné (rushs compris) ──────────────────────────────────────────────
  const shotStep: RawStep<ShootStepKey> = {
    key: "shot",
    label: "Tournage",
    action: "Marquer le tournage réalisé",
    visible: input.hasPlanning,
    status: isShot ? "done" : "todo",
    roles: ["ADMIN", "VIDEASTE"],
    hint: input.rushCount > 0 ? plural(input.rushCount, "rush", "rushs") : undefined,
  };

  // ── Publications ────────────────────────────────────────────────────────
  const total = input.slotStatuses.length;
  const doneCount = input.slotStatuses.filter(isTerminal).length;
  const publishedStep: RawStep<ShootStepKey> = {
    key: "published",
    label: "Publications",
    action: total === 0 ? "Rattacher une publication" : "Terminer les publications",
    visible: true,
    status: total > 0 && doneCount === total ? "done" : "todo",
    roles: ["ADMIN", "MONTEUR", "CM"],
    hint:
      total === 0
        ? "Aucune publication rattachée"
        : `${doneCount} sur ${total} terminée${total > 1 ? "s" : ""}`,
  };

  return resolveChain<ShootStepKey>(
    [plannedStep, confirmedStep, shotStep, publishedStep],
    // « Publications » reflète l'état des reels eux-mêmes : on ne la rétrograde
    // pas parce qu'une date manque en amont.
    { statusDriven: ["published"] },
  );
}

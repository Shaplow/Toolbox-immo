/**
 * Helper pur (pas d'accès DB) de calcul des steps d'une publication.
 *
 * Consommé par les routes API et les composants de worklist.
 * Toutes les données nécessaires sont passées en paramètre — ce module
 * ne fait aucune requête Prisma, ce qui le rend testable unitairement.
 */

import type {
  PublicationSlot,
  ContentRecipe,
  Render,
  CoverFramePack,
  CaptionJob,
  DescriptionJob,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type StepKey =
  | "render"
  | "cover"
  | "captions"
  | "description"
  | "validation"
  | "publish";

export type StepStatus =
  | "todo"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "blocked";

export interface PublicationStep {
  key: StepKey;
  /** Libellé affiché dans l'UI (FR). */
  label: string;
  /** Faux si le step n'est pas applicable pour cette recipe. */
  visible: boolean;
  status: StepStatus;
  /**
   * true uniquement pour le premier step visible dont
   * status ∈ ["todo", "failed"] — indique la prochaine action à mener.
   */
  nextAction: boolean;
}

// ---------------------------------------------------------------------------
// Statuts slot terminaux / bloquants
// ---------------------------------------------------------------------------

const BLOCKED_SLOT_STATUSES = new Set(["CANCELLED", "REJECTED", "ARCHIVED"]);

// ---------------------------------------------------------------------------
// Mappers de statut job → StepStatus
// ---------------------------------------------------------------------------

function renderJobStatus(
  renderJob: Pick<Render, "status"> | null | undefined
): StepStatus {
  if (!renderJob) return "todo";
  switch (renderJob.status) {
    case "PENDING":
      return "queued";
    case "PROCESSING":
      return "processing";
    case "DONE":
      return "done";
    case "ERROR":
      return "failed";
    default:
      return "todo";
  }
}

function coverPackStatus(
  coverPack: Pick<CoverFramePack, "status" | "finalCoverUrl"> | null | undefined
): StepStatus {
  if (!coverPack) return "todo";
  switch (coverPack.status) {
    case "QUEUED":
      return "queued";
    case "PROCESSING":
      return "processing";
    case "READY":
      // READY sans finalCoverUrl = frames dispo mais pas encore sélectionnée
      return coverPack.finalCoverUrl ? "done" : "todo";
    case "SELECTED":
      return "done";
    case "FAILED":
      return "failed";
    default:
      return "todo";
  }
}

function captionJobStatus(
  captionJob: Pick<CaptionJob, "status"> | null | undefined
): StepStatus {
  if (!captionJob) return "todo";
  switch (captionJob.status) {
    case "QUEUED":
      return "queued";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
      return "done";
    case "FAILED":
      return "failed";
    default:
      return "todo";
  }
}

function descriptionJobStatus(
  descriptionJob:
    | Pick<DescriptionJob, "status" | "result">
    | null
    | undefined
): StepStatus {
  if (!descriptionJob) return "todo";
  if (descriptionJob.status === "COMPLETED" && descriptionJob.result)
    return "done";
  if (descriptionJob.status === "FAILED") return "failed";
  return "todo";
}

// ---------------------------------------------------------------------------
// computePublicationSteps
// ---------------------------------------------------------------------------

/**
 * Calcule la liste ordonnée des steps pour une publication donnée.
 *
 * @param input - Données déjà chargées en base par l'appelant.
 * @returns Liste ordonnée de PublicationStep avec `nextAction` résolu.
 */
export function computePublicationSteps(input: {
  slot: Pick<PublicationSlot, "status" | "caption">;
  recipe: Pick<
    ContentRecipe,
    | "source"
    | "needsCover"
    | "needsCaptions"
    | "needsDescription"
    | "needsClientValidation"
  > | null;
  renderJob?: Pick<Render, "status"> | null;
  coverPack?: Pick<CoverFramePack, "status" | "finalCoverUrl"> | null;
  captionJob?: Pick<CaptionJob, "status"> | null;
  descriptionJob?: Pick<DescriptionJob, "status" | "result"> | null;
}): PublicationStep[] {
  const { slot, recipe, renderJob, coverPack, captionJob, descriptionJob } =
    input;

  // ── Visibilité par recipe ──────────────────────────────────────────────────
  const renderVisible = recipe?.source === "auto_template";
  const coverVisible =
    recipe != null && recipe.needsCover !== "none";
  const captionsVisible = recipe?.needsCaptions === true;
  const descriptionVisible =
    recipe != null && recipe.needsDescription !== "none";
  const validationVisible = recipe?.needsClientValidation === true;
  // publish : toujours visible

  // ── Statut publish ─────────────────────────────────────────────────────────
  let publishStatus: StepStatus;
  if (slot.status === "PUBLISHED") {
    publishStatus = "done";
  } else if (BLOCKED_SLOT_STATUSES.has(slot.status)) {
    publishStatus = "blocked";
  } else {
    publishStatus = "todo";
  }

  // ── Construction de la liste brute ────────────────────────────────────────
  const rawSteps: Omit<PublicationStep, "nextAction">[] = [
    {
      key: "render",
      label: "Rendu vidéo",
      visible: renderVisible,
      status: renderVisible ? renderJobStatus(renderJob) : "todo",
    },
    {
      key: "cover",
      label: "Cover",
      visible: coverVisible,
      status: coverVisible ? coverPackStatus(coverPack) : "todo",
    },
    {
      key: "captions",
      label: "Sous-titres",
      visible: captionsVisible,
      status: captionsVisible ? captionJobStatus(captionJob) : "todo",
    },
    {
      key: "description",
      label: "Description",
      visible: descriptionVisible,
      status: descriptionVisible ? descriptionJobStatus(descriptionJob) : "todo",
    },
    {
      key: "validation",
      label: "Validation client",
      visible: validationVisible,
      // Phase 1.3 placeholder — statut toujours "todo" (logique Phase 2)
      status: "todo",
    },
    {
      key: "publish",
      label: "Publier",
      visible: true,
      status: publishStatus,
    },
  ];

  // ── Résolution de nextAction ───────────────────────────────────────────────
  let nextActionSet = false;

  const steps: PublicationStep[] = rawSteps.map((step) => {
    const isActionable =
      step.visible &&
      (step.status === "todo" || step.status === "failed") &&
      !nextActionSet;

    if (isActionable) {
      nextActionSet = true;
      return { ...step, nextAction: true };
    }

    return { ...step, nextAction: false };
  });

  return steps;
}

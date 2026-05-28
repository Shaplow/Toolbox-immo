/**
 * Helper pur (pas d'accès DB) de calcul des steps d'une publication.
 *
 * Consommé par les routes API et les composants de worklist.
 * Toutes les données nécessaires sont passées en paramètre — ce module
 * ne fait aucune requête Prisma, ce qui le rend testable unitairement.
 */

import type {
  PublicationSlot,
  AccountPattern,
  Render,
  CoverFramePack,
  CaptionJob,
  DescriptionJob,
} from "@prisma/client";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type StepKey =
  | "rushes"
  | "render"
  | "edit"
  | "cover"
  | "captions"
  | "description"
  | "validation"
  | "publish";

/**
 * Rôles responsables ou intéressés par chaque step.
 *
 * Utilisé par ProductionChain pour filtrer les étapes affichées :
 * - ADMIN voit tout (vue de supervision).
 * - Les autres rôles ne voient que les steps où ils apparaissent dans cette
 *   matrice — typiquement leurs propres étapes + les inputs directs dont ils
 *   dépendent. Ça évite à un vidéaste de voir cover/captions/description et
 *   à un CM de voir l'étape de montage qui ne le concerne pas.
 *
 * VIDEASTE = uniquement "rushes" (son livrable).
 * MONTEUR  = "rushes" (input) + "render" + "edit" (livrable).
 * CM       = "cover" + "captions" + "description" + "validation" + "publish".
 * EXTERNAL_GENERATOR = aucune (la chain ne lui est pas montrée).
 */
const STEP_ROLES: Record<StepKey, UserRole[]> = {
  rushes:     ["VIDEASTE", "MONTEUR"],
  render:     ["MONTEUR"],
  edit:       ["MONTEUR"],
  cover:      ["CM"],
  captions:   ["CM", "MONTEUR"],
  description:["CM"],
  validation: ["CM"],
  publish:    ["CM"],
};

export function getStepRoles(key: StepKey): UserRole[] {
  return STEP_ROLES[key];
}

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
  /** Rôles intéressés par ce step (utilisé par ProductionChain pour filtrer). */
  roles: UserRole[];
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
    | undefined,
  /** Fallback : description rédigée à la main (sans passer par un job IA). */
  fallbackText?: string | null
): StepStatus {
  if (descriptionJob) {
    if (descriptionJob.status === "COMPLETED" && descriptionJob.result) return "done";
    if (descriptionJob.status === "FAILED") return "failed";
  }
  if (fallbackText && fallbackText.trim().length > 0) return "done";
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
  slot: Pick<PublicationSlot, "status" | "caption" | "description">;
  pattern?: Pick<
    AccountPattern,
    | "source"
    | "coverMode"
    | "needsCaptions"
    | "needsDescription"
    | "needsClientValidation"
    | "needsRushes"
    | "needsBrief"
  > | null;
  renderJob?: Pick<Render, "status"> | null;
  coverPack?: Pick<CoverFramePack, "status" | "finalCoverUrl"> | null;
  captionJob?: Pick<CaptionJob, "status"> | null;
  descriptionJob?: Pick<DescriptionJob, "status" | "result"> | null;
  /** Nombre de versions non supprimées (pour calculer le statut du step "edit"). */
  versionsCount?: number;
  /** Nombre de rushs uploadés (pour calculer le statut du step "rushes"). */
  rushesCount?: number;
  /** ID de la version courante promue par l'ADMIN. */
  currentVersionId?: string | null;
}): PublicationStep[] {
  const { slot, renderJob, coverPack, captionJob, descriptionJob, versionsCount = 0, rushesCount = 0, currentVersionId } =
    input;
  const pattern = input.pattern ?? null;

  // ── Visibilité par pattern ────────────────────────────────────────────────
  // rushes : visible si pattern.needsRushes OU si on est dans une phase
  // rushs/montage (statut le signale) OU s'il existe déjà des rushs. Robuste
  // aux slots dont le pattern aurait été modifié après création — sans cela,
  // le step n'apparaissait pas alors que le banner "Uploader les rushes"
  // s'affichait quand même, créant une UX incohérente.
  const rushesVisible =
    pattern?.needsRushes === true ||
    slot.status === "RUSHES_EXPECTED" ||
    slot.status === "RUSHES_RECEIVED" ||
    rushesCount > 0;
  const renderVisible = pattern?.source === "auto_template";
  const editVisible = pattern?.needsRushes === true || pattern?.needsBrief === true;
  const coverVisible =
    pattern != null && pattern.coverMode !== "none";
  const captionsVisible = pattern?.needsCaptions === true;
  const descriptionVisible =
    pattern != null && pattern.needsDescription !== "none";
  const validationVisible = pattern?.needsClientValidation === true;
  // publish : toujours visible

  // ── Statut step "rushes" ──────────────────────────────────────────────────
  // todo  = aucun rush, slot pas encore au stade "shoot livré"
  // done  = au moins un rush uploadé (le vidéaste a déposé son livrable)
  let rushesStatus: StepStatus;
  if (rushesCount > 0) {
    rushesStatus = "done";
  } else if (slot.status === "RUSHES_EXPECTED") {
    rushesStatus = "processing";
  } else {
    rushesStatus = "todo";
  }

  // ── Statut step "edit" ─────────────────────────────────────────────────────
  let editStatus: StepStatus;
  if (currentVersionId) {
    editStatus = "done";
  } else if (versionsCount > 0) {
    editStatus = "processing"; // au moins une version déposée mais pas encore promue
  } else {
    editStatus = "todo";
  }

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
      key: "rushes",
      label: "Rushs",
      visible: rushesVisible,
      status: rushesVisible ? rushesStatus : "todo",
      roles: STEP_ROLES.rushes,
    },
    {
      key: "render",
      label: "Rendu vidéo",
      visible: renderVisible,
      status: renderVisible ? renderJobStatus(renderJob) : "todo",
      roles: STEP_ROLES.render,
    },
    {
      key: "edit",
      label: "Montage",
      visible: editVisible,
      status: editVisible ? editStatus : "todo",
      roles: STEP_ROLES.edit,
    },
    {
      key: "cover",
      label: "Cover",
      visible: coverVisible,
      status: coverVisible ? coverPackStatus(coverPack) : "todo",
      roles: STEP_ROLES.cover,
    },
    {
      key: "captions",
      label: "Sous-titres",
      visible: captionsVisible,
      status: captionsVisible ? captionJobStatus(captionJob) : "todo",
      roles: STEP_ROLES.captions,
    },
    {
      key: "description",
      label: "Description",
      visible: descriptionVisible,
      status: descriptionVisible
        ? descriptionJobStatus(descriptionJob, slot.description)
        : "todo",
      roles: STEP_ROLES.description,
    },
    {
      key: "validation",
      label: "Validation client",
      visible: validationVisible,
      // F1.11 — Step en placeholder Phase 2 : statut "blocked" (violet, tooltip
      // "À venir") au lieu de "todo" pour ne pas être le nextAction de la
      // ProductionChain en permanence. Quand la feature sera implémentée,
      // remplacer par le statut réel calculé depuis le validationJob/validation
      // table.
      status: "blocked",
      roles: STEP_ROLES.validation,
    },
    {
      key: "publish",
      label: "Publier",
      visible: true,
      status: publishStatus,
      roles: STEP_ROLES.publish,
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

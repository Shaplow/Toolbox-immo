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
import { POST_VALIDATION_STATUSES } from "./constants";

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
  // Validation client : CM la déclenche, MONTEUR l'observe (informatif —
  // anticipe une éventuelle CLIENT_REVISION qui le réenrôlerait).
  validation: ["CM", "MONTEUR"],
  publish:    ["CM"],
};

export function getStepRoles(key: StepKey): UserRole[] {
  return STEP_ROLES[key];
}

export type StepStatus =
  | "todo"
  | "waiting" // étape future, en attente d'une étape amont non terminée (visuel todo, label "En attente")
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
  slot: Pick<PublicationSlot, "status" | "description">;
  pattern?: Pick<
    AccountPattern,
    | "source"
    | "coverMode"
    | "needsCaptions"
    | "needsCaptionsMode"
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
  // edit (Montage) : tout pattern non-auto_template implique un montage humain.
  // - manual_rushes : monteur monte à partir des rushs vidéaste
  // - external_upload : le client uploade la vidéo finie (pas de montage chez
  //   nous) → edit reste caché sauf si needsBrief.
  // On considère AUSSI les fallbacks statut/versions pour être robuste à des
  // recipes mal configurées (même logique que rushesVisible).
  const editVisible =
    pattern?.source === "manual_rushes" ||
    pattern?.needsRushes === true ||
    pattern?.needsBrief === true ||
    versionsCount > 0 ||
    slot.status === "IN_EDIT" ||
    slot.status === "EDIT_REVIEW" ||
    slot.status === "EDIT_APPROVED" ||
    slot.status === "RUSHES_RECEIVED";
  const coverVisible =
    pattern != null && pattern.coverMode !== "none";
  // V8.2.2 — captions visible si mode auto OU manual (les 2 produisent un
  // step captions dans la chaîne, juste avec UI différente côté fiche).
  const captionsVisible =
    pattern != null &&
    (pattern.needsCaptionsMode === "auto" ||
      pattern.needsCaptionsMode === "manual" ||
      // Fallback compat Boolean si pattern pas encore migré (devrait pas
      // arriver vu backfill, mais safe).
      pattern.needsCaptions === true);
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
  } else {
    // RUSHES_EXPECTED = on attend le vidéaste (humain), pas un job machine.
    // Avant : on mappait en "processing" → spinner trompeur "En cours" qui
    // laissait penser qu'un upload était en route.
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
  // Ordre cible (2026-05-30) :
  //   rushes (vidéaste, hors scope) → render/edit (génération ou rush final)
  //   → captions (sous-titrage auto, sur la version) → validation client
  //   (le client reçoit la vidéo AVEC sous-titres) → description → cover → publier.
  //
  // Le sous-titrage doit précéder la validation car le client doit voir le
  // rendu final sous-titré qu'il validera. La cover passe APRÈS la validation
  // car elle est cosmétique (thumbnail Instagram) — elle peut être préparée en
  // parallèle ou retravaillée même après validation.
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
      key: "captions",
      label: "Sous-titres",
      visible: captionsVisible,
      status: captionsVisible ? captionJobStatus(captionJob) : "todo",
      roles: STEP_ROLES.captions,
    },
    {
      key: "validation",
      label: "Validation client",
      visible: validationVisible,
      // Fix bug audit 2026-05-30 (M4) + 2026-05-30 (chaîne) : la validation ne
      // peut pas démarrer tant que les sous-titres ne sont pas terminés —
      // sinon le CM enverrait au client une vidéo sans sous-titres alors que
      // c'est censé être la version validable. On bascule alors en "blocked".
      //
      // Fix 2026-05-30 (chaîne) : SCHEDULED = validation déjà faite (magic
      // link approve OU bypass admin) → done. Sans ça, le step restait "todo"
      // alors que le slot avait passé la validation.
      status: (() => {
        if (slot.status === "PUBLISHED" || slot.status === "DONE" || slot.status === "SCHEDULED") return "done";
        // Si captions requises et pas encore terminées → blocked.
        // captionJobStatus retourne "done" UNIQUEMENT si COMPLETED, donc on
        // peut s'en servir comme indicateur de "captions prêtes".
        const captionsReady =
          !captionsVisible || captionJobStatus(captionJob) === "done";
        if (!captionsReady) return "blocked";
        if (slot.status === "AWAITING_CLIENT") return "todo";
        if (slot.status === "EDIT_APPROVED" || slot.status === "READY_FOR_CM") return "todo";
        if (BLOCKED_SLOT_STATUSES.has(slot.status)) return "blocked";
        return "todo";
      })(),
      roles: STEP_ROLES.validation,
    },
    {
      key: "description",
      label: "Description",
      visible: descriptionVisible,
      status: (() => {
        if (!descriptionVisible) return "todo";
        const baseStatus = descriptionJobStatus(descriptionJob, slot.description);
        // "blocked" est réservé aux vrais blocages durables (erreur config,
        // pattern manquant). L'attente d'une étape amont (validation client)
        // reste "todo" — visuellement neutre dans la chaîne.
        // Post-validation + pas encore de job + pattern autoGenerate :
        // le pipeline est censé déclencher le job dans la foulée → on affiche
        // "processing" pour ne pas montrer "À faire" trompeur pendant le délai
        // de mise en place.
        if (
          POST_VALIDATION_STATUSES.has(slot.status) &&
          pattern?.needsDescription === "autoGenerate" &&
          baseStatus === "todo" &&
          !descriptionJob
        ) {
          return "processing";
        }
        return baseStatus;
      })(),
      roles: STEP_ROLES.description,
    },
    {
      key: "cover",
      label: "Cover",
      visible: coverVisible,
      status: (() => {
        if (!coverVisible) return "todo";
        const baseStatus = coverPackStatus(coverPack);
        // Idem description : pre-validation reste "todo" (pas "blocked")
        // pour ne pas alarmer visuellement sur une étape simplement en attente.
        // Post-validation + pas encore de pack + mode autoPack : le pipeline
        // déclenche le pack dans la foulée → "processing" pour éviter "À faire".
        if (
          POST_VALIDATION_STATUSES.has(slot.status) &&
          pattern?.coverMode === "autoPack" &&
          baseStatus === "todo" &&
          !coverPack
        ) {
          return "processing";
        }
        return baseStatus;
      })(),
      // Fix bug 2026-05-30 : cover est par défaut CM-only, MAIS quand
      // coverMode === "monteurUpload" c'est le MONTEUR qui upload la cover
      // (cf. CoverSection + PRIMARY_SECTIONS_BY_ROLE.MONTEUR). Sans cet ajout,
      // le step était masqué de la chaîne pour le monteur alors que le bloc
      // d'upload apparaissait quand même dans la fiche → incohérence.
      roles:
        pattern?.coverMode === "monteurUpload"
          ? ["MONTEUR", "CM"]
          : STEP_ROLES.cover,
    },
    {
      key: "publish",
      label: "Publier",
      visible: true,
      status: publishStatus,
      roles: STEP_ROLES.publish,
    },
  ];

  // ── Post-process : todo → waiting si étape amont non terminée ─────────────
  // Si une étape précédente visible n'est pas dans un état "terminal acceptable"
  // (done) et n'est pas elle-même en waiting, alors l'étape courante ne peut
  // pas être réellement actionnable → on lui colle "waiting" (visuel todo,
  // label "En attente"). Évite "À faire" trompeur quand on dépend d'un amont.
  const TERMINAL_FOR_NEXT = new Set<StepStatus>(["done"]);
  const visibleSteps = rawSteps.filter((s) => s.visible);
  const adjustedSteps = rawSteps.map((step) => {
    if (step.status !== "todo") return step;
    const idx = visibleSteps.findIndex((s) => s.key === step.key);
    if (idx <= 0) return step;
    const hasPendingUpstream = visibleSteps
      .slice(0, idx)
      .some((s) => !TERMINAL_FOR_NEXT.has(s.status));
    if (hasPendingUpstream) {
      return { ...step, status: "waiting" as StepStatus };
    }
    return step;
  });

  // ── Résolution de nextAction ───────────────────────────────────────────────
  // Le step actif est la première étape réellement actionnable maintenant
  // (todo ou failed). Les étapes en "waiting" sont futures, pas actives.
  let nextActionSet = false;

  const steps: PublicationStep[] = adjustedSteps.map((step) => {
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

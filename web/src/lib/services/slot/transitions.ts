/**
 * Matrice de transitions de statut et helpers associés.
 *
 * - STATUS_TRANSITIONS : transitions autorisées par statut pour les rôles non-ADMIN.
 * - canTransition      : valide une transition (avec bypass ADMIN et tolérance legacy).
 * - AutoTransitionTrigger : déclencheurs d'auto-transition suite à une action métier
 *                           (uploads MONTEUR : rushes, versions).
 * - computeAutoTransition : calcule la cible d'une auto-transition (uploads).
 * - applyAutoTransition   : applique l'auto-transition upload et log l'activité.
 * - computeAutoTransitionTarget : calcule la cible quand un job RunPod termine
 *                                  (render, captions). Lit l'état complet du slot.
 * - applyAutoTransitionFromPipeline : applique la transition pipeline + log.
 */

import type { SlotStatus, UserRole } from "@/types/roles";
import type { PrismaClient } from "@prisma/client";
import { logActivity } from "./activity";

// ─── Statuts legacy toujours présents en base (Phase 1.3 backfill) ────────────

export const LEGACY_STATUSES = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"] as const;

// ─── Matrice de transitions ────────────────────────────────────────────────────

/**
 * Pour chaque statut source, liste des statuts cibles autorisés pour les rôles
 * non-ADMIN. Les ADMIN bypasse totalement cette matrice.
 *
 * Statuts terminaux (CANCELLED, ARCHIVED, BLOCKED) : tableau vide car la
 * récupération passe toujours par un ADMIN.
 */
export const STATUS_TRANSITIONS: Record<SlotStatus, SlotStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED", "BLOCKED"],
  PLANNED: ["RUSHES_EXPECTED", "IN_EDIT", "CANCELLED", "BLOCKED"],
  RUSHES_EXPECTED: ["RUSHES_RECEIVED", "BLOCKED", "CANCELLED"],
  RUSHES_RECEIVED: ["IN_EDIT", "CANCELLED"],
  IN_EDIT: ["EDIT_REVIEW", "BLOCKED", "CANCELLED"],
  EDIT_REVIEW: ["EDIT_APPROVED", "IN_EDIT", "CANCELLED"],
  EDIT_APPROVED: ["CAPTIONS_PENDING", "READY_FOR_CM", "SCHEDULED", "CANCELLED"],
  CAPTIONS_PENDING: ["READY_FOR_CM", "EDIT_APPROVED", "CANCELLED"],
  // READY_FOR_CM → AWAITING_CLIENT seulement si needsClientValidation est actif.
  // L'enforcement métier (ne pas envoyer pour validation si non requis) se fait côté
  // route /send-for-validation, pas dans cette matrice générique.
  READY_FOR_CM: ["AWAITING_CLIENT", "SCHEDULED", "PUBLISHED", "CANCELLED"],
  AWAITING_CLIENT: ["SCHEDULED", "CLIENT_REVISION", "READY_FOR_CM", "CANCELLED"],
  CLIENT_REVISION: ["AWAITING_CLIENT", "IN_EDIT", "READY_FOR_CM", "CANCELLED"],
  SCHEDULED: ["PUBLISHED", "READY_FOR_CM", "CANCELLED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["IN_EDIT", "CANCELLED"],
  BLOCKED: [],  // récupération ADMIN uniquement
  CANCELLED: [],
  ARCHIVED: [],
  // ── Legacy : transitions vides — la fonction canTransition tolère
  //    les statuts legacy en `from` via LEGACY_STATUSES (cf. ligne 68)
  //    et délègue la décision à l'ADMIN pour faire avancer le slot
  //    vers la pipeline éditoriale moderne. Les entries ci-dessous ne
  //    servent qu'à satisfaire le type Record<SlotStatus, SlotStatus[]>.
  TO_DO: [],
  IN_PROGRESS: [],
  READY: [],
  CHECKING: [],
  DONE: [],
};

// ─── canTransition ─────────────────────────────────────────────────────────────

/**
 * Vérifie si la transition `from` → `to` est autorisée pour le rôle donné.
 *
 * - ADMIN : bypass total (toujours true).
 * - Statuts legacy en `from` : ADMIN-only (avant le backfill Phase 1.3, on tolérait
 *   ces transitions pour tous les rôles — bug audit 2026-05-30 : un CM/MONTEUR pouvait
 *   pousser un slot legacy vers PUBLISHED bypass complet de la matrice).
 * - Autres rôles : vérifie strictement la matrice STATUS_TRANSITIONS.
 */
export function canTransition(from: string, to: string, role: UserRole): boolean {
  if (role === "ADMIN") return true;
  // USER / EXTERNAL_GENERATOR n'ont aucun accès à la pipeline éditoriale.
  if (role === "EXTERNAL_GENERATOR") return false;
  // Statut legacy : seul l'ADMIN peut le faire bouger (sortie déjà gérée plus haut).
  // Les autres rôles doivent attendre que le slot soit normalisé.
  if ((LEGACY_STATUSES as readonly string[]).includes(from)) return false;
  const allowed = STATUS_TRANSITIONS[from as SlotStatus];
  return Array.isArray(allowed) && allowed.includes(to as SlotStatus);
}

// ─── AutoTransitionTrigger ─────────────────────────────────────────────────────

/**
 * Déclencheurs d'auto-transition suite à une action métier.
 *
 * - RUSHES_UPLOADED_FIRST    : premier rush uploadé sur ce slot.
 * - VERSION_UPLOADED_FIRST   : première version uploadée (montage initial).
 * - VERSION_UPLOADED_AGAIN   : version uploadée alors que le slot est EDIT_APPROVED.
 * - VERSION_PROMOTED         : version promue en version courante.
 */
export type AutoTransitionTrigger =
  | "RUSHES_UPLOADED_FIRST"
  | "VERSION_UPLOADED_FIRST"
  | "VERSION_UPLOADED_AGAIN"
  | "VERSION_PROMOTED";

// ─── computeAutoTransition ────────────────────────────────────────────────────

/**
 * Calcule le statut cible d'une auto-transition selon l'état courant du slot
 * et le déclencheur. Retourne null si aucune transition ne s'applique.
 */
export function computeAutoTransition(
  currentStatus: string,
  trigger: AutoTransitionTrigger
): string | null {
  if (
    trigger === "RUSHES_UPLOADED_FIRST" &&
    ["DRAFT", "PLANNED", "RUSHES_EXPECTED"].includes(currentStatus)
  ) {
    return "RUSHES_RECEIVED";
  }
  if (
    trigger === "VERSION_UPLOADED_FIRST" &&
    ["RUSHES_RECEIVED", "IN_EDIT"].includes(currentStatus)
  ) {
    return "EDIT_REVIEW";
  }
  if (trigger === "VERSION_UPLOADED_AGAIN" && currentStatus === "EDIT_APPROVED") {
    return "EDIT_REVIEW";
  }
  if (
    trigger === "VERSION_PROMOTED" &&
    // Fix bug audit 2026-05-30 : garde sur le status courant. Sans ça, promouvoir
    // une version d'un slot déjà SCHEDULED / PUBLISHED / AWAITING_CLIENT régresse
    // le slot vers EDIT_APPROVED et casse la progression aval (perte de date
    // programmée côté CM, confusion UI).
    ["DRAFT", "PLANNED", "RUSHES_RECEIVED", "IN_EDIT", "EDIT_REVIEW"].includes(currentStatus)
  ) {
    return "EDIT_APPROVED";
  }
  return null;
}

// ─── applyAutoTransition ──────────────────────────────────────────────────────

/**
 * Applique une auto-transition sur un slot Prisma si elle est applicable.
 *
 * - Calcule le statut cible via computeAutoTransition.
 * - Si null, ne fait rien.
 * - Sinon, update PublicationSlot.status + logActivity STATUS_CHANGED.
 *
 * Doit être appelé à l'intérieur d'une transaction Prisma (le tx est passé
 * comme paramètre pour que l'update soit atomique avec l'action parente).
 *
 * @returns Le nouveau statut si une transition a eu lieu, null sinon.
 */
export async function applyAutoTransition(
  prisma: PrismaClient,
  slotId: string,
  currentStatus: string,
  trigger: AutoTransitionTrigger,
  actorId: string | null
): Promise<string | null> {
  const targetStatus = computeAutoTransition(currentStatus, trigger);
  if (!targetStatus) return null;

  // Update conditionnel sur le status courant : si un autre process a déjà
  // fait évoluer le slot entre la lecture (currentStatus) et ici, on ne
  // veut PAS écraser cet état avec notre cible (risque de régression). Le
  // count=0 signifie "race perdue, on skip silencieusement".
  const updated = await prisma.publicationSlot.updateMany({
    where: { id: slotId, status: currentStatus },
    data: { status: targetStatus },
  });
  if (updated.count === 0) {
    console.info(
      `[applyAutoTransition] race détectée (slot=${slotId} trigger=${trigger}) : ` +
        `status attendu "${currentStatus}" mais déjà changé — transition ignorée.`,
    );
    return null;
  }

  await logActivity(prisma, {
    slotId,
    actorId,
    type: "STATUS_CHANGED",
    payload: { from: currentStatus, to: targetStatus, trigger },
  });

  return targetStatus;
}

// ─── Pipeline auto-transitions (jobs RunPod) ──────────────────────────────────

/**
 * Trigger côté pipeline RunPod (jobs asynchrones).
 *
 * - RENDER_STARTED     : Render créé (POST /api/renders) — passage TO_DO → IN_PROGRESS.
 * - RENDER_COMPLETED   : webhook /api/webhooks/runpod/renders a passé Render.status=DONE.
 * - CAPTIONS_COMPLETED : webhook /api/webhooks/runpod/captions a passé CaptionJob.status=COMPLETED.
 */
export type PipelineTrigger =
  | "RENDER_STARTED"
  | "RENDER_COMPLETED"
  | "CAPTIONS_COMPLETED";

// ── Statuts "pilotés par le pipeline" : on peut écraser tant qu'on est ici. ──
// Dès que l'utilisateur fait avancer manuellement (READY_FOR_CM est posé par
// nous-mêmes, donc accepté ; les autres viennent d'actions humaines).
//
// DRAFT/PLANNED inclus car ce sont les statuts initiaux des slots auto_template
// (mapSourceToInitialStatus → PLANNED ; createSlot sans pattern → DRAFT). Sans
// eux, un slot fraîchement créé reste éternellement "À planifier" même quand
// le Render passe DONE — l'auto-transition pipeline ne le voyait pas comme
// pilotable. TO_DO est conservé pour les slots legacy non backfillés.
const PIPELINE_DRIVEN_STATUSES = new Set<string>([
  "DRAFT",
  "PLANNED",
  "TO_DO",
  "IN_PROGRESS",
  "READY_FOR_CM", // accepté car on peut y être passé puis vouloir reculer en IN_PROGRESS
]);

// ── Inputs minimaux pour la décision (pour tests unit purs sans mock Prisma) ──

interface SlotForAutoTransition {
  status: string;
  pattern: {
    source: string;
    /** @deprecated V8 — utiliser needsCaptionsMode. */
    needsCaptions: boolean;
    /** V8 — "none" | "auto" | "manual". null = lit needsCaptions Boolean. */
    needsCaptionsMode?: string | null;
    /** Phase 2026-05-30 : pris en compte pour cibler AWAITING_CLIENT après captions. */
    needsClientValidation?: boolean;
  } | null;
  /** Override slot (prime sur pattern.needsClientValidation). */
  needsClientValidationOverride?: boolean | null;
  render: { status: string } | null;
  latestCaptionJobStatus: string | null;
}

/**
 * Logique pure (testable sans DB) : calcule le statut cible d'un slot
 * auto_template selon l'état réel de ses jobs.
 *
 * Règles :
 *  - Si pattern.source !== "auto_template" → null (autres flows gèrent eux-mêmes)
 *  - Si slot.status n'est pas dans PIPELINE_DRIVEN_STATUSES → null
 *    (CM/MONTEUR a déjà déplacé manuellement vers IN_EDIT, SCHEDULED, etc.)
 *  - Render PENDING/PROCESSING → IN_PROGRESS
 *  - Render ERROR → IN_PROGRESS (le CM verra l'erreur dans la fiche)
 *  - Render DONE :
 *    - !needsCaptions → READY_FOR_CM
 *    - needsCaptions :
 *      - captions COMPLETED → READY_FOR_CM
 *      - captions QUEUED/PROCESSING → IN_PROGRESS (en attente active)
 *      - captions FAILED ou null → READY_FOR_CM (le pipeline est définitivement
 *        KO ou n'a jamais tourné ; on ne bloque pas le CM qui peut publier la
 *        vidéo brute ou relancer manuellement)
 *  - Si la cible calculée = statut actuel → null (idempotence)
 */
export function computeAutoTransitionTargetPure(
  slot: SlotForAutoTransition,
): SlotStatus | null {
  if (!PIPELINE_DRIVEN_STATUSES.has(slot.status)) return null;
  if (!slot.pattern || slot.pattern.source !== "auto_template") return null;

  const renderStatus = slot.render?.status ?? null;
  if (renderStatus === null) return null; // pas de render encore → rien à automatiser

  // Fix 2026-05-30 : la cible "post-pipeline" dépend désormais de
  // needsClientValidation. Si validation client requise, on passe à
  // AWAITING_CLIENT (le client doit valider la vidéo finale, sous-titrée
  // si applicable), sinon READY_FOR_CM (le CM peut publier directement).
  const needsValidation =
    slot.needsClientValidationOverride ??
    slot.pattern.needsClientValidation ??
    false;
  const postPipelineTarget: SlotStatus = needsValidation
    ? ("AWAITING_CLIENT" as SlotStatus)
    : ("READY_FOR_CM" as SlotStatus);

  let target: SlotStatus;
  if (renderStatus === "DONE") {
    const captionStatus = slot.latestCaptionJobStatus;
    // V8.2.2 — Le pipeline auto-transition n'attend les captions QUE en mode
    // auto. En mode "manual", le CM écrit à la main dans la fiche : pas de
    // job RunPod à attendre → on transitionne directement post-pipeline.
    const captionsMode =
      slot.pattern.needsCaptionsMode ??
      (slot.pattern.needsCaptions ? "auto" : "none");
    const captionsAutoExpected = captionsMode === "auto";
    if (!captionsAutoExpected) {
      target = postPipelineTarget;
    } else if (captionStatus === "COMPLETED") {
      target = postPipelineTarget;
    } else if (captionStatus === "QUEUED" || captionStatus === "PROCESSING") {
      // Attente active du job captions.
      target = "IN_PROGRESS" as SlotStatus;
    } else if (captionStatus === "FAILED") {
      // Fix 2026-05-31 : avant on transitionnait quand même en READY_FOR_CM,
      // ce qui laissait le CM publier sans sous-titres alors qu'ils étaient
      // exigés. Désormais on reste en IN_PROGRESS — l'admin doit relancer le
      // job captions ou désactiver needsCaptions explicitement pour débloquer.
      target = "IN_PROGRESS" as SlotStatus;
    } else {
      // captionStatus === null : aucun job lancé (pipeline jamais déclenché
      // ou needsCaptions activé après création du pattern) — on avance, le
      // CM peut décider de lancer ou non un job manuel.
      target = postPipelineTarget;
    }
  } else {
    // PENDING / PROCESSING / ERROR — render pas finalisé.
    target = "IN_PROGRESS" as SlotStatus;
  }

  // Idempotence : pas d'update si déjà au bon statut.
  if (slot.status === target) return null;
  return target;
}

/**
 * Variante async qui charge le slot via Prisma et applique la logique pure.
 * Utilisée depuis les webhooks RunPod (renders, captions).
 *
 * @returns Le statut cible si une transition s'applique, null sinon.
 */
export async function computeAutoTransitionTarget(
  prisma: PrismaClient,
  slotId: string,
): Promise<SlotStatus | null> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      status: true,
      needsClientValidationOverride: true,
      pattern: {
        select: { source: true, needsCaptions: true, needsCaptionsMode: true, needsClientValidation: true },
      },
      render: { select: { status: true } },
      // V6.6.1 — On charge 5 jobs au lieu de 1 pour distinguer le PROCESSING
      // (qui ne doit PAS faire regresser la transition) d'un COMPLETED
      // précédent non-stale (qui valide la transition).
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { status: true, staleSince: true },
      },
    },
  });
  if (!slot) return null;

  // V6.6.1 — Priorité au COMPLETED non-stale (si présent), sinon latest
  // tout court. Évite la régression IN_PROGRESS quand un retry PROCESSING
  // arrive après un COMPLETED valide.
  const latestCompletedFresh = slot.captionJobs.find(
    (j) => j.status === "COMPLETED" && !j.staleSince,
  );
  const effectiveCaptionStatus =
    latestCompletedFresh?.status ?? slot.captionJobs[0]?.status ?? null;

  return computeAutoTransitionTargetPure({
    status: slot.status,
    pattern: slot.pattern,
    needsClientValidationOverride: slot.needsClientValidationOverride,
    render: slot.render,
    latestCaptionJobStatus: effectiveCaptionStatus,
  });
}

/**
 * Rattrapage opportuniste : prend une liste de slots déjà chargés (avec
 * pattern + render + dernier captionJob inclus), calcule les transitions
 * applicables en mémoire, applique en parallèle et retourne un Map des
 * nouveaux statuts par slot ID.
 *
 * Best-effort : un échec individuel ne bloque pas les autres.
 *
 * @param slots Slots préchargés. Le caller doit inclure pattern (source +
 *   needsCaptions), render (status), et captionJobs (orderBy createdAt desc,
 *   take 1, select status).
 * @returns Map<slotId, newStatus> pour les slots ayant réellement changé.
 */
export async function syncSlotsPipelineStatuses(
  prisma: PrismaClient,
  slots: Array<{
    id: string;
    status: string;
    needsClientValidationOverride?: boolean | null;
    pattern: {
      source: string;
      needsCaptions: boolean;
      /** V8 — "none" | "auto" | "manual". null = lit needsCaptions Boolean. */
      needsCaptionsMode?: string | null;
      needsClientValidation?: boolean;
    } | null;
    render: { status: string } | null;
    captionJobs?: Array<{ status: string }>;
  }>,
): Promise<Map<string, SlotStatus>> {
  const updates = new Map<string, SlotStatus>();

  const targets = slots
    .map((s) => {
      const target = computeAutoTransitionTargetPure({
        status: s.status,
        pattern: s.pattern,
        needsClientValidationOverride: s.needsClientValidationOverride,
        render: s.render,
        latestCaptionJobStatus: s.captionJobs?.[0]?.status ?? null,
      });
      return target ? { id: s.id, from: s.status, to: target } : null;
    })
    .filter((x): x is { id: string; from: string; to: SlotStatus } => x !== null);

  if (targets.length === 0) return updates;

  await Promise.all(
    targets.map(async (t) => {
      try {
        // Update + logActivity dans une seule transaction : sans ça, si le
        // logActivity échoue après l'update, le statut est changé mais la
        // trace d'audit est manquante (silencieusement). Le updateMany
        // conditionnel sur `from` protège aussi contre une race avec une
        // autre transition concurrente — count=0 signifie qu'un autre
        // process a déjà fait évoluer le slot, on skip sans logger une
        // transition fantôme.
        await prisma.$transaction(async (tx) => {
          const updated = await tx.publicationSlot.updateMany({
            where: { id: t.id, status: t.from },
            data: { status: t.to },
          });
          if (updated.count === 0) {
            // Le slot a déjà bougé entre computeTarget et update — pas une
            // erreur, juste une course perdue.
            return;
          }
          await logActivity(tx as typeof prisma, {
            slotId: t.id,
            actorId: null,
            type: "STATUS_CHANGED",
            payload: { from: t.from, to: t.to, trigger: "BACKFILL_SYNC" },
          });
          updates.set(t.id, t.to);
        });
      } catch (err) {
        console.warn(
          `[syncSlotsPipelineStatuses] échec slot=${t.id} ${t.from}→${t.to}:`,
          err,
        );
      }
    }),
  );

  return updates;
}

/**
 * Applique l'auto-transition pipeline si la logique le permet.
 * Best-effort : log un warning et continue si l'update échoue (le webhook
 * ne doit pas être bloqué par une transition qui rate).
 *
 * @returns Le nouveau statut si une transition a eu lieu, null sinon.
 */
export async function applyAutoTransitionFromPipeline(
  prisma: PrismaClient,
  slotId: string,
  trigger: PipelineTrigger,
): Promise<SlotStatus | null> {
  try {
    // Fix bug audit 2026-05-30 : 1 SEULE lecture du slot pour calculer la cible
    // ET servir de garde dans l'updateMany. Anciennement, on faisait 2 lectures
    // séparées — entre les 2, un ADMIN pouvait passer SCHEDULED, et l'update
    // forçait quand même la régression vers la cible calculée.
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: {
        status: true,
        needsClientValidationOverride: true,
        pattern: {
          select: { source: true, needsCaptions: true, needsCaptionsMode: true, needsClientValidation: true },
        },
        render: { select: { status: true } },
        captionJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!slot) return null;

    const target = computeAutoTransitionTargetPure({
      status: slot.status,
      pattern: slot.pattern,
      needsClientValidationOverride: slot.needsClientValidationOverride,
      render: slot.render,
      latestCaptionJobStatus: slot.captionJobs[0]?.status ?? null,
    });
    if (!target) return null;

    const updated = await prisma.publicationSlot.updateMany({
      // Conditionné sur le status LU (slot.status), pas sur une re-lecture
      // ultérieure. Si un autre process a changé le statut entre la lecture
      // et l'update, count=0 et on abandonne (sans régression).
      where: { id: slotId, status: slot.status },
      data: { status: target },
    });
    if (updated.count === 0) {
      console.info(
        `[applyAutoTransitionFromPipeline] race détectée (slot=${slotId} trigger=${trigger}) : ` +
          `status "${slot.status}" déjà changé par un autre process — transition ignorée.`,
      );
      return null;
    }

    await logActivity(prisma, {
      slotId,
      actorId: null, // déclenché par un webhook serveur, pas un utilisateur
      type: "STATUS_CHANGED",
      payload: { from: slot.status, to: target, trigger },
    });

    return target;
  } catch (err) {
    console.warn(
      `[applyAutoTransitionFromPipeline] échec pour slot=${slotId} trigger=${trigger}:`,
      err,
    );
    return null;
  }
}

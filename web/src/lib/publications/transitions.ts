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
import { logActivity } from "@/lib/publications/activity";

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
  READY_FOR_CM: ["SCHEDULED", "PUBLISHED", "CANCELLED"],
  SCHEDULED: ["PUBLISHED", "READY_FOR_CM", "CANCELLED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["IN_EDIT", "CANCELLED"],
  BLOCKED: [],  // récupération ADMIN uniquement
  CANCELLED: [],
  ARCHIVED: [],
};

// ─── canTransition ─────────────────────────────────────────────────────────────

/**
 * Vérifie si la transition `from` → `to` est autorisée pour le rôle donné.
 *
 * - ADMIN : bypass total (toujours true).
 * - Statuts legacy en `from` : tolérés (true) jusqu'au backfill Phase 1.3.
 * - Autres rôles : vérifie la matrice STATUS_TRANSITIONS.
 */
export function canTransition(from: string, to: string, role: UserRole): boolean {
  if (role === "ADMIN") return true;
  // USER n'a aucun accès à la pipeline éditoriale.
  if (role === "EXTERNAL_GENERATOR") return false;
  if ((LEGACY_STATUSES as readonly string[]).includes(from)) return true;
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
  if (trigger === "VERSION_PROMOTED") {
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

  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { status: targetStatus },
  });

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
const PIPELINE_DRIVEN_STATUSES = new Set<string>([
  "TO_DO",
  "IN_PROGRESS",
  "READY_FOR_CM", // accepté car on peut y être passé puis vouloir reculer en IN_PROGRESS
]);

// ── Inputs minimaux pour la décision (pour tests unit purs sans mock Prisma) ──

interface SlotForAutoTransition {
  status: string;
  pattern: { source: string; needsCaptions: boolean } | null;
  render: { status: string } | null;
  latestCaptionJobStatus: string | null;
}

/**
 * Logique pure (testable sans DB) : calcule le statut cible d'un slot
 * auto_template selon l'état réel de ses jobs.
 *
 * Règles (validées avec le user) :
 *  - Si pattern.source !== "auto_template" → null (les autres flows gèrent eux-mêmes)
 *  - Si slot.status n'est pas dans PIPELINE_DRIVEN_STATUSES → null
 *    (CM/MONTEUR a déjà déplacé manuellement vers IN_EDIT, SCHEDULED, etc.)
 *  - Render PENDING/PROCESSING → IN_PROGRESS
 *  - Render ERROR → IN_PROGRESS (le CM verra l'erreur dans la fiche ; pas de READY_FOR_CM)
 *  - Render DONE :
 *    - needsCaptions = false → READY_FOR_CM
 *    - needsCaptions = true && captions COMPLETED → READY_FOR_CM
 *    - needsCaptions = true && captions QUEUED/PROCESSING/FAILED/null → IN_PROGRESS
 *  - Si la cible calculée = statut actuel → null (idempotence, évite update inutile)
 */
export function computeAutoTransitionTargetPure(
  slot: SlotForAutoTransition,
): SlotStatus | null {
  if (!PIPELINE_DRIVEN_STATUSES.has(slot.status)) return null;
  if (!slot.pattern || slot.pattern.source !== "auto_template") return null;

  const renderStatus = slot.render?.status ?? null;
  if (renderStatus === null) return null; // pas de render encore → rien à automatiser

  let target: SlotStatus;
  if (renderStatus === "DONE") {
    if (!slot.pattern.needsCaptions) {
      target = "READY_FOR_CM";
    } else if (slot.latestCaptionJobStatus === "COMPLETED") {
      target = "READY_FOR_CM";
    } else {
      // captions pas encore prêtes (QUEUED/PROCESSING/FAILED/null)
      target = "IN_PROGRESS" as SlotStatus;
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
      pattern: { select: { source: true, needsCaptions: true } },
      render: { select: { status: true } },
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!slot) return null;

  return computeAutoTransitionTargetPure({
    status: slot.status,
    pattern: slot.pattern,
    render: slot.render,
    latestCaptionJobStatus: slot.captionJobs[0]?.status ?? null,
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
    pattern: { source: string; needsCaptions: boolean } | null;
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
        await prisma.publicationSlot.update({
          where: { id: t.id },
          data: { status: t.to },
        });
        await logActivity(prisma, {
          slotId: t.id,
          actorId: null,
          type: "STATUS_CHANGED",
          payload: { from: t.from, to: t.to, trigger: "BACKFILL_SYNC" },
        });
        updates.set(t.id, t.to);
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
    const target = await computeAutoTransitionTarget(prisma, slotId);
    if (!target) return null;

    // Re-lire le status courant pour le payload activity (la cible a été
    // calculée mais on ne l'a pas en local).
    const current = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { status: true },
    });
    if (!current) return null;

    await prisma.publicationSlot.update({
      where: { id: slotId },
      data: { status: target },
    });

    await logActivity(prisma, {
      slotId,
      actorId: null, // déclenché par un webhook serveur, pas un utilisateur
      type: "STATUS_CHANGED",
      payload: { from: current.status, to: target, trigger },
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

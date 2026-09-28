/**
 * renderLaunchService.ts
 *
 * Lancement d'un rendu (`POST /api/renders`) et création du listing qui le
 * porte (`POST /api/listings`), extraits en service — plan « Lancer les
 * rendus depuis le calendrier » (étapes 1, 2). Sert aussi bien au formulaire
 * unitaire qu'au lot (`bulkRenderService.ts`, étape 6).
 *
 * Règle d'or de l'extraction (services/README.md) : aucun changement de
 * payload JSON — les routes qui appellent ces fonctions renvoient exactement
 * ce qu'elles renvoyaient avant. Les correctifs de robustesse (étape 2 :
 * revert des claims sur toute exception, kickoff qui échoue, verrou par slot,
 * récupération des orphelins) sont des changements de COMPORTEMENT SERVEUR,
 * pas de contrat HTTP.
 */

import { Prisma, type Render } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import { hasTool, TOOLS, canAccessTemplate } from "@/lib/permissions";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { isSchemaFieldVisible } from "@/lib/templateConditions";
import { buildVisibleFormSections } from "@/lib/formSections";
import type { TemplateJSON, SchemaField } from "@/types/template";
import type { RenderRequestBody } from "@/lib/generate/buildRenderRequestBody";
import { startRenderGeneration } from "@/lib/renderer/generateRender";
import { RENDER_STAGE } from "@/lib/renderer/renderWorkflow";
import { revertLibraryCursors } from "@/lib/recordLibraryUsage";
import {
  advanceMediaUsageOnSubmit,
  advanceAudioUsageOnSubmit,
  advanceDataUsageOnSubmit,
  type MediaUsageClaimState,
  type DataUsageClaimState,
} from "@/lib/contentLibraryResolver";
import { applyAutoTransitionFromPipeline } from "@/lib/services/slot/transitions";
import { validateManualAssetSelection } from "@/lib/generate/validateManualAssetSelection";
import { notifyUser } from "@/lib/sseStore";
import { NotFoundError, ForbiddenError, ValidationError, MissingFieldsError, RenderInFlightError } from "@/lib/services/_runtime/errors";

// ─── Champs requis manquants (union route ↔ formulaire) ─────────────────────

/**
 * Union de deux contrôles d'obligatoire :
 *  (a) celui de `POST /api/listings` — sur le `json.schema` brut du template ;
 *  (b) celui du formulaire (`ListingForm.tsx:480-491,586-595`) — sur
 *      `finalSchema` (schéma fusionné + custom fields + relaxations auto),
 *      via les mêmes sections visibles que le formulaire affiche réellement.
 * `finalSchema` omis = seul (a) s'applique (comportement `createListingForRender`,
 * identique à la route historique).
 *
 * Retourne les libellés (`field.label || field.key`), dédupliqués — c'est
 * exactement la valeur que `POST /api/listings` renvoyait déjà dans `missing`.
 * Ne mute aucun des arguments.
 */
export function findMissingRequiredFields(args: {
  json: TemplateJSON;
  values: Record<string, unknown>;
  finalSchema?: SchemaField[];
}): string[] {
  // Garde défensive : la route historique lisait `data?.[field.key]` (le body
  // JSON n'est pas garanti d'avoir `data`) — reproduit ici sans muter l'objet
  // passé par l'appelant.
  const values = args.values ?? {};
  const { json, finalSchema } = args;
  const missing: string[] = [];
  const seen = new Set<string>();

  const push = (field: SchemaField) => {
    const val = values[field.key];
    if (val !== undefined && val !== null && val !== "") return;
    const label = field.label || field.key;
    if (seen.has(label)) return;
    seen.add(label);
    missing.push(label);
  };

  // (a) — check route historique : json.schema brut + isSchemaFieldVisible.
  const rawSchema: SchemaField[] = json.schema ?? [];
  for (const field of rawSchema) {
    if (!field.required) continue;
    if (!isSchemaFieldVisible(field, values)) continue;
    push(field);
  }

  // (b) — check formulaire : finalSchema + sections visibles réellement rendues.
  if (finalSchema) {
    const sections = buildVisibleFormSections(finalSchema, json.formSections ?? [], values);
    for (const section of sections) {
      for (const field of section.fields) {
        if (!field.required) continue;
        push(field);
      }
    }
  }

  return missing;
}

// ─── Création du listing (POST /api/listings) ────────────────────────────────

/**
 * Extrait de `app/api/listings/route.ts` (POST). Mêmes contrôles d'accès que
 * la route aujourd'hui ; champs requis vides → `MissingFieldsError`.
 *
 * Le check requis reste volontairement sur le SEUL `json.schema` brut (pas de
 * `finalSchema` ici) — c'est le contrat historique de cette route. Un
 * appelant qui veut l'union (lot, aperçu) appelle `findMissingRequiredFields`
 * lui-même avec `finalSchema`.
 *
 * Signature de retour `{ id: string }` pour les appelants (bulkRenderService) ;
 * la ligne renvoyée est en réalité le `Listing` complet, pour que la route
 * puisse la forwarder telle quelle (contrat HTTP identique).
 */
export async function createListingForRender(
  input: { templateId: string; data: Record<string, unknown> },
  ctx: UserContext,
): Promise<{ id: string }> {
  const { templateId, data } = input;

  const template = await prisma.template.findFirst({ where: { id: templateId } });
  if (!template) throw new NotFoundError("Template");

  const ok = ctx.canAdminBypass
    ? true
    : await canAccessTemplate(ctx.effectiveUser.id, templateId, ctx.effectiveUser.role);
  if (!ok) throw new ForbiddenError("Accès refusé à ce template");

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const missing = findMissingRequiredFields({ json, values: data });
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const listing = await prisma.listing.create({
    data: {
      templateId,
      jsonData: JSON.stringify(data),
      userId: ctx.effectiveUser.id,
    },
  });
  return listing;
}

// ─── Verrou par slot (en mémoire, process unique) ────────────────────────────

/**
 * `Set` de slotIds actuellement en cours de lancement, sur `globalThis` —
 * même motif que `renderPNG.ts` (survit au HMR en dev, le process PM2 est
 * unique en prod). Empêche un double-clic ou un lot + formulaire lancés en
 * même temps de créer deux listings/renders orphelins pour le même slot.
 */
const globalForRenderLock = globalThis as unknown as {
  __renderLaunchLockedSlotIds?: Set<string>;
};
function getLockedSlotIds(): Set<string> {
  if (!globalForRenderLock.__renderLaunchLockedSlotIds) {
    globalForRenderLock.__renderLaunchLockedSlotIds = new Set<string>();
  }
  return globalForRenderLock.__renderLaunchLockedSlotIds;
}

export async function withSlotRenderLock<T>(slotId: string, fn: () => Promise<T>): Promise<T> {
  const locked = getLockedSlotIds();
  if (locked.has(slotId)) {
    throw new RenderInFlightError({});
  }
  locked.add(slotId);
  try {
    return await fn();
  } finally {
    locked.delete(slotId);
  }
}

// ─── Récupération des rendus orphelins + garde in-flight ─────────────────────

/**
 * Instant de (re)chargement de ce module — approxime le boot du process.
 * Sur `globalThis` pour ne pas être réinitialisé par le HMR en dev (le process
 * PM2 est unique en prod, donc ce n'est de toute façon posé qu'une fois).
 *
 * Sert à détecter un rendu PROCESSING dont le process qui l'a lancé n'existe
 * plus (redémarrage PM2 avant que le job RunPod ait pu être soumis, donc sans
 * `runpodJobId` — le webhook ne le complétera jamais).
 */
const globalForRenderBoot = globalThis as unknown as {
  __renderLaunchProcessBootAt?: Date;
};
if (!globalForRenderBoot.__renderLaunchProcessBootAt) {
  globalForRenderBoot.__renderLaunchProcessBootAt = new Date();
}
const PROCESS_BOOT_AT = globalForRenderBoot.__renderLaunchProcessBootAt;

/** Un PENDING plus vieux que ça n'a jamais été accepté par `startRenderGeneration` — orphelin. */
const ORPHAN_PENDING_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Un PROCESSING sans `runpodJobId` dont le dernier stage écrit est la
 * soumission RunPod (juste avant `submitRunpodJob`, generateRender.ts) peut
 * avoir été accepté par RunPod avant qu'un redémarrage PM2 n'empêche
 * l'écriture de `runpodJobId` — le webhook le recouvre alors par
 * `output.render_id` (webhooks/runpod/renders/route.ts). On ne le traite
 * comme orphelin qu'après cette marge, plutôt que dès le boot du process.
 */
const ORPHAN_SUBMIT_GRACE_MS = 30 * 60 * 1000;

/**
 * Marque un rendu orphelin en ERROR et reverte ses claims — même forme que
 * `failRender` (generateRender.ts), dupliquée ici volontairement : `failRender`
 * n'est pas exportée, et l'importer créerait un cycle (generateRender.ts
 * importe `startRenderGeneration` depuis nulle part ici, mais ce module
 * importe déjà `startRenderGeneration` DE generateRender.ts).
 *
 * CAS (compare-and-swap) sur l'écriture ERROR, jamais un `update` aveugle :
 * entre la lecture qui a classé ce rendu orphelin (`findInFlightRender`) et
 * cette écriture, le webhook RunPod peut avoir recouvré le job par
 * `render_id` et déjà écrit DONE (le job tournait toujours, seule l'écriture
 * locale de `runpodJobId` avait été perdue). Écrire ERROR sans condition
 * écraserait ce DONE — et son garde d'idempotence (`status === "ERROR"` →
 * return, webhooks/runpod/renders/route.ts) jetterait alors la vidéo déjà
 * terminée à l'arrivée (tardive) du webhook. Le where-clause ne retermine
 * donc que ce que `findInFlightRender` a lu comme candidat : encore
 * PENDING/PROCESSING et toujours sans `runpodJobId`. `count !== 1` veut dire
 * qu'un autre terminateur (webhook, force-fail) est arrivé entre-temps — on
 * ne reverte rien et on ne notifie rien dans ce cas, l'autre terminateur a
 * déjà (ou va) le faire.
 */
async function failOrphanRender(renderId: string): Promise<void> {
  const message = "Rendu orphelin récupéré (process redémarré, ou en attente depuis trop longtemps).";
  let result: { count: number };
  try {
    result = await prisma.render.updateMany({
      where: { id: renderId, status: { in: ["PENDING", "PROCESSING"] }, runpodJobId: null },
      data: {
        status: "ERROR",
        stage: RENDER_STAGE.ERROR,
        statusDetail: message,
        errorMsg: message,
        progress: 1,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[renderLaunchService] failOrphanRender: échec de la mise à jour ERROR pour render=${renderId}:`, err);
    return;
  }
  if (result.count !== 1) {
    console.warn(
      `[renderLaunchService] failOrphanRender: render=${renderId} déjà terminé par ailleurs (webhook ou autre terminateur) — pas de revert, pas de notification.`,
    );
    return;
  }
  await revertLibraryCursors(renderId).catch((err) => {
    console.error(`[renderLaunchService] failOrphanRender: revertLibraryCursors a échoué pour render=${renderId}:`, err);
  });
  // Même forme de payload SSE que `failRender` (generateRender.ts) — best-effort,
  // ne doit jamais masquer l'ERROR déjà écrit ci-dessus.
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { listing: { select: { userId: true } } },
    });
    if (render?.listing?.userId) {
      notifyUser(render.listing.userId, {
        jobType: "render",
        jobId: renderId,
        status: "ERROR",
        errorMsg: message,
      });
    }
  } catch (err) {
    console.error(`[renderLaunchService] failOrphanRender: notifyUser a échoué pour render=${renderId}:`, err);
  }
}

/**
 * Renvoie le rendu PENDING/PROCESSING le plus récent d'un slot, après avoir
 * d'abord récupéré (ERROR + revert) tout orphelin trouvé dans le même lot —
 * partagé par le formulaire, le lot et l'aperçu (tous passent par cette même
 * garde avant de refuser un lancement pour cause de rendu en vol).
 */
export async function findInFlightRender(slotId: string): Promise<{ id: string; status: string } | null> {
  const candidates = await prisma.render.findMany({
    where: { publicationSlotId: slotId, status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true, status: true, stage: true, runpodJobId: true, lastHeartbeatAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (candidates.length === 0) return null;

  const now = Date.now();
  const orphanIds: string[] = [];
  let survivor: { id: string; status: string } | null = null;

  for (const r of candidates) {
    const heartbeatOrCreatedAt = (r.lastHeartbeatAt ?? r.createdAt).getTime();
    // Le stage SEQ_SUBMIT_RUNPOD est écrit juste avant `submitRunpodJob` — si
    // RunPod a déjà accepté le job avant qu'un redémarrage n'empêche
    // l'écriture de `runpodJobId`, le job tourne toujours et le webhook le
    // recouvrira par `render_id`. Le classer orphelin dès le boot du process
    // le ferait passer ERROR pendant que RunPod le termine réellement — on
    // lui laisse une marge avant de le considérer abandonné.
    const isOrphanProcessing =
      r.status === "PROCESSING" &&
      !r.runpodJobId &&
      (r.stage === RENDER_STAGE.SEQ_SUBMIT_RUNPOD
        ? now - heartbeatOrCreatedAt > ORPHAN_SUBMIT_GRACE_MS
        : heartbeatOrCreatedAt < PROCESS_BOOT_AT.getTime());
    const isOrphanPending =
      r.status === "PENDING" && now - r.createdAt.getTime() > ORPHAN_PENDING_THRESHOLD_MS;

    if (isOrphanProcessing || isOrphanPending) {
      orphanIds.push(r.id);
    } else if (!survivor) {
      // `candidates` est trié par createdAt desc : le premier non-orphelin
      // rencontré est le plus récent — inutile de continuer la boucle pour lui,
      // mais on continue quand même pour récupérer les orphelins plus anciens.
      survivor = { id: r.id, status: r.status };
    }
  }

  if (orphanIds.length > 0) {
    await Promise.all(orphanIds.map((id) => failOrphanRender(id)));
  }

  return survivor;
}

// ─── Lancement du rendu (POST /api/renders) ──────────────────────────────────

export type CreatedRender = Render;

type SanitizedUsedAssets = {
  videoAssets?: Record<string, string>;
  manualVideoBlockIds?: string[];
  audioAssetId?: string;
  dataEntryId?: string;
  setSequencedLibraryIds?: string[];
  usedSetTagByLibrary?: Record<string, string>;
  prevMediaUsageStates?: MediaUsageClaimState[];
  prevDataUsageState?: DataUsageClaimState;
  prevAudioUsageState?: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string };
};

/**
 * Revert best-effort des claims d'usage posés au submit — CAS (compare-and-swap)
 * sur chaque ligne, jamais un revert aveugle. Extrait tel quel de
 * `app/api/renders/route.ts` (fix bug audit 2026-05-30, C3).
 */
async function revertAdvancesOnFailure(usedAssets: SanitizedUsedAssets): Promise<void> {
  for (const state of usedAssets.prevMediaUsageStates ?? []) {
    const { assetId, accountId, prevLastUsedAt, claimedLastUsedAt } = state;
    try {
      if (prevLastUsedAt === null) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "MediaAssetUsage"
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "usageCount" = 0
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      } else {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "MediaAssetUsage"
          SET "lastUsedAt" = ${new Date(prevLastUsedAt)}
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] media usage revert failed asset=${assetId}:`, err);
    }
  }
  if (usedAssets.prevAudioUsageState) {
    const { assetId, accountId, prevLastUsedAt, claimedLastUsedAt } = usedAssets.prevAudioUsageState;
    try {
      if (prevLastUsedAt === null) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "MediaAssetUsage"
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "usageCount" = 0
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      } else {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "MediaAssetUsage"
          SET "lastUsedAt" = ${new Date(prevLastUsedAt)}
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] audio revert failed asset=${assetId}:`, err);
    }
  }
  if (usedAssets.prevDataUsageState) {
    const { entryId, accountId, prevLastUsedAt, claimedLastUsedAt } = usedAssets.prevDataUsageState;
    try {
      if (prevLastUsedAt === null) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "DataEntryUsage"
          WHERE "entryId" = ${entryId} AND "accountId" = ${accountId}
            AND "usageCount" = 0
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      } else {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "DataEntryUsage"
          SET "lastUsedAt" = ${new Date(prevLastUsedAt)}
          WHERE "entryId" = ${entryId} AND "accountId" = ${accountId}
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] data usage revert failed entry=${entryId}:`, err);
    }
  }
}

type TemplateShapeForValidation = {
  blocks?: Array<{ id: string; type: string; minDuration?: number; name?: string; libraryId?: string }>;
  videoSequence?: Array<{ id: string; libraryId?: string; label?: string; binding?: string }>;
};

type RenderLaunchPreflight = {
  /** Slot vérifié EXISTANT en DB — undefined si absent du body ou introuvable. */
  validatedSlotId?: string;
};

/**
 * Pré-vérifications d'AUTORISATION — hasTool, accès template, propriété du
 * listing, existence du slot — volontairement SANS verrou (findings
 * slot-lock-before-authz / render-lock-before-authz).
 *
 * Avant ce fix, `createAndStartRender` prenait `withSlotRenderLock` avant ces
 * contrôles : un appelant authentifié mais sans droit (pas d'outil TEMPLATES,
 * pas d'accès au template) pouvait, en boucle, geler le verrou d'un slot le
 * temps de ses propres requêtes rejetées, et faire échouer en 409
 * `RenderInFlightError` un lancement légitime concurrent (formulaire admin,
 * item du lot) sur ce même slot — alors qu'à HEAD une requête non autorisée
 * n'avait aucun effet sur les lancements des autres. Ici, tout appelant qui
 * échoue une de ces vérifications n'a jamais touché le verrou : il est posé
 * seulement autour de la section qui suit (in-flight, claims, création,
 * kickoff), par `createAndStartRender`.
 *
 * Mêmes contrôles, mêmes messages, mêmes codes d'erreur qu'avant ce fix — le
 * contrat HTTP de `POST /api/renders` ne change pas.
 */
async function preflightCreateAndStartRender(input: RenderRequestBody, ctx: UserContext): Promise<RenderLaunchPreflight> {
  const isAdmin = ctx.canAdminBypass;

  if (!isAdmin && !(await hasTool(ctx.effectiveUser.id, TOOLS.TEMPLATES))) {
    throw new ForbiddenError("Accès refusé");
  }

  const { templateId, listingId, publicationSlotId } = input;

  if (!templateId || !listingId) {
    throw new ValidationError("templateId et listingId requis");
  }

  if (!isAdmin) {
    const access = await prisma.templateAccess.findUnique({
      where: { userId_templateId: { userId: ctx.effectiveUser.id, templateId } },
    });
    if (!access) throw new ForbiddenError("Accès au template refusé");
  }

  const listing = await prisma.listing.findFirst({
    where: isAdmin ? { id: listingId } : { id: listingId, userId: ctx.effectiveUser.id },
  });
  if (!listing) throw new NotFoundError("Listing");

  let validatedSlotId: string | undefined;
  if (typeof publicationSlotId === "string" && publicationSlotId) {
    const slot = await prisma.publicationSlot.findUnique({ where: { id: publicationSlotId }, select: { id: true } });
    if (slot) validatedSlotId = slot.id;
  }

  return { validatedSlotId };
}

/**
 * Section VERROUILLÉE (`withSlotRenderLock`, posée par `createAndStartRender`) :
 * in-flight (avec récupération d'orphelins), claims d'usage, création du
 * Render, kickoff. Suppose `preflight` déjà validé — n'y refait aucune des
 * vérifications d'autorisation.
 */
async function createAndStartRenderLocked(
  input: RenderRequestBody,
  ctx: UserContext,
  preflight: RenderLaunchPreflight,
): Promise<CreatedRender> {
  const { templateId, listingId, accountId } = input;
  // Traité comme `unknown` : le body réel vient d'un `req.json()` non typé
  // côté route — la sanitation ci-dessous ne fait confiance à aucune forme.
  const usedAssets: unknown = input.usedAssets;
  const { validatedSlotId } = preflight;

  // ── Sanitize usedAssets — ne fait confiance à aucun champ du payload client
  // sans revérification DB (existence, appartenance, accès). Extrait tel quel
  // de POST /api/renders. ──────────────────────────────────────────────────
  const sanitizedUsedAssets: SanitizedUsedAssets = {};

  if (usedAssets && typeof usedAssets === "object") {
    const raw = usedAssets as {
      videoAssets?: unknown;
      manualVideoBlockIds?: unknown;
      audioAssetId?: unknown;
      dataEntryId?: unknown;
      setSequencedLibraryIds?: unknown;
      usedSetTagByLibrary?: unknown;
    };

    if (raw.videoAssets && typeof raw.videoAssets === "object" && !Array.isArray(raw.videoAssets)) {
      const videoMap = raw.videoAssets as Record<string, unknown>;
      const ids = Object.values(videoMap).filter((v): v is string => typeof v === "string");
      if (ids.length > 0) {
        const found = await prisma.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true } });
        const validIds = new Set(found.map((a) => a.id));
        sanitizedUsedAssets.videoAssets = Object.fromEntries(
          Object.entries(videoMap).filter(([, v]) => typeof v === "string" && validIds.has(v as string)) as [string, string][],
        );
      }
    }

    if (Array.isArray(raw.manualVideoBlockIds)) {
      const pinned = new Set(Object.keys(sanitizedUsedAssets.videoAssets ?? {}));
      const manual = (raw.manualVideoBlockIds as unknown[]).filter(
        (v): v is string => typeof v === "string" && pinned.has(v),
      );
      if (manual.length > 0) sanitizedUsedAssets.manualVideoBlockIds = manual;
    }

    if (typeof raw.audioAssetId === "string") {
      const found = await prisma.mediaAsset.findUnique({ where: { id: raw.audioAssetId }, select: { id: true } });
      if (found) sanitizedUsedAssets.audioAssetId = raw.audioAssetId;
    }

    if (typeof raw.dataEntryId === "string") {
      const found = await prisma.dataEntry.findUnique({ where: { id: raw.dataEntryId }, select: { id: true } });
      if (found) sanitizedUsedAssets.dataEntryId = raw.dataEntryId;
    }

    if (Array.isArray(raw.setSequencedLibraryIds)) {
      const ids = (raw.setSequencedLibraryIds as unknown[]).filter((v): v is string => typeof v === "string");
      if (ids.length > 0) {
        const found = await prisma.mediaLibrary.findMany({ where: { id: { in: ids } }, select: { id: true } });
        const validIds = new Set(found.map((l) => l.id));
        sanitizedUsedAssets.setSequencedLibraryIds = ids.filter((id) => validIds.has(id));
      }
    }

    if (raw.usedSetTagByLibrary && typeof raw.usedSetTagByLibrary === "object" && !Array.isArray(raw.usedSetTagByLibrary)) {
      const map = raw.usedSetTagByLibrary as Record<string, unknown>;
      const sanitized = Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      if (Object.keys(sanitized).length > 0) sanitizedUsedAssets.usedSetTagByLibrary = sanitized;
    }
  }

  let validatedAccountId: string | undefined;
  if (typeof accountId === "string" && accountId) {
    const account = await prisma.instagramAccount.findUnique({ where: { id: accountId }, select: { id: true } });
    if (account) validatedAccountId = account.id;
  }

  // ── A.9 (P5 hardening) + Phase 4 minDuration validation ──────────────────
  if (sanitizedUsedAssets.videoAssets || sanitizedUsedAssets.audioAssetId) {
    const templateRow = await prisma.template.findUnique({ where: { id: templateId }, select: { jsonData: true } });
    let tplJson: TemplateShapeForValidation | null = null;
    if (templateRow?.jsonData) {
      try {
        tplJson = JSON.parse(templateRow.jsonData) as TemplateShapeForValidation;
      } catch {
        console.warn(`[renderLaunchService] template=${templateId} jsonData illisible — validation des assets ignorée.`);
      }
    }
    if (tplJson) {
      const blocks = tplJson.blocks ?? [];
      const videoSequenceSlots = tplJson.videoSequence ?? [];

      const expectedLibraryIdByBlockKey: Record<string, string> = {};
      const blockNameByKey: Record<string, string> = {};
      for (const block of blocks) {
        if (block.type === "video" && block.libraryId) {
          expectedLibraryIdByBlockKey[block.id] = block.libraryId;
          blockNameByKey[block.id] = block.name ?? block.id;
        }
      }
      for (const slot of videoSequenceSlots) {
        if (slot.libraryId) {
          expectedLibraryIdByBlockKey[slot.id] = slot.libraryId;
          blockNameByKey[slot.id] = slot.label ?? slot.binding ?? slot.id;
        }
      }
      const musicBlock = blocks.find((b) => b.type === "music");

      const chosenAssetIds = Array.from(
        new Set([
          ...(sanitizedUsedAssets.videoAssets ? Object.values(sanitizedUsedAssets.videoAssets) : []),
          ...(sanitizedUsedAssets.audioAssetId ? [sanitizedUsedAssets.audioAssetId] : []),
        ]),
      );
      const chosenAssetRows = chosenAssetIds.length > 0
        ? await prisma.mediaAsset.findMany({
            where: { id: { in: chosenAssetIds } },
            select: {
              id: true,
              libraryId: true,
              disabled: true,
              duration: true,
              filename: true,
              accesses: { select: { accountId: true } },
            },
          })
        : [];
      const chosenAssetRowById = new Map(chosenAssetRows.map((a) => [a.id, a]));

      for (const [blockKey, chosenAssetId] of Object.entries(sanitizedUsedAssets.videoAssets ?? {})) {
        const row = chosenAssetRowById.get(chosenAssetId);
        const validationError = validateManualAssetSelection(
          row
            ? { id: row.id, libraryId: row.libraryId, disabled: row.disabled, accessAccountIds: row.accesses.map((a) => a.accountId) }
            : undefined,
          expectedLibraryIdByBlockKey[blockKey],
          validatedAccountId,
        );
        if (validationError) {
          throw new ValidationError(`Vidéo "${blockNameByKey[blockKey] ?? blockKey}" : ${validationError}`);
        }
      }
      if (sanitizedUsedAssets.audioAssetId) {
        const row = chosenAssetRowById.get(sanitizedUsedAssets.audioAssetId);
        const validationError = validateManualAssetSelection(
          row
            ? { id: row.id, libraryId: row.libraryId, disabled: row.disabled, accessAccountIds: row.accesses.map((a) => a.accountId) }
            : undefined,
          musicBlock?.libraryId,
          validatedAccountId,
        );
        if (validationError) {
          throw new ValidationError(`Musique "${musicBlock?.name ?? "piste audio"}" : ${validationError}`);
        }
      }

      for (const block of blocks) {
        if (block.type === "video" && block.minDuration != null && block.minDuration > 0 && block.libraryId) {
          const chosenAssetId = sanitizedUsedAssets.videoAssets?.[block.id];
          if (chosenAssetId) {
            const assetRow = chosenAssetRowById.get(chosenAssetId);
            if (assetRow?.duration == null) {
              throw new ValidationError(
                `Vidéo "${block.name ?? block.id}" : durée de l'asset "${assetRow?.filename ?? chosenAssetId}" inconnue — re-uploadez le fichier ou lancez un backfill duration (admin).`,
              );
            }
            if (assetRow.duration < block.minDuration) {
              throw new ValidationError(
                `Vidéo "${block.name ?? block.id}" : durée insuffisante (${assetRow.duration}s disponibles, ${block.minDuration}s requis)`,
              );
            }
          }
        }
      }

      const musicBlockWithMinDuration = blocks.find((b) => b.type === "music" && b.minDuration != null && b.minDuration > 0);
      if (musicBlockWithMinDuration && sanitizedUsedAssets.audioAssetId) {
        const assetRow = chosenAssetRowById.get(sanitizedUsedAssets.audioAssetId);
        if (assetRow?.duration == null) {
          throw new ValidationError(
            `Musique "${musicBlockWithMinDuration.name ?? "piste audio"}" : durée de "${assetRow?.filename ?? sanitizedUsedAssets.audioAssetId}" inconnue — re-uploadez le fichier ou lancez un backfill duration (admin).`,
          );
        }
        if (assetRow.duration < musicBlockWithMinDuration.minDuration!) {
          throw new ValidationError(
            `Musique "${musicBlockWithMinDuration.name ?? "piste audio"}" : durée insuffisante (${assetRow.duration}s disponibles, ${musicBlockWithMinDuration.minDuration}s requis)`,
          );
        }
      }
    }
  }

  // ── Dérivation serveur de setSequencedLibraryIds / usedSetTagByLibrary ───
  let chosenAssetIdsForClaim: string[] = [];
  if (sanitizedUsedAssets.videoAssets && Object.keys(sanitizedUsedAssets.videoAssets).length > 0) {
    chosenAssetIdsForClaim = Array.from(new Set(Object.values(sanitizedUsedAssets.videoAssets)));

    const chosenAssetLibs = await prisma.mediaAsset.findMany({
      where: { id: { in: chosenAssetIdsForClaim } },
      select: { id: true, libraryId: true, setTag: true, library: { select: { rotationMode: true } } },
    });
    const derivedSequencedLibraryIds = Array.from(
      new Set(chosenAssetLibs.filter((a) => a.library.rotationMode !== "none").map((a) => a.libraryId)),
    );
    if (derivedSequencedLibraryIds.length > 0) {
      sanitizedUsedAssets.setSequencedLibraryIds = Array.from(
        new Set([...(sanitizedUsedAssets.setSequencedLibraryIds ?? []), ...derivedSequencedLibraryIds]),
      );
      const derivedSetTag: Record<string, string> = { ...(sanitizedUsedAssets.usedSetTagByLibrary ?? {}) };
      const sequencedSet = new Set(derivedSequencedLibraryIds);
      for (const asset of chosenAssetLibs) {
        if (!sequencedSet.has(asset.libraryId)) continue;
        if (asset.setTag) derivedSetTag[asset.libraryId] = asset.setTag;
      }
      if (Object.keys(derivedSetTag).length > 0) {
        sanitizedUsedAssets.usedSetTagByLibrary = derivedSetTag;
      }
    }
  }

  // ── Garde rotation per_account sans compte ────────────────────────────────
  if (!validatedAccountId && sanitizedUsedAssets?.setSequencedLibraryIds?.length) {
    const perAccountLibs = await prisma.mediaLibrary.count({
      where: { id: { in: sanitizedUsedAssets.setSequencedLibraryIds }, rotationScope: { not: "shared" } },
    });
    if (perAccountLibs > 0) {
      console.error(
        `[renderLaunchService] refus : ${perAccountLibs} bibliothèque(s) en rotation par compte mais aucun accountId (template=${templateId}).`,
      );
      throw new ValidationError(
        "Un compte Instagram est requis : ce template consomme une bibliothèque dont la rotation est propre à chaque compte.",
      );
    }
  }

  // ── Garde in-flight du slot (avec récupération d'orphelins) — le slot
  // lui-même a déjà été vérifié existant par `preflightCreateAndStartRender`,
  // hors verrou.
  if (validatedSlotId) {
    const inFlight = await findInFlightRender(validatedSlotId);
    if (inFlight) {
      throw new RenderInFlightError({ renderId: inFlight.id, status: inFlight.status });
    }
  }

  // ── Claims d'usage + création du Render — UN SEUL try (étape 2, fix C3
  // élargi) : sur n'importe quelle exception (claim vidéo, lookup/claim audio,
  // lookup/claim data, ou l'insert lui-même), on reverte ce qui a déjà été
  // posé avant de rethrow. Avant ce fix, un throw pendant le claim audio ou
  // data laissait fuiter les claims média déjà posés.
  let render: CreatedRender;
  try {
    if (chosenAssetIdsForClaim.length > 0) {
      const claim = await advanceMediaUsageOnSubmit(chosenAssetIdsForClaim, validatedAccountId);
      if (claim.prevMediaUsageStates.length > 0) sanitizedUsedAssets.prevMediaUsageStates = claim.prevMediaUsageStates;
    }
    if (sanitizedUsedAssets.audioAssetId && validatedAccountId) {
      const audioAsset = await prisma.mediaAsset.findUnique({
        where: { id: sanitizedUsedAssets.audioAssetId },
        select: { libraryId: true },
      });
      if (audioAsset?.libraryId) {
        const audioAdvance = await advanceAudioUsageOnSubmit(sanitizedUsedAssets.audioAssetId, validatedAccountId, audioAsset.libraryId);
        if (audioAdvance) sanitizedUsedAssets.prevAudioUsageState = audioAdvance.prevAudioUsageState;
      }
    }
    if (sanitizedUsedAssets.dataEntryId) {
      const dataClaim = await advanceDataUsageOnSubmit(sanitizedUsedAssets.dataEntryId, validatedAccountId ?? undefined);
      if (dataClaim) sanitizedUsedAssets.prevDataUsageState = dataClaim.prevDataUsageState;
    }

    render = await prisma.render.create({
      data: {
        templateId,
        listingId,
        status: "PENDING",
        usedAssets: JSON.stringify(sanitizedUsedAssets),
        ...(validatedAccountId ? { accountId: validatedAccountId } : {}),
        ...(validatedSlotId ? { publicationSlotId: validatedSlotId } : {}),
      },
    });
  } catch (err) {
    await revertAdvancesOnFailure(sanitizedUsedAssets);
    throw err;
  }

  // ── Kickoff — étape 2 : si startRenderGeneration LÈVE (pas juste "missing"),
  // le Render passe en ERROR et les claims sont revertés avant de rethrow.
  // Avant ce fix, une exception ici laissait le Render PENDING pour toujours
  // et le slot bloqué en 409 (findInFlightRender ne le voyait jamais expirer
  // puisqu'aucun heartbeat/runpodJobId n'entrait en jeu avant un redémarrage).
  let kickoff: Awaited<ReturnType<typeof startRenderGeneration>>;
  try {
    kickoff = await startRenderGeneration(render.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur au démarrage du rendu";
    await prisma.render.update({
      where: { id: render.id },
      data: {
        status: "ERROR",
        stage: RENDER_STAGE.ERROR,
        statusDetail: message,
        errorMsg: message,
        progress: 1,
        finishedAt: new Date(),
      },
    }).catch((updateErr) => {
      console.error(`[renderLaunchService] échec de la mise à jour ERROR après kickoff throw pour render=${render.id}:`, updateErr);
    });
    await revertAdvancesOnFailure(sanitizedUsedAssets);
    throw err;
  }

  if (kickoff === "missing") {
    await revertAdvancesOnFailure(sanitizedUsedAssets);
    await prisma.render.delete({ where: { id: render.id } }).catch(() => {});
    throw new Error("Render introuvable après création");
  }

  // Auto-transition pipeline UNIQUEMENT après confirmation kickoff OK. Best-effort.
  if (validatedSlotId) {
    await applyAutoTransitionFromPipeline(prisma, validatedSlotId, "RENDER_STARTED");
  }

  return render;
}

/**
 * Lance un rendu — tout ce que faisait `POST /api/renders` (accès, sanitize,
 * claims, création, kickoff, auto-transition), plus les correctifs de
 * robustesse de l'étape 2.
 *
 * La préflight (autorisation) tourne TOUJOURS avant toute prise de verrou —
 * un appelant qui échoue hasTool / templateAccess / propriété du listing n'a
 * donc jamais tenu le verrou d'un slot (findings slot-lock-before-authz /
 * render-lock-before-authz). Quand `input.publicationSlotId` correspond à un
 * slot existant et que l'appelant ne détient pas déjà le verrou
 * (`opts.lockHeld`), la section verrouillée tourne sous `withSlotRenderLock`
 * — deux appels AUTORISÉS concurrents sur le même slot ne peuvent donc
 * produire qu'un seul Render (le second lève `RenderInFlightError`
 * immédiatement, avant même de créer un listing). `opts.lockHeld` (lot,
 * `bulkRenderService.ts`) : l'appelant détient déjà ce verrou — la préflight
 * tourne quand même, simplement sans en reprendre un second (comme avant ce
 * fix).
 */
export async function createAndStartRender(
  input: RenderRequestBody,
  ctx: UserContext,
  opts?: { lockHeld?: boolean },
): Promise<CreatedRender> {
  const preflight = await preflightCreateAndStartRender(input, ctx);
  if (preflight.validatedSlotId && !opts?.lockHeld) {
    return withSlotRenderLock(preflight.validatedSlotId, () => createAndStartRenderLocked(input, ctx, preflight));
  }
  return createAndStartRenderLocked(input, ctx, preflight);
}

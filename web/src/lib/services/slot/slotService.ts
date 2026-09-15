/**
 * Service slot — création, lecture, modification, suppression de PublicationSlot.
 *
 * Pattern :
 * - Une fonction nommée par opération métier (createSlot, patchSlot, ...).
 * - Throw `ServiceError` sur erreur métier (route mappe vers HTTP via `mapServiceError`).
 * - Les routes restent responsables du parsing body, de l'auth basique, du mapping HTTP.
 *
 * Voir `web/src/lib/services/README.md` pour la convention complète.
 */

import { PUBLISH_TIME_RE } from "@/lib/publications/patternEnums";
import { localInputToIso, parisDayKey } from "@/lib/date/formatFr";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { UserContext } from "@/lib/userContext";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceError,
  ValidationError,
} from "@/lib/services/_runtime/errors";
import { TERMINAL_STATUSES, type SlotStatus } from "@/types/roles";
import {
  ALLOWED_PATCH_FIELDS_BY_ROLE,
  canCancelSlot,
  canUserAccessSlot,
  isValidSlotStatus,
  whereClauseForUser,
} from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";
import {
  canTransition,
  syncSlotsPipelineStatuses,
} from "@/lib/services/slot/transitions";
// REEL_* : mêmes règles que la création d'un reel et que markEntityShot.
import {
  BULK_PUBLISHABLE_STATUSES,
  REEL_ATTACHABLE_SOURCES,
  REEL_STATUSES_BUMPED_ON_SHOT,
} from "@/lib/publications/constants";
import {
  resolveSlotEffectivePattern,
  slotEffectivePatternSelect,
  type SlotEffectivePattern,
} from "@/lib/services/slot/effectivePattern";
import { requiredEntityTypeId } from "@/lib/publications/entityRequirement";
import { resolveCaptionWithDataLibrary } from "@/lib/publications/captionDataLibrary";
import { claimDataEntryForCaption } from "@/lib/contentLibraryResolver";
import { mapSourceToInitialStatus } from "@/lib/calendarEngine";
import { deleteR2Prefix, r2Configured } from "@/lib/r2";
import { safeJSON } from "@/lib/utils/json";
import { normalizeCustomFields } from "@/lib/customFields";

// ─── Types I/O ────────────────────────────────────────────────────────────────

export interface CreateSlotInput {
  /**
   * Compte Instagram cible. Optionnel (Missions) : null = production « stock »
   * pilotée uniquement par une recette globale (patternTemplateId requis alors).
   */
  accountId?: string | null;
  /** Date/heure de publication. Optionnel : absente = mission en banque (sans date). */
  scheduledAt?: string | null;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  templateId?: string | null;
  fields?: Record<string, string>;
  /**
   * Missions — Recette GLOBALE (PatternTemplate) appliquée directement au slot,
   * sans binding ni compte. Requis quand accountId est absent. La config
   * effective est résolue via resolveSlotEffectivePattern (branche patternTemplate).
   */
  patternTemplateId?: string | null;
  /**
   * Fiche (Entity) source de données référencée par la mission — Phase 5
   * métaobjet. La clé API garde son nom historique `propertyId` (tous les
   * clients l'envoient) mais la valeur est un id d'Entity ; écrit
   * `slot.entityId`. Les valeurs de la fiche sont résolues LIVE à la
   * génération (base) ; slot.fields reste la couche override.
   */
  propertyId?: string | null;
  /**
   * Identifiant d'un PatternBinding (recette appliquée au compte).
   * Source canonique pour identifier la recette. Si fourni, les assignees
   * sont préfilés depuis le binding.
   */
  patternBindingId?: string | null;
  /** Override admin : les valeurs fournies priment sur le préfill pattern. */
  assigneeMonteurId?: string | null;
  assigneeCmId?: string | null;
  assigneeVideasteId?: string | null;
  // ── Phase 6 : overrides one-off (booleans/strings ou null pour hériter du pattern) ──
  /** "none" | "auto" | "manual". null = hérite de la recette. */
  needsCaptionsModeOverride?: string | null;
  needsDescriptionOverride?: string | null;
  needsRushesOverride?: boolean | null;
  needsBriefOverride?: boolean | null;
  coverModeOverride?: string | null;
  // ── Phase 2 (Cohérence Rôles) : pickers preset/prompt one-off ──
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
  /**
   * Fiche tournage (Entity de type team, ex-ShootEvent) — Phase 5 métaobjet.
   * Clé API historique `eventId`, valeur = id d'Entity ; écrit
   * `slot.shootEntityId`. Le reel hérite du compte de la fiche (forcé), et par
   * défaut de sa fiche liée (relatedEntityId → entityId) + de ses assignés.
   * Statut initial selon l'état du tournage (SHOT/DONE → IN_EDIT, sinon
   * PLANNED bumpé plus tard).
   */
  eventId?: string | null;
  /** Bon de commande d'origine — posé par orderService à l'instanciation. */
  orderId?: string | null;
}

// ─── Helpers privés ───────────────────────────────────────────────────────────

// safeJSON déplacé dans lib/utils/json.ts pour éviter la duplication avec
// publications/[id]/route.ts (cf. W3.5).

/**
 * Vérifie qu'un user assignee existe ET a le rôle attendu. Partagé par
 * `createSlot` et `patchSlot` pour garantir la même règle des deux côtés
 * (sinon on peut créer un slot avec un CM en `assigneeMonteurId` mais ne pas
 * pouvoir le re-PATCH — asymétrie repérée par le scan-repo 2026-05-28).
 *
 * ADMIN passe toujours (un admin peut endosser n'importe quel rôle d'assignee).
 */
export async function assertAssigneeRole(
  userId: string,
  expectedRoles: readonly string[],
  fieldLabel: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || !expectedRoles.includes(user.role ?? "")) {
    throw new ValidationError(`${fieldLabel} : utilisateur invalide ou rôle incorrect`);
  }
}

/**
 * Une fiche en attente de validation admin (ou refusée par un admin) ne peut
 * pas produire de publications — c'est la porte du workflow bon de commande
 * (une fiche client non validée reste inerte). PENDING_CLIENT et
 * REJECTED_CLIENT ne bloquent PAS : la validation client est informative
 * (dans les deux issues), le pipeline interne continue.
 */
export function assertEntityValidated(
  validationStatus: string | null,
  subjectLabel: string,
): void {
  if (validationStatus === "PENDING_ADMIN") {
    throw new ValidationError(`${subjectLabel} est en attente de validation admin`);
  }
  if (validationStatus === "REJECTED") {
    throw new ValidationError(`${subjectLabel} a été refusée — corrigez-la puis validez-la`);
  }
}

// ─── createSlot ───────────────────────────────────────────────────────────────

/**
 * Crée un PublicationSlot manuel (admin uniquement).
 *
 * Étapes :
 *  1. Auth : seul un ADMIN réel (canAdminBypass) peut créer. L'impersonation
 *     ne donne pas les droits admin.
 *  2. Résolution pattern → préfill assignees (l'override admin prime).
 *  3. Validation : accountId/scheduledAt requis, account existe, date valide.
 *  4. Validation assignees : les Users référencés doivent exister.
 *  5. Création + retour du slot avec fields/fieldSchema déjà parsés.
 *
 * Throw :
 *  - `ForbiddenError` si l'appelant n'est pas ADMIN réel (sauf opts.requireAdmin=false).
 *  - `ValidationError` si données invalides ou références manquantes.
 *  - `NotFoundError` si le compte Instagram cible n'existe pas.
 *
 * @param opts.requireAdmin  Défaut true (création calendrier = admin-only). La
 *   route Missions passe `false` APRÈS avoir autorisé via l'outil `mission`
 *   (hasTool) — l'autorisation est faite en amont, le garde admin serait un
 *   doublon incorrect (une CM avec l'outil mission doit pouvoir créer).
 */
export async function createSlot(
  input: CreateSlotInput,
  ctx: UserContext,
  opts: { requireAdmin?: boolean } = {},
) {
  // POST réservé aux admins par défaut — l'impersonation ne donne pas canAdminBypass.
  // La route Missions autorise en amont via l'outil et passe requireAdmin=false.
  const requireAdmin = opts.requireAdmin ?? true;
  if (requireAdmin && !ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  // Fiche tournage (Entity, ex-ShootEvent) — Phase 5. On charge la fiche en
  // amont pour FORCER le compte du reel (= compte du tournage) et dériver les
  // défauts (fiche liée + assignés + statut initial). Doit précéder le guard
  // accountId/patternTemplateId ci-dessous pour que le compte soit résolu.
  let shootEvent: {
    id: string;
    accountId: string | null;
    relatedEntityId: string | null;
    status: string | null;
    validationStatus: string | null;
    assigneeVideasteId: string | null;
    defaultAssigneeMonteurId: string | null;
    defaultAssigneeCmId: string | null;
    fields: string | null;
    /** Bien lié au tournage — source de repli pour la légende. */
    related: { fields: string | null } | null;
  } | null = null;
  if (input.eventId) {
    shootEvent = await prisma.entity.findUnique({
      where: { id: input.eventId },
      select: {
        id: true,
        accountId: true,
        relatedEntityId: true,
        status: true,
        validationStatus: true,
        assigneeVideasteId: true,
        defaultAssigneeMonteurId: true,
        defaultAssigneeCmId: true,
        // Légende « Pré-remplie (modèle) » : fiche < tournage < bien du
        // tournage (même précédence que le pré-remplissage de génération).
        fields: true,
        // Le bien du tournage comble les trous de la légende même quand il
        // n'est PAS recopié sur le slot (propertyId explicite différent).
        related: { select: { fields: true } },
      },
    });
    if (!shootEvent) throw new NotFoundError("Tournage");
    assertEntityValidated(shootEvent.validationStatus, "Cette fiche tournage");
    // Le compte du reel est TOUJOURS celui du tournage (quand il en a un).
    if (shootEvent.accountId) input.accountId = shootEvent.accountId;
    // Fiche liée : défaut = celle du tournage (un input explicite prime).
    if (!input.propertyId && shootEvent.relatedEntityId) {
      input.propertyId = shootEvent.relatedEntityId;
    }
  }

  // Le compte est optionnel. Une publication sans compte est une production
  // « stock » : elle DOIT alors être pilotée par une recette globale
  // (patternTemplateId). La date reste optionnelle (publication en banque).
  if (!input.accountId && !input.patternTemplateId) {
    throw new ValidationError(
      "Un compte Instagram OU une recette est requis pour créer une publication",
    );
  }

  // Fiche (Entity) : si fournie, elle doit exister et ne pas être archivée.
  // Validé en amont pour renvoyer une erreur propre (404/400) plutôt qu'une
  // contrainte FK Prisma (500), et pour que le guard requiresEntityTypeId
  // repose sur une fiche réelle. Champs capturés ici pour un éventuel
  // pré-remplissage de la légende (mode preFilled) sans re-query plus bas.
  let propertyFields: string | null = null;
  let resolvedEntityTypeId: string | null = null;
  if (input.propertyId) {
    const entity = await prisma.entity.findUnique({
      where: { id: input.propertyId },
      select: { id: true, typeId: true, isArchived: true, fields: true, validationStatus: true },
    });
    if (!entity) throw new NotFoundError("Fiche");
    if (entity.isArchived) throw new ValidationError("Cette fiche est archivée");
    assertEntityValidated(entity.validationStatus, "Cette fiche");
    propertyFields = entity.fields;
    resolvedEntityTypeId = entity.typeId;
  }

  // Résolution pattern → préfill des assignees (l'override admin du body prime).
  let resolvedAssigneeMonteurId: string | null = input.assigneeMonteurId ?? null;
  let resolvedAssigneeCmId: string | null = input.assigneeCmId ?? null;
  let resolvedAssigneeVideasteId: string | null = input.assigneeVideasteId ?? null;

  // Événement : ses assignés par défaut priment sur les défauts de la recette
  // (binding), mais pas sur un override explicite du body. Le vidéaste du reel
  // = celui qui a shooté l'événement (traçabilité).
  if (shootEvent) {
    resolvedAssigneeMonteurId ??= shootEvent.defaultAssigneeMonteurId;
    resolvedAssigneeCmId ??= shootEvent.defaultAssigneeCmId;
    resolvedAssigneeVideasteId ??= shootEvent.assigneeVideasteId;
  }

  // Status initial : si un pattern est fourni, dérive de pattern.source
  // (cohérence avec calendarEngine.generateCalendarSlots). Sinon DRAFT.
  let initialStatus: string = "DRAFT";

  // Titre par défaut = label de la recette quand l'admin n'en saisit pas.
  let patternLabel: string | null = null;

  // Type canonique (superset produit par resolveSlotEffectivePattern) plutôt
  // qu'une redéclaration champ-à-champ — cf. les deux branches ci-dessous.
  let resolvedPattern: SlotEffectivePattern | null = null;

  // Missions — si une recette GLOBALE (patternTemplateId) est fournie AVEC un
  // compte, et qu'un binding existe pour (compte, recette), on l'utilise : la
  // mission hérite alors de TOUTE la config du compte — overrides ET assignés
  // par défaut (monteur / cm / vidéaste). Sans compte ni binding correspondant,
  // on reste sur la recette globale brute (pas d'assignés par défaut : ils
  // vivent au niveau du binding, per-compte, pas sur le PatternTemplate global).
  let effectiveBindingId: string | null = input.patternBindingId ?? null;
  if (!effectiveBindingId && input.patternTemplateId && input.accountId) {
    const accountBinding = await prisma.patternBinding.findFirst({
      where: {
        accountId: input.accountId,
        patternTemplateId: input.patternTemplateId,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (accountBinding) effectiveBindingId = accountBinding.id;
  }

  // Résolution du pattern via PatternBinding (canonique).
  const resolvedBindingId: string | null = effectiveBindingId;
  if (effectiveBindingId) {
    const binding = await prisma.patternBinding.findUnique({
      where: { id: effectiveBindingId },
      include: { patternTemplate: true },
    });
    if (!binding) {
      throw new ValidationError("Pattern introuvable");
    }
    if (binding.accountId !== input.accountId) {
      throw new ValidationError(
        "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
      );
    }
    const t = binding.patternTemplate;
    // Résolution partagée binding + overrides via le helper canonique (même
    // chemin que patchSlot). NB : le label prend désormais le customLabel du
    // binding s'il existe (cohérent avec toutes les surfaces d'affichage —
    // avant, le label brut du template fuyait ici).
    resolvedPattern = resolveSlotEffectivePattern({
      patternBinding: binding,
      patternTemplate: null,
    });
    patternLabel = resolvedPattern?.label ?? t.label;
    // Guard : si la recette exige une fiche (d'un type donné), bloquer la
    // création sans fiche conforme (couvre le calendrier / AddSlotModal).
    {
      const requiredTypeId = requiredEntityTypeId(resolvedPattern);
      if (requiredTypeId) {
        if (!input.propertyId) throw new ValidationError("Cette recette nécessite une fiche");
        if (resolvedEntityTypeId !== requiredTypeId) {
          throw new ValidationError("La fiche fournie n'est pas du type requis par la recette");
        }
      }
    }
    initialStatus = mapSourceToInitialStatus(t.source);
    if (!resolvedAssigneeMonteurId && binding.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = binding.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && binding.defaultAssigneeCmId) {
      resolvedAssigneeCmId = binding.defaultAssigneeCmId;
    }
    if (!resolvedAssigneeVideasteId && binding.defaultAssigneeVideasteId) {
      resolvedAssigneeVideasteId = binding.defaultAssigneeVideasteId;
    }
  } else if (input.patternTemplateId) {
    // Missions — recette GLOBALE directe (pas de binding, compte optionnel).
    // Aucun garde cross-account : une recette globale n'appartient à aucun compte.
    const template = await prisma.patternTemplate.findUnique({
      where: { id: input.patternTemplateId },
    });
    if (!template) {
      throw new ValidationError("Recette introuvable");
    }
    if (template.isArchived) {
      throw new ValidationError("Recette archivée : impossible de créer une publication dessus");
    }
    patternLabel = template.label;
    // Même helper canonique que la branche binding ci-dessus et patchSlot —
    // branche 2 de resolveSlotEffectivePattern (patternTemplate direct,
    // missions account-less).
    resolvedPattern = resolveSlotEffectivePattern({
      patternBinding: null,
      patternTemplate: template,
    });
    initialStatus = mapSourceToInitialStatus(template.source);
    // Guard : si la recette exige une fiche (d'un type donné), bloquer.
    {
      const requiredTypeId = requiredEntityTypeId(resolvedPattern);
      if (requiredTypeId) {
        if (!input.propertyId) throw new ValidationError("Cette recette nécessite une fiche");
        if (resolvedEntityTypeId !== requiredTypeId) {
          throw new ValidationError("La fiche fournie n'est pas du type requis par la recette");
        }
      }
    }
  }

  // Événement : le statut initial du reel dépend de l'état du TOURNAGE, pas de
  // pattern.source. Event SHOT/DONE (rushs déjà là) → montage démarre direct
  // (IN_EDIT). Event PLANNED → PLANNED, bumpé vers IN_EDIT quand l'événement
  // passe SHOT (markEventShot). Sans ce bump, un upload de version depuis
  // PLANNED ne transitionnerait pas (cf. computeAutoTransition).
  if (shootEvent) {
    initialStatus =
      shootEvent.status === "SHOT" || shootEvent.status === "DONE" ? "IN_EDIT" : "PLANNED";
  }

  // Compte cible (optionnel pour une mission). Validé seulement si fourni.
  if (input.accountId) {
    const account = await prisma.instagramAccount.findUnique({
      where: { id: input.accountId },
    });
    if (!account) {
      throw new NotFoundError("Compte");
    }
  }

  // Date (optionnelle : absente = mission en banque, sans date programmée).
  let parsedScheduledAt: Date | null = null;
  if (input.scheduledAt) {
    parsedScheduledAt = new Date(input.scheduledAt);
    if (isNaN(parsedScheduledAt.getTime())) {
      throw new ValidationError("scheduledAt invalide");
    }
  }

  // Validation existence + rôle des assignees référencés (parité avec patchSlot).
  if (resolvedAssigneeMonteurId) {
    await assertAssigneeRole(resolvedAssigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur assignee");
  }
  if (resolvedAssigneeCmId) {
    await assertAssigneeRole(resolvedAssigneeCmId, ["CM", "ADMIN"], "CM assignee");
  }
  if (resolvedAssigneeVideasteId) {
    await assertAssigneeRole(resolvedAssigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste assignee");
  }

  // Cross-field validation Phase 5 — parité avec patchSlot. Simule l'état
  // post-création (overrides ∪ pattern) pour vérifier la cohérence
  // toggles ↔ presets. Sans ces guards, un admin pouvait créer un slot
  // où needsCaptions=true mais sans aucun captionPresetId résolvable —
  // trigger-captions échouait plus tard de façon cryptique.
  const resolvedCaptionsMode =
    input.needsCaptionsModeOverride ?? resolvedPattern?.needsCaptionsMode ?? "none";
  const resolvedCaptionPresetId =
    input.captionPresetIdOverride ?? resolvedPattern?.captionPresetId ?? null;
  if (resolvedCaptionsMode === "auto" && !resolvedCaptionPresetId) {
    throw new ValidationError(
      "Sous-titres auto activés mais aucun preset captions défini (ni au slot, ni au pattern)",
    );
  }
  const resolvedNeedsDescription =
    input.needsDescriptionOverride ?? resolvedPattern?.needsDescription ?? "none";
  const resolvedDescriptionPromptId =
    input.descriptionPromptIdOverride ?? resolvedPattern?.descriptionPromptId ?? null;
  if (resolvedNeedsDescription === "autoGenerate" && !resolvedDescriptionPromptId) {
    throw new ValidationError(
      "Description auto activée mais aucun prompt IA défini (ni au slot, ni au pattern)",
    );
  }

  // Pré-remplissage de la légende « Pré-remplie (modèle) » — modèle
  // `descriptionFixedText` avec interpolation `{{clé}}` résolu contre les
  // champs de la fiche tournage / fiche data (+ éventuelle DataEntry tirée
  // depuis `descriptionDataLibraryId`, cf. `captionDataLibrary.ts`), ou alias
  // legacy `descriptionSourceFieldKey`. Copie one-shot à la création.
  // L'input.description explicite (rare à la création) reste prioritaire.
  let prefilledDescription: string | null = null;
  let prefilledCaptionEntry: { entryId: string; setTag: string | null; libraryId: string } | null = null;
  let prefilledCaptionDrewNew = false;
  if (!input.description) {
    const { caption, usedEntry, drewNewEntry } = await resolveCaptionWithDataLibrary({
      config: {
        needsDescription: resolvedNeedsDescription,
        descriptionFixedText: resolvedPattern?.descriptionFixedText ?? null,
        descriptionSourceFieldKey: resolvedPattern?.descriptionSourceFieldKey ?? null,
        descriptionDataLibraryId: resolvedPattern?.descriptionDataLibraryId ?? null,
        descriptionDataSetTag: resolvedPattern?.descriptionDataSetTag ?? null,
      },
      accountId: input.accountId,
      storedEntry: null,
      shootEntityFieldsJson: shootEvent?.fields ?? null,
      entityFieldsJson: propertyFields,
      shootRelatedFieldsJson: shootEvent?.related?.fields ?? null,
    });
    prefilledDescription = caption;
    if (usedEntry) {
      prefilledCaptionEntry = { entryId: usedEntry.entryId, setTag: usedEntry.setTag, libraryId: usedEntry.libraryId };
      prefilledCaptionDrewNew = drewNewEntry;
    }
  }

  // Guard cover-mode retiré (fix regression post-QW1) : le runtime
  // (lib/coverAuto.ts:761-767) a un fallback gracieux qui prend le preset
  // par défaut du template (sortOrder min) quand coverConfig n'a ni
  // coverPresetId ni coverPresetName. Bloquer ici empêchait la création
  // de slots valides où le pattern a coverMode="autoPack" sans preset
  // explicite dans coverConfig (le runtime se serait débrouillé). En cas
  // de template sans presets, coverAuto.ts log COVER_CONFIG_ERROR avec
  // un message clair pointant vers le builder — pas besoin de doubler la
  // validation ici.

  // Événement : le reel puise dans les rushs partagés du tournage → sa chaîne
  // démarre à « Montage » (needsRushesOverride=false), sauf override explicite.
  const effectiveNeedsRushesOverride =
    input.needsRushesOverride !== undefined
      ? input.needsRushesOverride
      : shootEvent
        ? false
        : undefined;

  // Dernier niveau de la cascade : l'équipe par défaut du compte, quand ni
  // l'appelant, ni la fiche, ni la recette n'ont renseigné un rôle. Même ordre
  // que `resolveDefaultAssignees` côté fiches — sans lui, une fiche héritée du
  // compte produirait des publications sans personne dessus.
  if (
    input.accountId &&
    (!resolvedAssigneeMonteurId || !resolvedAssigneeCmId || !resolvedAssigneeVideasteId)
  ) {
    const account = await prisma.instagramAccount.findUnique({
      where: { id: input.accountId },
      select: {
        defaultAssigneeVideasteId: true,
        defaultAssigneeMonteurId: true,
        defaultAssigneeCmId: true,
      },
    });
    if (account) {
      resolvedAssigneeMonteurId ??= account.defaultAssigneeMonteurId;
      resolvedAssigneeCmId ??= account.defaultAssigneeCmId;
      resolvedAssigneeVideasteId ??= account.defaultAssigneeVideasteId;
    }
  }

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId: input.accountId ?? null,
      // Phase 5 — fiche tournage (clé API `eventId`, colonne `shootEntityId`).
      shootEntityId: input.eventId ?? null,
      orderId: input.orderId ?? null,
      scheduledAt: parsedScheduledAt,
      // Fallback titre = nom de la recette si l'admin ne saisit rien.
      title: (input.title?.trim() || patternLabel) ?? null,
      description: input.description ?? prefilledDescription ?? null,
      notes: input.notes ?? null,
      // Status initial dérivé du pattern.source (cohérence calendarEngine).
      status: initialStatus,
      templateId: input.templateId ?? null,
      fields: input.fields ? JSON.stringify(input.fields) : "{}",
      // fieldSchema : la fiche porte la seule source de champs perso (via le
      // type). Le slot stocke toujours "[]" ; résolution live à la génération.
      fieldSchema: "[]",
      isAuto: false,
      patternBindingId: resolvedBindingId,
      // Si un binding a été résolu (mission avec compte → recette du compte), le
      // slot devient un slot binding normal ; on ne double pas avec le template.
      patternTemplateId: resolvedBindingId ? null : (input.patternTemplateId ?? null),
      // Phase 5 — fiche source de données (clé API `propertyId`, colonne `entityId`).
      entityId: input.propertyId ?? null,
      // Légende « Pré-remplie » — DataEntry tirée depuis la bibliothèque de
      // données de la recette (drewNewEntry seulement : aucune entrée
      // mémorisée à la création, une réutilisation n'a pas de sens ici).
      captionDataEntryId: prefilledCaptionDrewNew ? prefilledCaptionEntry!.entryId : null,
      assigneeMonteurId: resolvedAssigneeMonteurId,
      assigneeCmId: resolvedAssigneeCmId,
      assigneeVideasteId: resolvedAssigneeVideasteId,
      // Phase 6 — overrides one-off (uniquement si fournis dans le body)
      ...(input.needsCaptionsModeOverride !== undefined
        ? { needsCaptionsModeOverride: input.needsCaptionsModeOverride }
        : {}),
      ...(input.needsDescriptionOverride !== undefined
        ? { needsDescriptionOverride: input.needsDescriptionOverride }
        : {}),
      ...(effectiveNeedsRushesOverride !== undefined
        ? { needsRushesOverride: effectiveNeedsRushesOverride }
        : {}),
      ...(input.needsBriefOverride !== undefined
        ? { needsBriefOverride: input.needsBriefOverride }
        : {}),
      ...(input.coverModeOverride !== undefined
        ? { coverModeOverride: input.coverModeOverride }
        : {}),
      ...(input.captionPresetIdOverride !== undefined
        ? { captionPresetIdOverride: input.captionPresetIdOverride }
        : {}),
      ...(input.descriptionPromptIdOverride !== undefined
        ? { descriptionPromptIdOverride: input.descriptionPromptIdOverride }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true } },
    },
  });

  // Claim + audit best-effort, HORS create : le slot existe déjà et reste
  // correct même si le claim échoue (pas de revert, cf. claimDataEntryForCaption).
  if (prefilledCaptionDrewNew && prefilledCaptionEntry) {
    await claimDataEntryForCaption(prefilledCaptionEntry.entryId, input.accountId ?? null);
    await logActivity(prisma, {
      slotId: slot.id,
      actorId: ctx.actualUser.id,
      type: "DESCRIPTION_PREFILLED",
      payload: {
        trigger: "create",
        entryId: prefilledCaptionEntry.entryId,
        setTag: prefilledCaptionEntry.setTag,
        libraryId: prefilledCaptionEntry.libraryId,
        accountId: input.accountId ?? null,
      },
    });
  }

  return {
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: normalizeCustomFields(slot.fieldSchema),
    // Clé API `propertyId` = fiche liée (Entity) — cf. mapping de listSlots.
    propertyId: slot.entityId,
  };
}

// ─── bulkPatchSlots ──────────────────────────────────────────────────────────

export const BULK_PATCH_MIN = 1;
export const BULK_PATCH_MAX = 50;

export interface BulkPatchSlotsInput {
  /** IDs des slots à patcher. */
  slotIds: string[];
  /**
   * Patch commun à appliquer à tous les slots.
   * Seuls les champs `assigneeMonteurId`, `assigneeCmId`, `assigneeVideasteId`,
   * `scheduledAt` (ISO), `status` sont supportés.
   * Les valeurs absentes sont ignorées (pas de patch). Pour reset un champ
   * d'assignation, passer null explicitement.
   */
  patch: {
    assigneeMonteurId?: string | null;
    assigneeCmId?: string | null;
    assigneeVideasteId?: string | null;
    scheduledAt?: string | null;
    status?: string;
  };
}

/**
 * Sprint C — Applique un patch commun à N slots calendrier.
 *
 * Contraintes :
 *  - ADMIN uniquement (les autres rôles n'ont pas de cas d'usage bulk
 *    légitime — un monteur ne patch que ses propres slots un par un).
 *  - Vérification existence + scope des assignees référencés.
 *  - Vérification cross-account pour scheduledAt non concernée (la date est
 *    propre au slot).
 *  - Activity log par slot pour STATUS_CHANGED / ASSIGNEE_CHANGED.
 *  - Reuse de canTransition pour valider chaque changement de statut.
 */
export async function bulkPatchSlots(
  input: BulkPatchSlotsInput,
  ctx: UserContext,
): Promise<{ patchedCount: number; skippedCount: number }> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!Array.isArray(input.slotIds) || input.slotIds.length === 0) {
    throw new ValidationError("slotIds requis (au moins 1)");
  }
  if (
    input.slotIds.length < BULK_PATCH_MIN ||
    input.slotIds.length > BULK_PATCH_MAX
  ) {
    throw new ValidationError(
      `Entre ${BULK_PATCH_MIN} et ${BULK_PATCH_MAX} slots par opération`,
    );
  }
  const { patch } = input;
  const hasAnyPatch =
    patch.assigneeMonteurId !== undefined ||
    patch.assigneeCmId !== undefined ||
    patch.assigneeVideasteId !== undefined ||
    patch.scheduledAt !== undefined ||
    patch.status !== undefined;
  if (!hasAnyPatch) {
    throw new ValidationError("Aucun champ à patcher");
  }

  if (patch.status !== undefined && !isValidSlotStatus(patch.status)) {
    throw new ValidationError("Statut invalide");
  }
  // Même garde anti-bypass que patchSlot : passer PUBLISHED par ce chemin
  // court-circuiterait la pose de publishedAt et le log d'activité PUBLISHED.
  // Le bulk « marquer publié » a sa propre entrée : bulkMarkPublishedSlots.
  if (patch.status === "PUBLISHED") {
    throw new ForbiddenError(
      "Pour marquer des slots comme publiés, utilisez l'action « Marquer publié » — " +
        "elle enregistre aussi la date de publication et l'historique.",
    );
  }
  if (
    patch.scheduledAt !== undefined &&
    patch.scheduledAt !== null &&
    isNaN(new Date(patch.scheduledAt).getTime())
  ) {
    throw new ValidationError("scheduledAt invalide");
  }

  // Validation existence + rôle des assignees référencés.
  if (typeof patch.assigneeMonteurId === "string") {
    await assertAssigneeRole(
      patch.assigneeMonteurId,
      ["MONTEUR", "ADMIN"],
      "Monteur assignee",
    );
  }
  if (typeof patch.assigneeCmId === "string") {
    await assertAssigneeRole(
      patch.assigneeCmId,
      ["CM", "ADMIN"],
      "CM assignee",
    );
  }
  if (typeof patch.assigneeVideasteId === "string") {
    await assertAssigneeRole(
      patch.assigneeVideasteId,
      ["VIDEASTE", "ADMIN"],
      "Vidéaste assignee",
    );
  }

  // Charge l'état actuel des slots pour valider transitions + logguer.
  const slots = await prisma.publicationSlot.findMany({
    where: { id: { in: input.slotIds } },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });
  // Bug C.1 — IDs demandés mais absents en DB (supprimés ou jamais existé).
  // On les compte explicitement dans `skipped` pour ne pas mentir à l'admin :
  // "10 demandés, 7 patchés, 0 skippés" alors que 3 étaient introuvables.
  const missingCount = input.slotIds.length - slots.length;

  const data: Record<string, unknown> = {};
  if (patch.assigneeMonteurId !== undefined)
    data.assigneeMonteurId = patch.assigneeMonteurId;
  if (patch.assigneeCmId !== undefined) data.assigneeCmId = patch.assigneeCmId;
  if (patch.assigneeVideasteId !== undefined)
    data.assigneeVideasteId = patch.assigneeVideasteId;
  if (patch.scheduledAt !== undefined)
    data.scheduledAt =
      patch.scheduledAt === null ? null : new Date(patch.scheduledAt);
  if (patch.status !== undefined) data.status = patch.status;

  let patched = 0;
  let skipped = missingCount;

  // Transaction : update + activity log par slot.
  await prisma.$transaction(async (tx) => {
    for (const slot of slots) {
      // Si patch.status, vérifie la transition (ADMIN bypass dans canTransition).
      if (patch.status && patch.status !== slot.status) {
        if (!canTransition(slot.status, patch.status, "ADMIN")) {
          skipped += 1;
          continue;
        }
      }
      await tx.publicationSlot.update({
        where: { id: slot.id },
        data,
      });

      // Logs activity
      if (patch.status !== undefined && patch.status !== slot.status) {
        await logActivity(tx as typeof prisma, {
          slotId: slot.id,
          actorId,
          type: "STATUS_CHANGED",
          payload: { from: slot.status, to: patch.status, batch: true },
        });
      }
      const monteurChanged =
        patch.assigneeMonteurId !== undefined &&
        patch.assigneeMonteurId !== slot.assigneeMonteurId;
      const cmChanged =
        patch.assigneeCmId !== undefined &&
        patch.assigneeCmId !== slot.assigneeCmId;
      const videasteChanged =
        patch.assigneeVideasteId !== undefined &&
        patch.assigneeVideasteId !== slot.assigneeVideasteId;
      if (monteurChanged || cmChanged || videasteChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: slot.id,
          actorId,
          type: "ASSIGNEE_CHANGED",
          payload: {
            ...(monteurChanged
              ? {
                  monteur: {
                    from: slot.assigneeMonteurId,
                    to: patch.assigneeMonteurId ?? null,
                  },
                }
              : {}),
            ...(cmChanged
              ? {
                  cm: { from: slot.assigneeCmId, to: patch.assigneeCmId ?? null },
                }
              : {}),
            ...(videasteChanged
              ? {
                  videaste: {
                    from: slot.assigneeVideasteId,
                    to: patch.assigneeVideasteId ?? null,
                  },
                }
              : {}),
            batch: true,
          },
        });
      }
      patched += 1;
    }
  });

  return { patchedCount: patched, skippedCount: skipped };
}

// ─── bulkMarkPublishedSlots ──────────────────────────────────────────────────

export interface BulkMarkPublishedInput {
  slotIds: string[];
  /** Date de publication commune (ISO). Absente → maintenant. */
  publishedAt?: string | null;
}

/**
 * Marque N slots comme publiés depuis le calendrier.
 *
 * Pas de `publishedUrl` : l'URL Instagram est propre à chaque post, un lot ne
 * peut pas la fournir. Les slots sortent donc « publiés sans lien » — l'UI les
 * signale et le lien reste ajoutable depuis chaque fiche.
 *
 * Sont ignorés (comptés dans `skippedCount`, jamais une erreur) : les ids
 * introuvables, les slots sans `accountId` (missions stock — publier sur
 * Instagram suppose un compte, cf. la route unitaire) et ceux dont le statut
 * n'est pas dans BULK_PUBLISHABLE_STATUSES.
 */
export async function bulkMarkPublishedSlots(
  input: BulkMarkPublishedInput,
  ctx: UserContext,
): Promise<{ patchedCount: number; skippedCount: number }> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!Array.isArray(input.slotIds) || input.slotIds.length === 0) {
    throw new ValidationError("slotIds requis (au moins 1)");
  }
  if (
    input.slotIds.length < BULK_PATCH_MIN ||
    input.slotIds.length > BULK_PATCH_MAX
  ) {
    throw new ValidationError(
      `Entre ${BULK_PATCH_MIN} et ${BULK_PATCH_MAX} slots par opération`,
    );
  }

  let publishedAt = new Date();
  if (input.publishedAt !== undefined && input.publishedAt !== null) {
    const parsed = new Date(input.publishedAt);
    if (isNaN(parsed.getTime())) {
      throw new ValidationError("publishedAt invalide");
    }
    // Même fenêtre que la route unitaire.
    const minDate = new Date("2020-01-01T00:00:00Z");
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (parsed < minDate || parsed > maxDate) {
      throw new ValidationError("publishedAt hors fenêtre autorisée (2020 → +1 an)");
    }
    publishedAt = parsed;
  }

  const slots = await prisma.publicationSlot.findMany({
    where: { id: { in: input.slotIds } },
    select: { id: true, status: true, accountId: true },
  });

  let patched = 0;
  // Les ids introuvables comptent comme skippés pour ne pas mentir sur le total.
  let skipped = input.slotIds.length - slots.length;

  const eligible = slots.filter(
    (slot) => slot.accountId !== null && BULK_PUBLISHABLE_STATUSES.has(slot.status),
  );
  skipped += slots.length - eligible.length;

  if (eligible.length === 0) {
    return { patchedCount: 0, skippedCount: skipped };
  }

  await prisma.$transaction(async (tx) => {
    for (const slot of eligible) {
      await tx.publicationSlot.update({
        where: { id: slot.id },
        data: { status: "PUBLISHED", publishedAt },
      });
      await logActivity(tx as typeof prisma, {
        slotId: slot.id,
        actorId,
        type: "PUBLISHED",
        payload: { publishedAt: publishedAt.toISOString(), batch: true },
      });
      patched += 1;
    }
  });

  return { patchedCount: patched, skippedCount: skipped };
}

// ─── bulkScheduleSlots ───────────────────────────────────────────────────────

/** Bornes quantité d'un batch de programmation banque → calendrier. */
export const BULK_SCHEDULE_MIN = 1;
export const BULK_SCHEDULE_MAX = 50;

export interface BulkScheduleSlotsInput {
  /** IDs des slots banque (scheduledAt: null) à programmer. */
  slotIds: string[];
  /**
   * Date+heure ISO 8601 complète de départ (avec timezone offset ou suffixe Z).
   * Le client (BulkScheduleModal) convertit l'heure locale du navigateur en
   * ISO UTC pour éviter toute ambiguïté de fuseau côté serveur.
   */
  startDateTimeISO: string;
  /**
   * Si fourni, étale les slots sur N jours consécutifs depuis startDate
   * (jour i = startDate + i jours). Si non fourni, tous les slots reçoivent
   * la même date.
   */
  spreadOverDays?: number;
  /**
   * Si true, lit `binding.publishTime` pour chaque slot au lieu de garder
   * l'heure de `startDateTimeISO`. L'heure du binding est appliquée en UTC
   * (publishTime "10:00" → 10:00Z), cohérent avec le reste des heures naïves
   * du repo (cf. createSlot qui accepte également des ISO UTC).
   */
  useBindingTime?: boolean;
}


/**
 * Sprint B — Programme N slots banque vers le calendrier en une opération.
 *
 * Contraintes :
 *  - ADMIN uniquement.
 *  - Tous les slots doivent être en banque (scheduledAt: null) au moment de
 *    l'appel ; les slots déjà programmés sont skippés silencieusement.
 *  - startDateTimeISO doit être une ISO 8601 complète parsable.
 *  - spreadOverDays ∈ [1, slotIds.length] ou undefined.
 *
 * Émet un événement BANK_SLOT_SCHEDULED par slot dans l'activity log.
 */
export async function bulkScheduleSlots(
  input: BulkScheduleSlotsInput,
  ctx: UserContext,
): Promise<{ scheduledCount: number; skippedCount: number }> {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const actorId = ctx.actualUser.id;

  if (!Array.isArray(input.slotIds) || input.slotIds.length === 0) {
    throw new ValidationError("slotIds requis (au moins 1)");
  }
  if (
    input.slotIds.length < BULK_SCHEDULE_MIN ||
    input.slotIds.length > BULK_SCHEDULE_MAX
  ) {
    throw new ValidationError(
      `Entre ${BULK_SCHEDULE_MIN} et ${BULK_SCHEDULE_MAX} slots par opération`,
    );
  }
  const baseStart = new Date(input.startDateTimeISO);
  if (isNaN(baseStart.getTime())) {
    throw new ValidationError("startDateTimeISO invalide");
  }
  if (input.spreadOverDays !== undefined) {
    if (
      !Number.isInteger(input.spreadOverDays) ||
      input.spreadOverDays < 1 ||
      input.spreadOverDays > input.slotIds.length
    ) {
      throw new ValidationError(
        `spreadOverDays doit être entre 1 et ${input.slotIds.length}`,
      );
    }
  }

  // Charge les slots cibles + le binding pour récupérer publishTime si besoin.
  const slots = await prisma.publicationSlot.findMany({
    where: { id: { in: input.slotIds } },
    select: {
      id: true,
      scheduledAt: true,
      patternBinding: {
        select: { publishTime: true },
      },
    },
  });

  const targets = slots.filter((s) => s.scheduledAt === null);
  const skipped = slots.length - targets.length;
  if (targets.length === 0) {
    return { scheduledCount: 0, skippedCount: skipped };
  }

  // L'étalement se fait en millisecondes — déterministe quel que soit le fuseau
  // du serveur. L'HEURE de la recette, elle, est une heure de Paris (cf. plus bas).
  const oneDayMs = 24 * 60 * 60 * 1000;

  function computeScheduledAt(index: number, bindingPublishTime?: string): Date {
    const dayOffset =
      input.spreadOverDays !== undefined
        ? index % input.spreadOverDays
        : 0;
    const day = new Date(baseStart.getTime() + dayOffset * oneDayMs);
    if (input.useBindingTime && bindingPublishTime && PUBLISH_TIME_RE.test(bindingPublishTime)) {
      /**
       * `publishTime` est une heure de PARIS, pas UTC.
       *
       * `setUTCHours` posait « 18:00 » à 18:00 UTC, soit 20:00 affiché — toute
       * l'app rend en Europe/Paris. Même convention que `calendarEngine` et que
       * la création à l'unité : une publication doit tomber à l'heure annoncée,
       * quel que soit le chemin qui l'a créée et quelle que soit la saison.
       *
       * Passer par le jour civil PARIS règle en prime l'ajout de 24 h en
       * millisecondes à cheval sur un changement d'heure : le jour est le bon,
       * et l'heure est reposée telle qu'annoncée.
       */
      const [h, m] = bindingPublishTime.split(":").map(Number);
      const iso = localInputToIso(
        `${parisDayKey(day)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
      if (iso) return new Date(iso);
    }
    return day;
  }

  // Atomique : updates + activity logs dans une transaction.
  const scheduled = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const slot = targets[i];
      const scheduledAt = computeScheduledAt(i, slot.patternBinding?.publishTime);
      await tx.publicationSlot.update({
        where: { id: slot.id },
        data: { scheduledAt },
      });
      await logActivity(tx as typeof prisma, {
        slotId: slot.id,
        actorId,
        type: "BANK_SLOT_SCHEDULED",
        payload: { scheduledAt: scheduledAt.toISOString(), batch: true },
      });
      count += 1;
    }
    return count;
  });

  return { scheduledCount: scheduled, skippedCount: skipped };
}

// ─── patchSlot ────────────────────────────────────────────────────────────────

/**
 * Statuts terminaux réservés aux ADMIN uniquement.
 * MONTEUR/CM/VIDEASTE ne peuvent pas écrire ces valeurs via PATCH même si "status"
 * figure dans leur ALLOWED_PATCH_FIELDS_BY_ROLE. L'escalade vers PUBLISHED se fait
 * exclusivement via POST /api/publications/[id]/mark-published.
 */
const RESERVED_TERMINAL_STATUSES = ["PUBLISHED", "CANCELLED", "ARCHIVED"] as const;

/** Borne max pour les champs texte libres (DoS storage + XSS différé). */
const MAX_TEXT_FIELD = 5000;

/**
 * Met à jour un PublicationSlot existant.
 *
 * Étapes :
 *  1. Récupération + scoping rôle : 404 si slot inexistant OU non accessible
 *     selon le rôle (anti-énumération, comportement préservé).
 *  2. Filtrage du body via `ALLOWED_PATCH_FIELDS_BY_ROLE[role]` — champs non
 *     autorisés ignorés silencieusement (pas de 403 pour ne pas leaker l'info).
 *  3. Garde statuts terminaux réservés (PUBLISHED/CANCELLED/ARCHIVED/REJECTED).
 *  4. Validations : statut, scheduledAt, bornes texte, shape `fields`, assignees,
 *     cohérence cross-field Phase 5 (toggle ↔ preset).
 *  5. Sanitization : enlève les lignes `PUBLISHED_URL:` du champ notes pour les non-ADMIN.
 *  6. Update Prisma + logs d'activité (STATUS_CHANGED / ASSIGNEE_CHANGED).
 *
 * Throw :
 *  - `NotFoundError("Slot")` si inexistant ou pas accessible.
 *  - `ForbiddenError` si un non-admin essaie d'écrire un statut terminal réservé.
 *  - `ValidationError` sur toute violation de schéma / cohérence.
 *  - `ServiceError("INTERNAL", ..., 500)` si l'update Prisma lance (préserve le
 *    message d'erreur explicite pour le client UI, comportement de l'ancienne route).
 */
export async function patchSlot(
  id: string,
  rawBody: Record<string, unknown>,
  ctx: UserContext,
) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;
  // Fix bug audit 2026-05-30 (H2) : pendant impersonation, effectiveUser =
  // user impersonné, actualUser = admin réel. Les logs activity doivent
  // tracer l'admin réel (audit trail), pas l'user impersonné.
  // Cf. CLAUDE.md Phase 1.8 § "Décision par usage".
  const actorId = ctx.actualUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      accountId: true,
      // Banque : on a besoin du scheduledAt actuel pour détecter la transition
      // null → date (promotion depuis la banque vers le calendrier).
      scheduledAt: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      // Champs nécessaires pour la validation cross-field Phase 5
      needsCaptionsModeOverride: true,
      needsDescriptionOverride: true,
      captionPresetIdOverride: true,
      descriptionPromptIdOverride: true,
      coverModeOverride: true,
      // Légende « Pré-remplie (modèle) » : fiche tournage (fixe depuis la
      // création, jamais patchée) < fiche data — même précédence que
      // createSlot et le pré-remplissage de génération.
      shootEntity: { select: { fields: true, related: { select: { fields: true } } } },
      // DataEntry mémorisée (tirage précédent) — reuse au re-rattachement
      // (idempotent) plutôt que de retirer systématiquement.
      captionDataEntry: { select: { id: true, fields: true, setTag: true, libraryId: true } },
      // La résolution effective merge template + binding overrides côté code
      // (resolveSlotEffectivePattern, 3 branches : binding → patternTemplate
      // direct [missions account-less] → null — cf. plus bas).
      ...slotEffectivePatternSelect,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    throw new NotFoundError("Slot");
  }

  // Filtrage rôle : les champs non whitelistés sont ignorés silencieusement.
  const allowedFields = ALLOWED_PATCH_FIELDS_BY_ROLE[role];
  const body = Object.fromEntries(
    Object.entries(rawBody).filter(([key]) => allowedFields.includes(key)),
  );

  const {
    status,
    title,
    description,
    templateId,
    propertyId,
    scheduledAt,
    fields,
    fieldSchema,
    assigneeMonteurId,
    assigneeCmId,
    assigneeVideasteId,
    patternBindingId,
    currentVersionId,
    isAuto,
    needsAdminValidationOverride,
    needsClientValidationOverride,
    allowsClientRevisionOverride,
    needsCaptionsModeOverride,
    needsDescriptionOverride,
    needsRushesOverride,
    needsBriefOverride,
    coverModeOverride,
    captionPresetIdOverride,
    descriptionPromptIdOverride,
  } = body as Record<string, unknown>;
  // notes mutable car sanitisé avant l'update (H2).
  let { notes } = body as Record<string, unknown>;

  // H1 — Statuts terminaux réservés (PUBLISHED/CANCELLED/ARCHIVED/REJECTED) :
  // l'escalade se fait exclusivement via POST mark-published.
  if (
    typeof status === "string" &&
    (RESERVED_TERMINAL_STATUSES as readonly string[]).includes(status) &&
    role !== "ADMIN"
  ) {
    throw new ForbiddenError(
      "Ce statut est réservé. Utilisez /mark-published ou contactez un admin.",
    );
  }

  if (status !== undefined && !isValidSlotStatus(status)) {
    throw new ValidationError("Statut invalide.");
  }

  // Garde anti-bypass : un ADMIN peut techniquement PATCH status="PUBLISHED"
  // depuis le SlotDetailPanel (matrice STATUS_TRANSITIONS l'autorise), mais
  // cela court-circuiterait /mark-published qui pose publishedAt + l'activité
  // PUBLISHED (et publishedUrl quand le lien est fourni). Sans publishedAt ni
  // activité, la publication n'est pas traçable et la worklist CM ne se met pas
  // à jour cohéremment. Forcer le passage par /mark-published, même pour l'ADMIN.
  //
  // NB : publier SANS lien est un cas légitime (ADMIN), mais il passe lui aussi
  // par /mark-published — ce n'est pas une raison de rouvrir ce chemin.
  if (status === "PUBLISHED") {
    throw new ForbiddenError(
      "Pour marquer un slot comme publié, utilisez l'action « Marquer publié » dans la fiche publication. " +
        "Cela enregistre aussi l'URL Instagram et la date de publication.",
    );
  }

  // Enforcement de la matrice STATUS_TRANSITIONS au niveau API.
  // Avant ce check : MONTEUR/CM pouvaient envoyer PATCH avec n'importe
  // quel statut hors RESERVED_TERMINAL_STATUSES, même sauter des étapes
  // (DRAFT → SCHEDULED, EDIT_REVIEW → READY_FOR_CM sans validation CM, etc.).
  // canTransition est déjà appliqué dans le select du SlotDetailPanel pour
  // afficher la liste, mais la matrice n'était pas enforced côté serveur.
  // ADMIN bypass total est dans canTransition lui-même.
  if (
    typeof status === "string" &&
    status !== slot.status &&
    !canTransition(slot.status, status, role)
  ) {
    throw new ForbiddenError(
      `Transition de statut interdite pour votre rôle : ${slot.status} → ${status}`,
    );
  }

  // scheduledAt accepte string (date programmée), null (remise en banque)
  // ou undefined (pas de changement). Toute autre valeur → erreur.
  if (
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt === "string" &&
    isNaN(new Date(scheduledAt).getTime())
  ) {
    throw new ValidationError("scheduledAt invalide");
  }
  if (
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt !== "string"
  ) {
    throw new ValidationError("scheduledAt doit être une chaîne ISO ou null");
  }
  // Defense-in-depth : remettre un slot en banque (scheduledAt: null) reste
  // une action d'orchestration admin, même si un futur changement de
  // ALLOWED_PATCH_FIELDS_BY_ROLE ouvrait ce champ à un autre rôle.
  if (scheduledAt === null && !ctx.canAdminBypass) {
    throw new ForbiddenError(
      "Seul un administrateur peut renvoyer un slot vers la banque.",
    );
  }

  // E3 — fix M4 mass-assignment : bornes sur les champs texte.
  for (const [name, value] of [
    ["title", title],
    ["description", description],
    ["notes", notes],
  ] as const) {
    if (typeof value === "string" && value.length > MAX_TEXT_FIELD) {
      throw new ValidationError(`Le champ ${name} dépasse ${MAX_TEXT_FIELD} caractères`);
    }
  }

  // Validation shape `fields` : Record<string, string> avec keys ≤100 chars
  // et values ≤MAX_TEXT_FIELD chars.
  if (fields !== undefined) {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
      throw new ValidationError("fields doit être un objet");
    }
    const fieldsObj = fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(fieldsObj)) {
      if (key.length > 100) {
        throw new ValidationError(`Clé fields trop longue (max 100): ${key.slice(0, 20)}…`);
      }
      if (typeof value !== "string" || value.length > MAX_TEXT_FIELD) {
        throw new ValidationError(
          `Valeur fields["${key}"] doit être string ≤${MAX_TEXT_FIELD} chars`,
        );
      }
    }
  }

  // H2 — Sanitization notes pour les non-ADMIN : on supprime toute ligne
  // "PUBLISHED_URL:" pour éviter l'injection de l'ancienne donnée hack.
  if (typeof notes === "string" && role !== "ADMIN") {
    notes = notes
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("PUBLISHED_URL:"))
      .join("\n");
  }

  // M2 — Validation existence + rôle des assignees (déjà filtré côté ADMIN par
  // ALLOWED_PATCH_FIELDS_BY_ROLE — seul ADMIN possède ces champs).
  if (typeof assigneeMonteurId === "string") {
    await assertAssigneeRole(assigneeMonteurId, ["MONTEUR", "ADMIN"], "Monteur assignee");
  }
  if (typeof assigneeCmId === "string") {
    await assertAssigneeRole(assigneeCmId, ["CM", "ADMIN"], "CM assignee");
  }
  if (typeof assigneeVideasteId === "string") {
    await assertAssigneeRole(assigneeVideasteId, ["VIDEASTE", "ADMIN"], "Vidéaste assignee");
  }

  // Si patternBindingId change, on doit :
  //   1. Vérifier que le nouveau pattern appartient au MÊME compte que le slot
  //      (cross-account leak : un pattern de compte B pour un slot de compte A
  //      casse toute la résolution needs*/cover/assignees aval).
  //   2. Charger ses needs* pour que la validation cross-field ci-dessous
  //      utilise le NOUVEAU pattern, pas l'ancien. Sans ce refetch,
  //      changer le pattern + activer needsCaptionsOverride en un seul PATCH
  //      valide la cohérence contre l'ancien pattern → la nouvelle config
  //      peut être incohérente sans alerte.
  // NB : clé API `patternBindingId` (ex-`patternId`, renommée V1 17/08) —
  // la valeur est un id de PatternBinding (canonique).
  //
  // Résolution via le helper partagé à 3 branches (binding → patternTemplate
  // direct → null). La branche patternTemplate direct est indispensable pour
  // les missions account-less (patternBindingId null + patternTemplateId
  // non-null) : une résolution inline à 2 branches ne la couvrait pas et
  // produisait un effectivePattern=null incorrect pour ces slots — faisant
  // throw à tort les gardes cross-field ci-dessous quand un override
  // "auto"/"autoGenerate" laisse le preset/prompt hérité du template.
  let effectivePattern: SlotEffectivePattern | null = resolveSlotEffectivePattern(slot);
  if (typeof patternBindingId === "string" && patternBindingId !== "") {
    const binding = await prisma.patternBinding.findUnique({
      where: { id: patternBindingId },
      include: { patternTemplate: true },
    });
    if (!binding) {
      throw new ValidationError("Pattern introuvable");
    }
    // Cross-account guard.
    const slotAccount = await prisma.publicationSlot.findUnique({
      where: { id },
      select: { accountId: true },
    });
    if (slotAccount && binding.accountId !== slotAccount.accountId) {
      throw new ValidationError(
        "Le pattern choisi n'appartient pas au compte Instagram de cette publication.",
      );
    }
    effectivePattern = resolveSlotEffectivePattern({
      patternBinding: binding,
      patternTemplate: null,
    });
  }
  // patternBindingId="" / null : reset l'effective pattern à null pour la validation.
  if (patternBindingId === null || patternBindingId === "") {
    effectivePattern = null;
  }

  // ── Validation cross-field Phase 5 ─────────────────────────────────────────
  // Simule l'état post-update (slot ∪ body diff) pour vérifier la cohérence
  // toggles ↔ presets. Évite de sauver un slot où la cover auto est activée
  // sans preset (trigger-cover refuserait plus tard cryptiquement).
  const postUpdateCaptionsMode =
    needsCaptionsModeOverride !== undefined
      ? (needsCaptionsModeOverride as string | null)
      : slot.needsCaptionsModeOverride;
  const postUpdateCaptionPresetId =
    captionPresetIdOverride !== undefined
      ? (captionPresetIdOverride as string | null)
      : slot.captionPresetIdOverride;
  const resolvedCaptionsMode =
    postUpdateCaptionsMode ?? effectivePattern?.needsCaptionsMode ?? "none";
  const resolvedCaptionPresetId =
    postUpdateCaptionPresetId ?? effectivePattern?.captionPresetId ?? null;
  if (resolvedCaptionsMode === "auto" && !resolvedCaptionPresetId) {
    throw new ValidationError(
      "Sous-titres auto activés mais aucun preset captions défini (ni au slot, ni au pattern)",
    );
  }

  const postUpdateNeedsDescription =
    needsDescriptionOverride !== undefined
      ? (needsDescriptionOverride as string | null)
      : slot.needsDescriptionOverride;
  const postUpdateDescriptionPromptId =
    descriptionPromptIdOverride !== undefined
      ? (descriptionPromptIdOverride as string | null)
      : slot.descriptionPromptIdOverride;
  const resolvedNeedsDescription =
    postUpdateNeedsDescription ?? effectivePattern?.needsDescription ?? "none";
  const resolvedDescriptionPromptId =
    postUpdateDescriptionPromptId ?? effectivePattern?.descriptionPromptId ?? null;
  if (resolvedNeedsDescription === "autoGenerate" && !resolvedDescriptionPromptId) {
    throw new ValidationError(
      "Description auto activée mais aucun prompt IA défini (ni au slot, ni au pattern)",
    );
  }

  // ── Pré-remplissage de la légende « Pré-remplie » depuis le bien ───────────
  // Au (re)rattachement d'un bien (propertyId non-null dans le body), on écrase
  // slot.description avec Property.fields[key] si la description effective =
  // "preFilled" (décision produit : bien = source de vérité, écrasement
  // systématique au changement de bien). On ne touche à rien si l'appelant fixe
  // déjà `description` explicitement (édition manuelle simultanée) ou détache le
  // bien (propertyId null).
  //
  // Se base sur `effectivePattern` (résolution unique ci-dessus, 3 branches
  // binding → patternTemplate direct → null) — couvre aussi le prefill pour
  // une mission account-less, cas d'usage central « choisir un bien lié sur
  // une mission ».
  let prefilledDescription: string | undefined;
  // DataEntry effectivement utilisée (nouvellement tirée ou réutilisée) — sert
  // à enrichir le payload DESCRIPTION_PREFILLED ci-dessous et, si nouvellement
  // tirée, à persister captionDataEntryId + claim post-commit.
  let prefilledCaptionEntry: { entryId: string; setTag: string | null; libraryId: string } | null = null;
  let prefilledCaptionDrewNew = false;
  if (typeof propertyId === "string" && propertyId && description === undefined) {
    // Phase 5 : la fiche (Entity) porte les valeurs — clé API `propertyId`.
    const property = await prisma.entity.findUnique({
      where: { id: propertyId },
      select: { fields: true },
    });
    // Override per-slot (body ou existant) prime sur le pattern effectif.
    const effNeedsDescription =
      postUpdateNeedsDescription ?? effectivePattern?.needsDescription ?? "none";
    // Fiche tournage (fixe, chargée au select initial) < fiche data
    // (rattachée par ce PATCH) < DataEntry mémorisée (comble les trous) —
    // même précédence que createSlot, cf. `resolveCaptionWithDataLibrary`.
    // `storedEntry` = l'entrée déjà mémorisée sur le slot : re-rattacher une
    // fiche RÉ-INTERPOLE la même entrée avec des champs frais (idempotent) ;
    // un slot sans entrée mémorisée déclenche un premier tirage.
    const { caption, usedEntry, drewNewEntry } = await resolveCaptionWithDataLibrary({
      config: {
        needsDescription: effNeedsDescription,
        descriptionFixedText: effectivePattern?.descriptionFixedText ?? null,
        descriptionSourceFieldKey: effectivePattern?.descriptionSourceFieldKey ?? null,
        descriptionDataLibraryId: effectivePattern?.descriptionDataLibraryId ?? null,
        descriptionDataSetTag: effectivePattern?.descriptionDataSetTag ?? null,
      },
      accountId: slot.accountId,
      storedEntry: slot.captionDataEntry,
      shootEntityFieldsJson: slot.shootEntity?.fields ?? null,
      entityFieldsJson: property?.fields ?? null,
      shootRelatedFieldsJson: slot.shootEntity?.related?.fields ?? null,
    });
    if (caption != null) prefilledDescription = caption;
    if (usedEntry) {
      prefilledCaptionEntry = { entryId: usedEntry.entryId, setTag: usedEntry.setTag, libraryId: usedEntry.libraryId };
      prefilledCaptionDrewNew = drewNewEntry;
    }
  }

  // Guard cover-mode retiré (idem createSlot ci-dessus) : le runtime
  // coverAuto.ts a un fallback gracieux preset par défaut du template
  // (sortOrder min). Pas besoin de bloquer le PATCH si le pattern a
  // coverMode="autoPack" sans coverPresetId dans coverConfig — le moteur
  // se débrouille au moment du render et log COVER_CONFIG_ERROR si
  // vraiment rien n'est résolvable.

  // Update + logActivity (STATUS_CHANGED, ASSIGNEE_CHANGED) dans une seule
  // transaction. Sans ça, un crash entre l'update et l'un des logActivity
  // laissait le slot modifié avec un audit-trail partiel (gap silencieux,
  // finding slot-11). cancelPendingJobsForSlot reste hors-tx car best-effort
  // (cascade peut échouer sans devoir rollback la transition).
  const statusChanged =
    status !== undefined && typeof status === "string" && status !== slot.status;
  const monteurChanged =
    assigneeMonteurId !== undefined && assigneeMonteurId !== slot.assigneeMonteurId;
  const cmChanged = assigneeCmId !== undefined && assigneeCmId !== slot.assigneeCmId;
  const videasteChanged =
    assigneeVideasteId !== undefined && assigneeVideasteId !== slot.assigneeVideasteId;
  const anyAssigneeChanged = monteurChanged || cmChanged || videasteChanged;
  // Transition banque → planifié : le slot était stocké (scheduledAt: null)
  // et reçoit une date programmée. Émet un événement BANK_SLOT_SCHEDULED en
  // plus du log scheduledAt normal pour matérialiser la promotion.
  const bankScheduled =
    slot.scheduledAt === null &&
    scheduledAt !== undefined &&
    scheduledAt !== null &&
    typeof scheduledAt === "string";

  let updated: Awaited<ReturnType<typeof prisma.publicationSlot.update>>;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // W5.14 : construction iterative de la data — chaque field passe par
      // un transformer typé. Avant : 60 LOC de spreads conditionnels où
      // ajouter un nouveau patchable demandait 3 éditions (ALLOWED_PATCH_
      // FIELDS_BY_ROLE + destructure + spread). Maintenant : 1 entrée dans
      // FIELD_TRANSFORMERS suffit.
      const FIELD_TRANSFORMERS: Record<string, (v: unknown) => unknown> = {
        status: (v) => v as string,
        title: (v) => v as string | null,
        description: (v) => v as string | null,
        notes: (v) => v as string | null,
        templateId: (v) => v as string | null,
        // null = remise en banque ; string ISO = (re)planification.
        scheduledAt: (v) => (v === null ? null : new Date(v as string)),
        fields: (v) => JSON.stringify(v),
        fieldSchema: (v) => JSON.stringify(v),
        assigneeMonteurId: (v) => v as string | null,
        assigneeCmId: (v) => v as string | null,
        assigneeVideasteId: (v) => v as string | null,
        currentVersionId: (v) => v as string | null,
        isAuto: (v) => v as boolean,
        // Phase 5/6 — overrides per-slot (null = hérite, true/false = écrase)
        needsAdminValidationOverride: (v) => v as boolean | null,
        needsClientValidationOverride: (v) => v as boolean | null,
        allowsClientRevisionOverride: (v) => v as boolean | null,
        needsCaptionsModeOverride: (v) => v as string | null,
        needsDescriptionOverride: (v) => v as string | null, // enum string
        needsRushesOverride: (v) => v as boolean | null,
        needsBriefOverride: (v) => v as boolean | null,
        coverModeOverride: (v) => v as string | null,
        captionPresetIdOverride: (v) => v as string | null,
        descriptionPromptIdOverride: (v) => v as string | null,
      };

      const FIELD_VALUES: Record<string, unknown> = {
        status, title, description: prefilledDescription ?? description, notes, templateId, scheduledAt,
        fields, fieldSchema,
        assigneeMonteurId, assigneeCmId, assigneeVideasteId,
        currentVersionId, isAuto,
        needsAdminValidationOverride, needsClientValidationOverride,
        allowsClientRevisionOverride, needsCaptionsModeOverride,
        needsDescriptionOverride, needsRushesOverride, needsBriefOverride,
        coverModeOverride,
        captionPresetIdOverride, descriptionPromptIdOverride,
      };

      const updateData: Record<string, unknown> = {};
      for (const [field, transformer] of Object.entries(FIELD_TRANSFORMERS)) {
        const raw = FIELD_VALUES[field];
        if (raw !== undefined) updateData[field] = transformer(raw);
      }
      // "" / null = détacher la recette.
      if (patternBindingId !== undefined) {
        updateData.patternBindingId =
          patternBindingId === "" || patternBindingId === null
            ? null
            : (patternBindingId as string);
      }
      // Phase 5 — clé API `propertyId` (valeur = id d'Entity) → colonne
      // entityId. null = détacher la fiche.
      if (propertyId !== undefined) {
        updateData.entityId =
          propertyId === "" || propertyId === null ? null : (propertyId as string);
      }
      // Légende « Pré-remplie » — DataEntry NOUVELLEMENT tirée seulement : une
      // réutilisation (prefilledCaptionEntry non-null, drewNewEntry=false)
      // laisse captionDataEntryId inchangé, il pointe déjà dessus.
      if (prefilledCaptionDrewNew && prefilledCaptionEntry) {
        updateData.captionDataEntryId = prefilledCaptionEntry.entryId;
      }

      const u = await tx.publicationSlot.update({
        where: { id },
        data: updateData as Prisma.PublicationSlotUpdateInput,
        include: {
          account: { select: { id: true, name: true, handle: true } },
          template: { select: { id: true, name: true } },
          render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
        },
      });

      if (statusChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "STATUS_CHANGED",
          payload: { from: slot.status, to: status as string },
        });
      }

      if (anyAssigneeChanged) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "ASSIGNEE_CHANGED",
          payload: {
            ...(monteurChanged
              ? { monteur: { from: slot.assigneeMonteurId, to: assigneeMonteurId ?? null } }
              : {}),
            ...(cmChanged
              ? { cm: { from: slot.assigneeCmId, to: assigneeCmId ?? null } }
              : {}),
            ...(videasteChanged
              ? { videaste: { from: slot.assigneeVideasteId, to: assigneeVideasteId ?? null } }
              : {}),
          },
        });
      }

      if (bankScheduled) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "BANK_SLOT_SCHEDULED",
          payload: { scheduledAt: scheduledAt as string },
        });
      }

      if (prefilledDescription !== undefined) {
        await logActivity(tx as typeof prisma, {
          slotId: id,
          actorId,
          type: "DESCRIPTION_PREFILLED",
          payload: {
            propertyId: propertyId as string,
            length: prefilledDescription.length,
            // Traçabilité DataEntry (nouvellement tirée ou réutilisée) —
            // absent si la recette n'a pas de bibliothèque de données.
            ...(prefilledCaptionEntry
              ? {
                  entryId: prefilledCaptionEntry.entryId,
                  setTag: prefilledCaptionEntry.setTag,
                  libraryId: prefilledCaptionEntry.libraryId,
                  reusedEntry: !prefilledCaptionDrewNew,
                }
              : {}),
          },
        });
      }

      return u;
    });
  } catch (err) {
    console.error("[slotService.patchSlot] prisma update failed:", err);
    throw new ServiceError(
      "INTERNAL",
      err instanceof Error ? `Échec de la sauvegarde : ${err.message}` : "Échec de la sauvegarde",
      500,
    );
  }

  // Claim d'usage DataEntry best-effort, APRÈS le commit de la transaction —
  // le slot est déjà correct même si le claim échoue (pas de revert, cf.
  // claimDataEntryForCaption). Seulement pour une entrée NOUVELLEMENT tirée :
  // une réutilisation a déjà été claim à son propre tirage initial.
  if (prefilledCaptionDrewNew && prefilledCaptionEntry) {
    await claimDataEntryForCaption(prefilledCaptionEntry.entryId, slot.accountId);
  }

  // Cancel cascade : si on passe à CANCELLED, marquer les jobs en cours comme
  // FAILED (Render, CaptionJob, DescriptionJob). Best-effort hors-tx : un
  // échec ici ne doit pas rollback la transition (le slot EST cancelled, on
  // signale l'échec dans les logs mais on confirme l'update).
  if (statusChanged && status === "CANCELLED") {
    try {
      await cancelPendingJobsForSlot(id);
    } catch (err) {
      console.error(
        `[patchSlot] cancel cascade failed for slot=${id}:`,
        err,
      );
    }
  }

  return {
    ...updated,
    fields: safeJSON<Record<string, string>>(updated.fields, {}),
    fieldSchema: safeJSON<string[]>(updated.fieldSchema, []),
    // Clé API `propertyId` = fiche liée (Entity) — cf. mapping de listSlots.
    propertyId: updated.entityId,
  };
}

// ─── listSlots ────────────────────────────────────────────────────────────────

export interface ListSlotsFilters {
  accountId?: string;
  status?: string;
  patternBindingId?: string;
  monteurId?: string;
  cmId?: string;
  videasteId?: string;
  dateFrom?: string;
  dateTo?: string;
  /**
   * Filtre banque :
   * - "only"    : ne retourne QUE les slots stockés (scheduledAt: null).
   * - undefined : mix (défaut). Les date-range filtres excluent déjà les nulls
   *   naturellement (Prisma `gte/lte` ne match pas null).
   */
  bank?: "only";
}

/**
 * Liste les PublicationSlot accessibles à l'utilisateur, avec filtres optionnels.
 *
 * - Scope rôle injecté en premier dans AND (les filtres URL ne peuvent jamais
 *   l'écraser : protection contre un filtre `id=X` qui viendrait spread sur
 *   le clause USER `id:"__never__"`).
 * - `monteurId` / `cmId` sont des raffinements UX pour l'ADMIN ; pour un
 *   MONTEUR/CM, l'intersection AND maintient le scope sécurisé.
 * - Limite hard à 500 ; `hasMore` indique au client qu'il a atteint la borne.
 * - Rattrapage opportuniste : `syncSlotsPipelineStatuses` met à jour les slots
 *   dont le render PROCESSING/DONE doit faire transitionner vers IN_PROGRESS/READY_FOR_CM
 *   (best-effort, non bloquant). Le statut renvoyé reflète immédiatement la transition.
 *
 * Throw :
 *  - `ForbiddenError` si l'appelant est `EXTERNAL_GENERATOR` (pas d'accès pipeline).
 */
export async function listSlots(filters: ListSlotsFilters, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  if (role === "EXTERNAL_GENERATOR") {
    throw new ForbiddenError("Accès refusé");
  }

  const roleScope = whereClauseForUser(role, userId);

  const bankClause: Prisma.PublicationSlotWhereInput =
    filters.bank === "only" ? { scheduledAt: null } : {};

  // Pour la vue Banque (bank="only"), trier par dernière maj (updatedAt desc) —
  // les slots les plus récemment touchés (upload récent, validation) en premier.
  // Sinon, conserve le tri scheduledAt asc (grille semaine, worklists).
  const orderBy: Prisma.PublicationSlotOrderByWithRelationInput =
    filters.bank === "only"
      ? { updatedAt: "desc" }
      : { scheduledAt: "asc" };

  const slots = await prisma.publicationSlot.findMany({
    where: {
      AND: [
        roleScope,
        bankClause,
        filters.accountId ? { accountId: filters.accountId } : {},
        filters.status ? { status: filters.status } : {},
        filters.patternBindingId ? { patternBindingId: filters.patternBindingId } : {},
        filters.monteurId ? { assigneeMonteurId: filters.monteurId } : {},
        filters.cmId ? { assigneeCmId: filters.cmId } : {},
        filters.videasteId ? { assigneeVideasteId: filters.videasteId } : {},
        filters.dateFrom || filters.dateTo
          ? {
              scheduledAt: {
                ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
                ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
              },
            }
          : {},
      ],
    },
    orderBy,
    take: 500,
    include: {
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      // render + coverFramePack du render (cas auto_template). Pour les patterns
      // manual_rushes, le coverFramePack est rattaché à currentVersion ; on le
      // fetch séparément ci-dessous.
      render: {
        select: {
          id: true,
          status: true,
          pngUrl: true,
          videoUrl: true,
          coverFramePack: { select: { status: true } },
        },
      },
      // CoverFramePack côté manual_rushes / external_upload (Phase 5).
      currentVersion: {
        select: {
          id: true,
          coverFramePack: { select: { status: true } },
        },
      },
      assigneeMonteur: { select: { id: true, name: true } },
      assigneeCm: { select: { id: true, name: true } },
      assigneeVideaste: { select: { id: true, name: true } },
      // Recette (binding → template) : source + needsCaptions nécessaires pour
      // syncSlotsPipelineStatuses ; needs* + allows* pour l'affichage des
      // valeurs héritées dans les OverrideSelect du SlotDetailPanel. Une vue
      // `pattern` (même shape qu'avant le décommissionnement AccountPattern)
      // est synthétisée dans le map de retour — les slots recette bénéficient
      // désormais aussi de l'affichage des héritages (fix résidu G.3).
      ...slotEffectivePatternSelect,
      // Dernier job captions/description pour alimenter PipelineDots avec
      // les vraies données (au lieu de déduire depuis slot.status).
      // take:5 + staleSince exposé : syncSlotsPipelineStatuses applique
      // un guard `!c.staleSince` qui sinon évalue !undefined === true et
      // traite chaque job stale comme frais (bug post-promote).
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { status: true, staleSince: true },
      },
      descriptionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, result: true },
      },
    },
  });

  // Vue recette effective (binding avec overrides → template global → null) —
  // résolution partagée (V2.2), même shape que l'ancien `slot.pattern`.
  const patternViewOf = resolveSlotEffectivePattern;

  const updates = await syncSlotsPipelineStatuses(
    prisma,
    slots.map((s) => {
      const pattern = patternViewOf(s);
      return {
        id: s.id,
        status: s.status,
        pattern: pattern
          ? {
              source: pattern.source,
              needsCaptionsMode: pattern.needsCaptionsMode,
            }
          : null,
        render: s.render ? { status: s.render.status } : null,
        captionJobs: s.captionJobs.map((c) => ({ status: c.status, staleSince: c.staleSince })),
      };
    }),
  );

  return {
    slots: slots.map((s) => ({
      ...s,
      pattern: patternViewOf(s),
      status: updates.get(s.id) ?? s.status,
      fields: safeJSON<Record<string, string>>(s.fields, {}),
      fieldSchema: safeJSON<string[]>(s.fieldSchema, []),
      // Clé API `propertyId` = fiche liée (Entity). La colonne DB `propertyId`
      // est morte (plus écrite depuis la Phase 5) — sans ce mapping le client
      // lisait null et « perdait » la fiche au refetch.
      propertyId: s.entityId,
    })),
    hasMore: slots.length === 500,
  };
}

// ─── getSlot ──────────────────────────────────────────────────────────────────

/**
 * Charge un PublicationSlot par id, scopé par rôle.
 *
 * 404 systématique si le slot n'existe pas OU n'est pas accessible selon le
 * rôle — on ne distingue pas les deux cas (anti-énumération).
 */
export async function getSlot(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
      assigneeMonteur: { select: { id: true, name: true } },
      assigneeCm: { select: { id: true, name: true } },
      assigneeVideaste: { select: { id: true, name: true } },
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    throw new NotFoundError("Slot");
  }

  return {
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
    // Clé API `propertyId` = fiche liée (Entity) — cf. mapping de listSlots.
    propertyId: slot.entityId,
  };
}

// ─── cancelPendingJobsForSlot ────────────────────────────────────────────────

/**
 * Marque tous les jobs RunPod en cours (Render PENDING/PROCESSING,
 * CaptionJob QUEUED/PROCESSING) comme FAILED quand un slot est annulé.
 *
 * Pas d'appel à l'API RunPod pour annuler côté pod — coûteux et fragile.
 * On se contente du marquage DB qui suffit pour :
 *  - Sortir les jobs des worklists "en cours"
 *  - Ignorer les webhooks RunPod qui arriveraient APRÈS (le webhook checke
 *    typiquement que le status n'est pas déjà terminal avant de l'écraser)
 *  - Permettre au sweep périodique d'identifier les orphelins
 *
 * Best-effort : chaque update est wrappé en try/catch — un échec sur Render
 * ne bloque pas le cancel CaptionJob, etc.
 */
async function cancelPendingJobsForSlot(slotId: string): Promise<void> {
  const cancelMsg = "Slot annulé — job interrompu";

  // Render (publicationSlotId est unique sur Render)
  try {
    const updated = await prisma.render.updateMany({
      where: {
        publicationSlotId: slotId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: { status: "ERROR", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} render(s) as ERROR`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] render update failed slot=${slotId}:`, err);
  }

  // CaptionJob
  try {
    const updated = await prisma.captionJob.updateMany({
      where: {
        slotId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: { status: "FAILED", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} caption job(s) as FAILED`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] captionJob update failed slot=${slotId}:`, err);
  }

  // DescriptionJob — sans ce block, un slot annulé pouvait recevoir un
  // webhook DESCRIPTION_COMPLETED qui écrasait la description manuelle ou
  // déclenchait des transitions silencieuses.
  try {
    const updated = await prisma.descriptionJob.updateMany({
      where: {
        slotId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: { status: "FAILED", errorMsg: cancelMsg },
    });
    if (updated.count > 0) {
      console.info(
        `[cancelPendingJobsForSlot] slot=${slotId} marked ${updated.count} description job(s) as FAILED`,
      );
    }
  } catch (err) {
    console.error(`[cancelPendingJobsForSlot] descriptionJob update failed slot=${slotId}:`, err);
  }
}

// ─── deleteSlot ───────────────────────────────────────────────────────────────

/**
 * Supprime un PublicationSlot (ADMIN uniquement).
 *
 * Renvoie 404 (pas 403) pour les non-ADMIN, par cohérence avec GET/PATCH :
 * un non-admin ne doit pas savoir si le slot existe.
 *
 * Cleanup R2 : après le delete DB (cascade sur PublicationVersion,
 * PublicationRush, PublicationBriefAttachment…), on balaie TOUT le préfixe
 * `publications/<slotId>/` du bucket. Ce préfixe contient l'intégralité du
 * stockage du slot : rushes, versions, pièces jointes brief ET cover-monteur
 * (`publications/<slotId>/cover-monteur/`), plus tout résidu d'upload avorté.
 * Un balayage par préfixe est plus robuste qu'une collecte clé-par-clé — rien
 * n'échappe, et CoverFramePack n'a pas de slotId direct exploitable ici.
 *
 * Best-effort : les échecs R2 sont loggués mais ne bloquent pas la suppression
 * DB (déjà commit). Ordre DB-avant-R2 : si le sweep échoue, le slot a quand
 * même disparu et le cron r2-cleanup rattrapera le résidu.
 *
 * Render / CaptionJob / TranscriptionJob ont `onDelete: SetNull` : leurs lignes
 * (et leurs objets R2 hors préfixe slot, ex. `renders/…`) survivent — dette
 * assumée car ces jobs peuvent être ré-utilisés.
 */
/**
 * Rattache (ou détache) une publication à une fiche tournage APRÈS sa création.
 *
 * `shootEntityId` était write-once : absent de toutes les listes de
 * `ALLOWED_PATCH_FIELDS_BY_ROLE`, ADMIN compris, et jamais lu par `patchSlot`.
 * Conséquence : un slot créé sur le calendrier ne pouvait plus jamais être relié
 * à un tournage — exactement le scénario RPOD, où l'on pré-shoote des slots sans
 * savoir combien de vidéos sortiront du contenu tourné.
 *
 * Route dédiée plutôt qu'un champ patchable : ce n'est pas une écriture de
 * champ, c'est une revalidation en cascade qui touche quatre autres colonnes
 * (compte, fiche liée, assignés, needsRushesOverride). L'insérer dans
 * `patchSlot` obligerait à rejouer ces règles au milieu de 200 lignes de
 * validations croisées.
 *
 * Ce qui est rejoué de `createSlot`, et ce qui ne l'est pas :
 *  - compte : REFUSÉ s'il diffère, jamais écrasé (écraser déplacerait un slot
 *    déjà planifié vers un autre calendrier) ;
 *  - fiche liée / assignés : hérités SEULEMENT s'ils sont vides — un monteur
 *    déjà assigné garde sa place ;
 *  - statut : PAS de réinitialisation. Un seul bump, celui de `markEntityShot` :
 *    PLANNED/RUSHES_EXPECTED + tournage SHOT/DONE → IN_EDIT. Forcer PLANNED
 *    ferait régresser un reel déjà en montage ;
 *  - needsRushesOverride = false : c'est la raison d'être du rattachement (le
 *    reel puise dans les rushs partagés du tournage).
 *
 * Détachement (`shootEntityId: null`) : `needsRushesOverride` N'EST PAS remis à
 * true — ça relancerait une demande de rushs sur un reel déjà monté.
 */
export async function attachShootToSlot(
  slotId: string,
  shootEntityId: string | null,
  ctx: UserContext,
) {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      accountId: true,
      entityId: true,
      shootEntityId: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      needsRushesOverride: true,
      needsDescriptionOverride: true,
      // Le rattachement pose la fiche liée : il doit pouvoir en tirer la
      // légende dans la foulée, comme le font createSlot et patchSlot.
      description: true,
      entity: { select: { fields: true } },
      captionDataEntry: { select: { id: true, fields: true, setTag: true, libraryId: true } },
      ...slotEffectivePatternSelect,
    },
  });
  if (!slot) throw new NotFoundError("Slot");

  if (shootEntityId === null) {
    if (!slot.shootEntityId) {
      throw new ConflictError("Cette publication n'est rattachée à aucun tournage");
    }
    return prisma.publicationSlot.update({
      where: { id: slotId },
      data: { shootEntityId: null },
    });
  }

  // Même garde qu'à la création et que dans AddSlotModal : une recette « auto »
  // ne produit pas un reel, elle se rend toute seule depuis un template.
  const pattern = resolveSlotEffectivePattern(slot);
  if (pattern && !(REEL_ATTACHABLE_SOURCES as readonly string[]).includes(pattern.source)) {
    throw new ValidationError(
      "Seules les recettes à rushs ou à envoi externe peuvent être rattachées à un tournage",
    );
  }

  const shoot = await prisma.entity.findUnique({
    where: { id: shootEntityId },
    select: {
      id: true,
      isArchived: true,
      accountId: true,
      relatedEntityId: true,
      fields: true,
      related: { select: { fields: true } },
      status: true,
      validationStatus: true,
      assigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
      type: { select: { hasPlanning: true, hasRushes: true } },
    },
  });
  if (!shoot) throw new NotFoundError("Tournage");
  if (!shoot.type.hasPlanning || !shoot.type.hasRushes) {
    throw new ValidationError("Cette fiche n'est pas un tournage");
  }
  if (shoot.isArchived) throw new ValidationError("Ce tournage est archivé");
  assertEntityValidated(shoot.validationStatus, "Cette fiche tournage");

  // Refuser plutôt qu'écraser : déplacer silencieusement un slot d'un compte à
  // l'autre le ferait disparaître du calendrier où l'admin le regardait.
  if (slot.accountId && shoot.accountId && slot.accountId !== shoot.accountId) {
    throw new ConflictError(
      "Cette publication et ce tournage ne sont pas sur le même compte Instagram",
    );
  }

  const bumpsToEdit =
    (shoot.status === "SHOT" || shoot.status === "DONE") &&
    (REEL_STATUSES_BUMPED_ON_SHOT as readonly string[]).includes(slot.status);

  /**
   * Légende — le rattachement pose la fiche liée, il doit en tirer la légende
   * dans la foulée. Sans ça, le bien était là, ses données étaient là, et la
   * légende restait vide jusqu'à un « Recalculer » manuel que rien ne
   * signalait (asymétrie avec createSlot et patchSlot).
   *
   * UNIQUEMENT si la légende est vide : contrairement à patchSlot (changement
   * explicite de fiche source), rattacher un tournage arrive souvent sur un
   * reel déjà travaillé par un CM. Écraser un texte écrit à la main serait
   * destructif.
   */
  const effectiveNeedsDescription =
    slot.needsDescriptionOverride ?? pattern?.needsDescription ?? "none";
  let prefilledDescription: string | null = null;
  let prefilledCaptionEntry: { entryId: string; setTag: string | null; libraryId: string } | null = null;
  let prefilledCaptionDrewNew = false;

  if (
    (slot.description ?? "").trim() === "" &&
    (effectiveNeedsDescription === "preFilled" || effectiveNeedsDescription === "fixed")
  ) {
    const { caption, usedEntry, drewNewEntry } = await resolveCaptionWithDataLibrary({
      config: {
        needsDescription: effectiveNeedsDescription,
        descriptionFixedText: pattern?.descriptionFixedText ?? null,
        descriptionSourceFieldKey: pattern?.descriptionSourceFieldKey ?? null,
        descriptionDataLibraryId: pattern?.descriptionDataLibraryId ?? null,
        descriptionDataSetTag: pattern?.descriptionDataSetTag ?? null,
      },
      accountId: slot.accountId ?? shoot.accountId,
      storedEntry: slot.captionDataEntry,
      // La fiche data d'APRÈS l'update : celle du slot si elle existe, sinon
      // le bien du tournage qu'on vient de poser ci-dessous.
      entityFieldsJson: slot.entityId
        ? (slot.entity?.fields ?? null)
        : (shoot.related?.fields ?? null),
      shootEntityFieldsJson: shoot.fields,
      shootRelatedFieldsJson: shoot.related?.fields ?? null,
    });
    prefilledDescription = caption;
    if (usedEntry) {
      prefilledCaptionEntry = {
        entryId: usedEntry.entryId,
        setTag: usedEntry.setTag,
        libraryId: usedEntry.libraryId,
      };
      prefilledCaptionDrewNew = drewNewEntry;
    }
  }

  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      shootEntityId,
      // Les héritages ne comblent que les trous.
      ...(slot.accountId ? {} : shoot.accountId ? { accountId: shoot.accountId } : {}),
      ...(slot.entityId ? {} : shoot.relatedEntityId ? { entityId: shoot.relatedEntityId } : {}),
      ...(slot.assigneeMonteurId
        ? {}
        : shoot.defaultAssigneeMonteurId
          ? { assigneeMonteurId: shoot.defaultAssigneeMonteurId }
          : {}),
      ...(slot.assigneeCmId
        ? {}
        : shoot.defaultAssigneeCmId
          ? { assigneeCmId: shoot.defaultAssigneeCmId }
          : {}),
      ...(slot.assigneeVideasteId
        ? {}
        : shoot.assigneeVideasteId
          ? { assigneeVideasteId: shoot.assigneeVideasteId }
          : {}),
      // Sauf override explicite déjà posé : le rattachement veut dire « les
      // rushs vivent sur le tournage », pas « on oublie ce que l'admin a réglé ».
      ...(slot.needsRushesOverride === null ? { needsRushesOverride: false } : {}),
      ...(bumpsToEdit ? { status: "IN_EDIT" } : {}),
      ...(prefilledDescription !== null ? { description: prefilledDescription } : {}),
      ...(prefilledCaptionDrewNew && prefilledCaptionEntry
        ? { captionDataEntryId: prefilledCaptionEntry.entryId }
        : {}),
    },
  });

  await logActivity(prisma, {
    slotId,
    actorId: ctx.actualUser.id,
    type: "STATUS_CHANGED",
    payload: {
      from: slot.status,
      to: updated.status,
      shootEntityId,
      reason: "attach-shoot",
    },
  });

  // Claim hors de l'écriture du slot : best-effort, comme partout ailleurs —
  // une entrée non consommée fait au pire retomber la rotation, elle ne doit
  // pas faire échouer un rattachement déjà écrit.
  if (prefilledCaptionDrewNew && prefilledCaptionEntry) {
    await claimDataEntryForCaption(prefilledCaptionEntry.entryId, slot.accountId ?? shoot.accountId);
    await logActivity(prisma, {
      slotId,
      actorId: ctx.actualUser.id,
      type: "DESCRIPTION_PREFILLED",
      payload: { trigger: "attach-shoot", entryId: prefilledCaptionEntry.entryId },
    });
  } else if (prefilledDescription !== null) {
    await logActivity(prisma, {
      slotId,
      actorId: ctx.actualUser.id,
      type: "DESCRIPTION_PREFILLED",
      payload: { trigger: "attach-shoot" },
    });
  }

  return updated;
}

/**
 * Pose (ou change) le compte Instagram d'une publication déjà créée.
 *
 * Pourquoi une route dédiée et pas un champ de PATCH : `accountId` est absent
 * d'`ALLOWED_PATCH_FIELDS_BY_ROLE`, et `patchSlot` FILTRE SILENCIEUSEMENT les
 * champs non whitelistés — l'appel réussissait sans rien faire. L'ouvrir là-bas
 * ne suffirait pas non plus : poser un compte doit re-résoudre le binding
 * (donc la recette effective, les horaires, le label) et compléter les
 * assignés. C'est une opération en cascade, comme `attachShootToSlot`, pas
 * l'écriture d'une colonne.
 *
 * Le besoin : le compte n'est plus choisi à la commande (« une vidéo pourrait
 * atterrir parfois sur plusieurs comptes ») mais par celui qui place au
 * calendrier. Les publications naissent donc en banque sans compte — un cas
 * déjà nominal en base (`PublicationSlot.accountId` est nullable) mais qui
 * n'avait aucune porte de sortie : `mark-published` réclamait déjà « assignez
 * d'abord un compte » en désignant un écran qui n'existait pas.
 *
 * C'est aussi ici qu'atterrit le contrôle « la recette est-elle active sur ce
 * compte ? ». Il vivait dans `assertOrderIsInstantiable`, qui sort par le haut
 * quand la commande n'a pas de compte : sans ce déplacement, il ne
 * s'exécuterait tout simplement plus nulle part.
 */
export async function assignSlotAccount(slotId: string, accountId: string, ctx: UserContext) {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      accountId: true,
      publishedUrl: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      order: { select: { clientId: true } },
      shootEntity: { select: { accountId: true } },
      ...slotEffectivePatternSelect,
    },
  });
  if (!slot) throw new NotFoundError("Slot");

  // Re-choisir le même compte n'est pas une erreur : le picker doit pouvoir
  // être reconfirmé sans rien casser.
  if (slot.accountId === accountId) {
    return prisma.publicationSlot.findUniqueOrThrow({ where: { id: slotId } });
  }

  // Déjà en ligne : le compte fait partie de ce qui s'est passé.
  if (slot.status === "PUBLISHED" || slot.publishedUrl) {
    throw new ConflictError(
      "Cette publication est déjà publiée — son compte Instagram ne peut plus changer.",
    );
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      handle: true,
      clientId: true,
      defaultAssigneeVideasteId: true,
      defaultAssigneeMonteurId: true,
      defaultAssigneeCmId: true,
    },
  });
  if (!account) throw new NotFoundError("Compte Instagram");

  // Cloison client : une publication issue d'une commande ne doit pas pouvoir
  // sauter chez un autre client par un identifiant deviné.
  if (slot.order && account.clientId !== slot.order.clientId) {
    throw new ValidationError(
      "Ce compte Instagram n'appartient pas au client de la commande.",
    );
  }

  // Miroir de la garde d'`attachShootToSlot` : le tournage impose son compte.
  if (slot.shootEntity?.accountId && slot.shootEntity.accountId !== accountId) {
    throw new ConflictError(
      "Le tournage rattaché à cette publication est sur un autre compte Instagram.",
    );
  }

  /**
   * La recette doit être active sur le compte cible, sinon la publication
   * naîtrait sans horaire ni équipe et personne ne la verrait passer — c'est
   * exactement ce que refusait la validation de commande.
   */
  const pattern = resolveSlotEffectivePattern(slot);
  const patternTemplateId = slot.patternBinding?.patternTemplateId ?? slot.patternTemplate?.id ?? null;
  let binding: {
    id: string;
    defaultAssigneeVideasteId: string | null;
    defaultAssigneeMonteurId: string | null;
    defaultAssigneeCmId: string | null;
  } | null = null;

  if (patternTemplateId) {
    binding = await prisma.patternBinding.findFirst({
      where: { accountId, patternTemplateId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        defaultAssigneeVideasteId: true,
        defaultAssigneeMonteurId: true,
        defaultAssigneeCmId: true,
      },
    });
    if (!binding) {
      throw new ConflictError(
        `La recette « ${pattern?.label ?? "de cette publication"} » n'est pas active sur @${account.handle} — activez-la sur le compte avant d'y placer cette publication.`,
      );
    }
  }

  // Assignés : on ne COMBLE que les trous. Un monteur posé à la main tient,
  // même si le compte en propose un autre.
  const videasteId =
    slot.assigneeVideasteId ??
    binding?.defaultAssigneeVideasteId ??
    account.defaultAssigneeVideasteId;
  const monteurId =
    slot.assigneeMonteurId ??
    binding?.defaultAssigneeMonteurId ??
    account.defaultAssigneeMonteurId;
  const cmId =
    slot.assigneeCmId ?? binding?.defaultAssigneeCmId ?? account.defaultAssigneeCmId;

  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      accountId,
      // Le binding EST la recette appliquée à ce compte : sans lui, le slot
      // resterait piloté par la recette globale, donc sans horaire ni label
      // propres au compte.
      ...(binding ? { patternBindingId: binding.id } : {}),
      assigneeVideasteId: videasteId,
      assigneeMonteurId: monteurId,
      assigneeCmId: cmId,
    },
  });

  await logActivity(prisma, {
    slotId,
    actorId: ctx.actualUser.id,
    type: "ASSIGNEE_CHANGED",
    payload: {
      reason: "assign-account",
      accountId,
      handle: account.handle,
      from: slot.accountId,
      patternBindingId: binding?.id ?? null,
    },
  });

  return updated;
}

/** Motif de retrait — obligatoire, et borné comme tout texte libre non-admin. */
const MAX_CANCEL_REASON = 500;

/**
 * Retire une publication du pipeline (statut CANCELLED), avec motif et trace.
 *
 * Répond au cas métier : 5 vidéos commandées, des rushs pour 4 seulement — le
 * monteur en retire une. Jusqu'ici il ne pouvait ni supprimer (ADMIN strict) ni
 * annuler (CANCELLED réservé à l'ADMIN via PATCH) ; il ne lui restait que
 * BLOCKED, qui veut dire « bloqué », pas « pas de rushs pour celle-ci ».
 *
 * ANNULER, PAS SUPPRIMER — et c'est structurant : un slot CANCELLED reste en
 * base, donc il continue d'être compté par l'idempotence de
 * `instantiateOrderSlots`. Le bouton « Réessayer l'instanciation » de la
 * commande ne le recrée donc pas. Une suppression, elle, faisait réapparaître
 * la vidéo au clic suivant. Ne pas « optimiser » ce comptage avec un
 * `status: { notIn: TERMINAL_STATUSES }` : ce serait rouvrir le bug.
 *
 * `deleteSlot` reste la porte ADMIN pour une suppression définitive.
 */
export async function cancelSlot(id: string, reason: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);
  const userId = ctx.effectiveUser.id;

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new ValidationError("Un motif est requis pour retirer une publication");
  }
  if (trimmedReason.length > MAX_CANCEL_REASON) {
    throw new ValidationError(`Motif trop long (max ${MAX_CANCEL_REASON} caractères)`);
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      title: true,
      notes: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });
  // 404 et non 403 sur l'accès : anti-énumération, comme partout ailleurs.
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    throw new NotFoundError("Slot");
  }
  if (!canCancelSlot(role)) {
    throw new ForbiddenError("Vous ne pouvez pas retirer cette publication");
  }

  if ((TERMINAL_STATUSES as readonly string[]).includes(slot.status)) {
    throw new ConflictError(
      slot.status === "CANCELLED"
        ? "Cette publication est déjà retirée"
        : "Cette publication est terminée — seul un admin peut revenir dessus",
    );
  }
  // La matrice reste la source de vérité des transitions permises ; l'ADMIN la
  // bypasse, comme partout.
  if (!canTransition(slot.status as SlotStatus, "CANCELLED", role)) {
    throw new ConflictError(`Impossible de retirer une publication au statut ${slot.status}`);
  }

  const updated = await prisma.publicationSlot.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logActivity(prisma, {
    slotId: id,
    // `actualUser` et non `effectiveUser` : sous impersonation, l'audit doit
    // désigner l'admin réel, pas la personne dont il emprunte l'identité.
    actorId: ctx.actualUser.id,
    type: "STATUS_CHANGED",
    payload: { from: slot.status, to: "CANCELLED", reason: trimmedReason },
  });

  return updated;
}

export async function deleteSlot(id: string, ctx: UserContext) {
  const role = toUserRole(ctx.effectiveUser.role);

  if (role !== "ADMIN") {
    throw new NotFoundError("Slot");
  }

  // Vérif existence + delete dans la même transaction (la cascade Prisma
  // supprime les lignes enfants : versions, rushes, brief, comments, etc.).
  await prisma.$transaction(async (tx) => {
    const slot = await tx.publicationSlot.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!slot) {
      throw new NotFoundError("Slot");
    }
    await tx.publicationSlot.delete({ where: { id } });
  });

  // Reclaim R2 — best-effort, après le commit DB. On supprime tout le préfixe
  // du slot en une passe (rushes + versions + brief + cover-monteur + résidus).
  let r2ObjectsDeleted = 0;
  if (r2Configured()) {
    try {
      const result = await deleteR2Prefix(`publications/${id}/`);
      r2ObjectsDeleted = result.deleted;
      if (result.failed > 0) {
        console.error(
          `[deleteSlot] R2 cleanup partiel pour slotId=${id}: ${result.failed} objet(s) en échec`,
        );
      }
    } catch (err) {
      console.error(`[deleteSlot] R2 prefix cleanup failed for slotId=${id}:`, err);
    }
  }

  return { ok: true, r2ObjectsDeleted };
}

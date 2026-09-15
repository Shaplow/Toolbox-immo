/**
 * Helpers de scoping Prisma pour les requêtes Entity (fiches/métaobjets) par
 * rôle — plan simplification Phase 5. Généralise `eventScope.ts` (ShootEvent)
 * avec le switch `EntityType.visibility` :
 *
 * - `visibility="admin"` (ex-Property « Bien », types data purs) :
 *   liste/fiche/CRUD strictement ADMIN. Les monteurs/CM/vidéastes ne voient
 *   jamais ces fiches — leurs valeurs continuent d'alimenter le prefill de
 *   génération et `descriptionSourceFieldKey` via le slot.
 * - `visibility="team"` (ex-ShootEvent « Tournage ») : scoping par rôle,
 *   mêmes règles que l'ancien eventScope :
 *     ADMIN    → tout.
 *     VIDEASTE → vidéaste de la fiche OU d'un reel rattaché.
 *     MONTEUR  → défaut monteur OU un reel rattaché qui lui est assigné.
 *     CM       → symétrique (défaut CM OU reel CM assigné).
 *     EXTERNAL → rien.
 *
 * Deuxième filtre pour toute l'équipe : une fiche en attente de validation
 * admin (ou refusée) reste invisible — elle décrit une demande que l'équipe
 * n'a pas encore acceptée, il n'y a rien à y faire.
 *
 * Garde-fou (validé à la création du type) : un type `team` DOIT avoir
 * `hasAssignees=true`, sinon son scope serait vide pour toute l'équipe.
 *
 * @module entityScope
 */

import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/types/roles";

/**
 * Statuts de validation qui rendent une fiche visible par l'équipe.
 *
 * `null` = aucune validation requise (fiche créée par l'équipe elle-même) ;
 * `APPROVED` = l'admin a validé la commande. Les autres (`PENDING_ADMIN`,
 * `REJECTED`) décrivent une demande client non tranchée : le tournage ne doit
 * pas encore apparaître dans la liste d'un vidéaste.
 *
 * `PENDING_CLIENT` / `REJECTED_CLIENT` restent visibles : ils concernent
 * l'accord du client, pas la décision de l'équipe, et ne bloquent pas la
 * production (cf. `assertEntityValidated` dans slotService).
 */
export const ENTITY_TEAM_HIDDEN_VALIDATION_STATUSES = ["PENDING_ADMIN", "REJECTED"] as const;

/**
 * WHERE partiel : exclut les fiches non tranchées par l'admin.
 *
 * Deux détails de forme sont OBLIGATOIRES, et chacun a coûté un bug :
 *
 * 1. La branche `{ validationStatus: null }` explicite. Un `notIn` seul se
 *    traduit par un `NOT IN` SQL, qui vaut UNKNOWN — donc faux — sur une
 *    colonne `NULL` : les fiches créées par l'équipe (le cas majoritaire,
 *    cf. l.33) disparaissaient pour les trois rôles, alors que le pendant
 *    single-resource `isValidatedForTeam(null)` les acceptait. Liste et
 *    détail se contredisaient, d'où des 404 sur des fiches listées ailleurs.
 * 2. L'encapsulation dans `AND`. Les branches de rôle spreadent ce WHERE
 *    À CÔTÉ de leur propre clé `OR` d'assignation : exposer un `OR` ici
 *    écraserait silencieusement celle-là.
 */
function validatedForTeamWhere(): Prisma.EntityWhereInput {
  return {
    AND: [
      {
        OR: [
          { validationStatus: null },
          { validationStatus: { notIn: [...ENTITY_TEAM_HIDDEN_VALIDATION_STATUSES] } },
        ],
      },
    ],
  };
}

/**
 * Même filtre, exporté pour les requêtes qui scopent à la main (worklists,
 * inbox) et n'appellent pas `whereClauseForUserEntity`. Sans ce partage, le
 * filtre était recopié à l'identique sur trois sites — et n'a été corrigé
 * sur aucun.
 */
export function validatedForTeamFilter(): Prisma.EntityWhereInput {
  return validatedForTeamWhere();
}

/** Pendant single-resource de `validatedForTeamWhere`. */
export function isValidatedForTeam(validationStatus: string | null): boolean {
  return !(ENTITY_TEAM_HIDDEN_VALIDATION_STATUSES as readonly string[]).includes(
    validationStatus ?? "",
  );
}

// ---------------------------------------------------------------------------
// whereClauseForUserEntity
// ---------------------------------------------------------------------------

/**
 * WHERE Prisma pour scoper les requêtes Entity selon le rôle.
 * Couvre les DEUX visibilités : les fiches `admin` ne matchent que pour ADMIN,
 * les fiches `team` suivent les règles d'assignation.
 *
 * ```ts
 * const scope = whereClauseForUserEntity(role, userId);
 * const entities = await prisma.entity.findMany({ where: { ...scope } });
 * ```
 *
 * ATTENTION à l'appelant : pour les rôles équipe, la clause retournée porte
 * une clé `AND` (cf. `validatedForTeamWhere`). Un appelant qui ajoute la
 * sienne doit FUSIONNER les deux tableaux — un spread naïf
 * `{ ...scope, AND: [...] }` effacerait le filtre de validation et exposerait
 * des fiches que l'équipe ne doit pas voir.
 */
export function whereClauseForUserEntity(
  role: UserRole,
  userId: string,
): Prisma.EntityWhereInput {
  switch (role) {
    case "ADMIN":
      return {};

    // Même forme que MONTEUR/CM : le vidéaste était le seul rôle sans
    // passerelle vers la fiche depuis un reel qui lui est assigné — il ne
    // voyait alors ni le tournage ni ses rushs partagés, dont son reel dépend
    // pourtant (`needsRushesOverride=false` forcé côté slotService).
    case "VIDEASTE":
      return {
        type: { visibility: "team" },
        ...validatedForTeamWhere(),
        OR: [
          { assigneeVideasteId: userId },
          { shootSlots: { some: { assigneeVideasteId: userId } } },
        ],
      };

    case "MONTEUR":
      return {
        type: { visibility: "team" },
        ...validatedForTeamWhere(),
        OR: [
          { defaultAssigneeMonteurId: userId },
          { shootSlots: { some: { assigneeMonteurId: userId } } },
        ],
      };

    case "CM":
      return {
        type: { visibility: "team" },
        ...validatedForTeamWhere(),
        OR: [
          { defaultAssigneeCmId: userId },
          { shootSlots: { some: { assigneeCmId: userId } } },
        ],
      };

    case "EXTERNAL_GENERATOR":
    default:
      return { id: "__never__" };
  }
}

// ---------------------------------------------------------------------------
// canUserAccessEntity
// ---------------------------------------------------------------------------

/**
 * Forme minimale d'une fiche chargée pour le check d'accès single-resource.
 * `type.visibility` et `shootSlots` (assignés) doivent être inclus.
 */
export interface AccessibleEntity {
  type: { visibility: string };
  validationStatus: string | null;
  assigneeVideasteId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  shootSlots: Array<{
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
    assigneeVideasteId: string | null;
  }>;
}

/**
 * Vrai si l'utilisateur peut accéder à une fiche précise (cohérent avec
 * `whereClauseForUserEntity`). 404 anti-énumération côté routes sinon.
 */
export function canUserAccessEntity(
  entity: AccessibleEntity,
  role: UserRole,
  userId: string,
): boolean {
  if (role === "ADMIN") return true;
  if (entity.type.visibility !== "team") return false;
  if (!isValidatedForTeam(entity.validationStatus)) return false;

  switch (role) {
    case "VIDEASTE":
      return (
        entity.assigneeVideasteId === userId ||
        entity.shootSlots.some((s) => s.assigneeVideasteId === userId)
      );

    case "MONTEUR":
      return (
        entity.defaultAssigneeMonteurId === userId ||
        entity.shootSlots.some((s) => s.assigneeMonteurId === userId)
      );

    case "CM":
      return (
        entity.defaultAssigneeCmId === userId ||
        entity.shootSlots.some((s) => s.assigneeCmId === userId)
      );

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Capacités par rôle
// ---------------------------------------------------------------------------

/** Seul un ADMIN crée une fiche (quel que soit le type). */
export function canCreateEntity(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Attacher un reel/une mission à une fiche : ADMIN, MONTEUR et VIDEASTE
 * (fiches team uniquement — l'appelant doit AUSSI avoir accès à la fiche via
 * `canUserAccessEntity`, vérifié séparément côté service).
 */
export function canAttachSlotToEntity(role: UserRole): boolean {
  return role === "ADMIN" || role === "MONTEUR" || role === "VIDEASTE";
}

/**
 * Écrire le brief d'une fiche — texte ET pièces jointes (vocal, doc, photo).
 *
 * Volontairement aligné sur la whitelist de PATCH (`brief` est ouvert à ADMIN et
 * VIDEASTE), et donc SANS condition d'assignation : le texte et le vocal vivent
 * dans le même bloc à l'écran, ils ne peuvent pas obéir à deux règles
 * différentes. Un vidéaste qui n'a pas accès à la fiche est déjà arrêté en
 * amont par `canUserAccessEntity`.
 */
export function canEditEntityBrief(role: UserRole): boolean {
  return role === "ADMIN" || role === "VIDEASTE";
}

/** Uploader/supprimer des rushs sur une fiche : ADMIN ou le vidéaste assigné. */
export function canUploadEntityRushes(
  entity: { assigneeVideasteId: string | null },
  role: UserRole,
  userId: string,
): boolean {
  if (role === "ADMIN") return true;
  return role === "VIDEASTE" && entity.assigneeVideasteId === userId;
}

// ---------------------------------------------------------------------------
// ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE
// ---------------------------------------------------------------------------

/**
 * Liste blanche des champs modifiables via PATCH /api/entities/[id] par rôle.
 * Seul l'ADMIN touche aux champs structurants (label, fields custom, date,
 * assignés, compte, fiche liée…).
 */
export const ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> = {
  ADMIN: [
    "label",
    // Relâcher le verrou de libellé personnalisé (repasser en automatique).
    "labelIsCustom",
    "fields",
    "isArchived",
    "accountId",
    "relatedEntityId",
    "scheduledAt",
    "endAt",
    "status",
    "assigneeVideasteId",
    "defaultAssigneeMonteurId",
    "defaultAssigneeCmId",
    "notes",
    "brief",
    // Relancer une demande de disponibilité (remise à `null` uniquement — les
    // gardes de valeur sont dans patchEntity). Sans ça, un refus du vidéaste
    // était définitif : lui ne pouvait plus répondre, et l'admin n'avait que la
    // réassignation pour débloquer, ce qui perdait l'assigné d'origine.
    "videasteConfirmation",
    "videasteDeclineReason",
  ],
  // Le vidéaste peut annuler/mettre à jour le statut (ex : shoot reporté),
  // écrire des notes de terrain, amender le brief de tournage (c'est lui qui
  // est sur place et qui sait ce qui a réellement été tourné), et répondre sur
  // sa disponibilité — les gardes de valeur et d'état (fiche validée, vidéaste
  // assigné) sont dans patchEntity.
  VIDEASTE: ["status", "notes", "brief", "videasteConfirmation", "videasteDeclineReason"],
  MONTEUR: ["notes"],
  CM: ["notes"],
  EXTERNAL_GENERATOR: [],
} as const;

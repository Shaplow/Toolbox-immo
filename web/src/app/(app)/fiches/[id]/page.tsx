import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
import { hasTool, TOOLS } from "@/lib/permissions";
import { getEntity } from "@/lib/services/entity/entityService";
import { canAttachSlotToEntity, canUploadEntityRushes } from "@/lib/permissions/entityScope";
import { canCancelSlot } from "@/lib/permissions/slotScope";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import { SYSTEM_ENTITY_TYPE_IDS } from "@/lib/entityTypes";
import { NotFoundError } from "@/lib/services/_runtime/errors";
import { EntityFiche, type EntityFicheData } from "@/components/entities/EntityFiche";
import { longDateTimeFr } from "@/lib/date/formatFr";
import { REEL_ATTACHABLE_SOURCES } from "@/lib/publications/constants";
import type {
  AttachAccountOption,
  AttachRecipeOption,
  AttachShootTypeOption,
} from "@/components/entities/AttachSlotModal";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const entity = await prisma.entity.findUnique({ where: { id }, select: { label: true } });
  return { title: entity?.label ?? "Fiche introuvable" };
}

/**
 * /fiches/[id] — fiche unifiée (Entity). Fusion de biens/[id] et
 * events/[id]. Sections conditionnelles selon les capacités du type — cf.
 * `EntityFiche`.
 */
export default async function EntityDetailPage({ params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  let entity;
  try {
    entity = await getEntity(id, userContext);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const isTeamFiche = entity.type.hasPlanning && entity.type.hasRushes;
  const attachMode: "missions" | "reel" = isTeamFiche ? "reel" : "missions";

  // Recettes disponibles pour l'attache — chemin « missions » (catalogue
  // global) ou « reel » (bindings actifs compatibles du compte de la fiche).
  let recipes: AttachRecipeOption[] = [];
  let accounts: AttachAccountOption[] = [];
  let shootTypes: AttachShootTypeOption[] = [];
  let defaultShootTypeId: string | null = null;
  if (attachMode === "missions") {
    // Ne proposer que les recettes compatibles avec le type de CETTE fiche :
    // createSlot rejette les autres (garde requiresEntityTypeId, avec fallback
    // legacy requiresProperty → « Bien ») — les lister mènerait à des
    // créations partielles.
    const [templates, accs] = await Promise.all([
      prisma.patternTemplate.findMany({
        where: {
          isArchived: false,
          OR: [
            { requiresEntityTypeId: entity.typeId },
            entity.typeId === SYSTEM_ENTITY_TYPE_IDS.bien
              ? { requiresEntityTypeId: null }
              : { requiresEntityTypeId: null, requiresProperty: false },
          ],
        },
        select: { id: true, label: true, source: true },
        orderBy: { label: "asc" },
      }),
      prisma.instagramAccount.findMany({
        select: { id: true, name: true, handle: true },
        orderBy: { handle: "asc" },
      }),
    ]);
    recipes = templates;
    accounts = accs;
  } else {
    // Chemin « reel ». Deux sources de recettes selon que la fiche porte un
    // compte ou non — et le second cas n'est PAS marginal : la commande ne
    // demande plus de compte (« il se choisit au placement »), donc un tournage
    // né d'une commande arrive ici sans compte. Tant que cette branche était un
    // `else if (entity.accountId)`, « Ajouter un reel » y était mort.
    if (entity.accountId) {
      const bindings = await prisma.patternBinding.findMany({
        where: {
          accountId: entity.accountId,
          isActive: true,
          patternTemplate: { source: { in: [...REEL_ATTACHABLE_SOURCES] } },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          customLabel: true,
          patternTemplateId: true,
          patternTemplate: { select: { label: true, source: true } },
        },
      });
      recipes = bindings.map((b) => ({
        id: b.id,
        kind: "binding" as const,
        patternTemplateId: b.patternTemplateId,
        label: patternLabel(b),
        source: b.patternTemplate.source,
      }));
    } else {
      // Sans compte, on propose les recettes elles-mêmes. `attachReelToEntity`
      // accepte `patternTemplateId` ; le reel naîtra sans compte, en banque, et
      // le compte se choisira au placement — la doctrine, pas un pis-aller.
      const templates = await prisma.patternTemplate.findMany({
        where: { isArchived: false, source: { in: [...REEL_ATTACHABLE_SOURCES] } },
        orderBy: { label: "asc" },
        select: { id: true, label: true, source: true },
      });
      recipes = templates.map((t) => ({
        id: t.id,
        kind: "template" as const,
        patternTemplateId: t.id,
        label: t.label,
        source: t.source,
      }));
    }

    // Les types de tournage du modèle de commande de la fiche. Ils n'existent
    // que si la fiche vient d'une commande — sinon le sélecteur ne s'affiche
    // pas du tout, plutôt que de proposer un choix vide.
    if (entity.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: entity.orderId },
        select: {
          shootTypeId: true,
          orderTemplate: {
            select: {
              shootTypes: {
                select: { id: true, label: true, description: true },
                orderBy: { position: "asc" },
              },
              recipes: {
                select: { patternTemplateId: true, shootTypeId: true },
                orderBy: { position: "asc" },
              },
            },
          },
        },
      });
      if (order) {
        shootTypes = order.orderTemplate.shootTypes;
        defaultShootTypeId = order.shootTypeId;
        // Une recette peut être déclenchée par plusieurs types ; `shootTypeId:
        // null` côté commande signifie « commune à tous ». On garde cette
        // sémantique telle quelle : liste vide = proposée quel que soit le type.
        const byTemplate = new Map<string, string[]>();
        for (const r of order.orderTemplate.recipes) {
          if (!r.shootTypeId) continue;
          const list = byTemplate.get(r.patternTemplateId) ?? [];
          list.push(r.shootTypeId);
          byTemplate.set(r.patternTemplateId, list);
        }
        recipes = recipes.map((r) => ({
          ...r,
          shootTypeIds: r.patternTemplateId ? (byTemplate.get(r.patternTemplateId) ?? []) : [],
        }));
      }
    }
  }

  const isAdmin = userContext.canAdminBypass;

  // Listes d'assignés pour la section « Planning & équipe » (admin, types à
  // planning uniquement).
  const [videastes, monteurs, cms] =
    isAdmin && entity.type.hasPlanning
      ? await Promise.all([
          prisma.user.findMany({
            where: { role: { in: ["VIDEASTE", "ADMIN"] } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          prisma.user.findMany({
            where: { role: { in: ["MONTEUR", "ADMIN"] } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          prisma.user.findMany({
            where: { role: { in: ["CM", "ADMIN"] } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
        ])
      : [[], [], []];

  const canMarkShot = entity.type.hasPlanning && (role === "ADMIN" || role === "VIDEASTE");
  const canUploadRushes = canUploadEntityRushes(
    { assigneeVideasteId: entity.assigneeVideasteId },
    role,
    userId,
  );
  const canManageRushes = role === "ADMIN";
  // Retirer un reel sans rushs : miroir de canCancelSlot côté serveur.
  const canCancel = canCancelSlot(role);
  const canAttachSlot =
    attachMode === "reel"
      ? canAttachSlotToEntity(role)
      : isAdmin || (await hasTool(userId, TOOLS.MISSION));

  const data: EntityFicheData = {
    id: entity.id,
    typeId: entity.typeId,
    typeName: entity.type.name,
    typeIcon: entity.type.icon,
    typeNamePlural: entity.type.namePlural,
    hasPlanning: entity.type.hasPlanning,
    hasAccount: entity.type.hasAccount,
    hasRushes: entity.type.hasRushes,
    hasAssignees: entity.type.hasAssignees,
    visibility: entity.type.visibility === "team" ? "team" : "admin",
    label: entity.label,
    labelIsCustom: entity.labelIsCustom,
    labelTemplate: entity.type.labelTemplate,
    isArchived: entity.isArchived,
    validationStatus: (entity.validationStatus as EntityFicheData["validationStatus"]) ?? null,
    needsClientValidation: entity.type.needsClientValidation,
    fieldSchema: entity.type.fieldSchema,
    fields: entity.fields,
    status: (entity.status as EntityFicheData["status"]) ?? null,
    accountId: entity.accountId,
    accountLabel: entity.account?.handle ?? null,
    scheduledAt: entity.scheduledAt ? entity.scheduledAt.toISOString() : null,
    scheduledAtLabel: entity.scheduledAt ? longDateTimeFr(entity.scheduledAt) : null,
    assigneeVideasteId: entity.assigneeVideasteId,
    assigneeVideasteName: entity.assigneeVideaste?.name ?? null,
    videasteConfirmation:
      (entity.videasteConfirmation as EntityFicheData["videasteConfirmation"]) ?? null,
    videasteConfirmationAt: entity.videasteConfirmationAt
      ? entity.videasteConfirmationAt.toISOString()
      : null,
    videasteDeclineReason: entity.videasteDeclineReason,
    defaultAssigneeMonteurId: entity.defaultAssigneeMonteurId,
    defaultAssigneeCmId: entity.defaultAssigneeCmId,
    notes: entity.notes,
    relatedEntityId: entity.relatedEntityId,
    relatedLabel: entity.related?.label ?? null,
    orderId: entity.orderId,
    orderLabel: entity.order?.orderTemplate.name ?? null,
    slots: entity.slots.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
    })),
    shootSlots: entity.shootSlots.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
    })),
    rushes: entity.rushes.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      durationSec: r.durationSec,
      uploadedAt: r.uploadedAt.toISOString(),
      uploadedByUserId: r.uploadedBy?.id ?? "",
      uploadedBy: r.uploadedBy ? { id: r.uploadedBy.id, name: r.uploadedBy.name, email: null } : null,
    })),
    activities: entity.activities.map((a) => ({
      id: a.id,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
      actorName: a.actor?.name ?? null,
    })),
  };

  // Admin-visibility fiches (« Bien ») n'ont pas de vidéaste/planning — on
  // revient à leur propre catalogue de tabs (?type=) plutôt qu'à celui de
  // l'utilisateur courant.
  const backHref = `/fiches?type=${entity.typeId}`;

  return (
    <EntityFiche
      entity={data}
      role={role}
      isAdmin={isAdmin}
      canMarkShot={canMarkShot}
      canUploadRushes={canUploadRushes}
      canManageRushes={canManageRushes}
      canCancelSlot={canCancel}
      canAttachSlot={canAttachSlot}
      attachMode={attachMode}
      recipes={recipes}
      accounts={accounts}
      shootTypes={shootTypes}
      defaultShootTypeId={defaultShootTypeId}
      videastes={videastes.map((u) => ({ id: u.id, name: u.name }))}
      monteurs={monteurs.map((u) => ({ id: u.id, name: u.name }))}
      cms={cms.map((u) => ({ id: u.id, name: u.name }))}
      currentUserId={userId}
      backHref={backHref}
    />
  );
}

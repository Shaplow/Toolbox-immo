import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
import { hasTool, TOOLS } from "@/lib/permissions";
import { getEntity } from "@/lib/services/entity/entityService";
import { canAttachSlotToEntity, canUploadEntityRushes } from "@/lib/permissions/entityScope";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import { NotFoundError } from "@/lib/services/_runtime/errors";
import { PageShell } from "@/components/ui/PageShell";
import { EntityFiche, type EntityFicheData } from "@/components/entities/EntityFiche";
import { longDateTimeFr } from "@/lib/date/formatFr";
import type { AttachAccountOption, AttachRecipeOption } from "@/components/entities/AttachSlotModal";

type Params = { params: Promise<{ id: string }> };

const REEL_ATTACHABLE_SOURCES = ["manual_rushes", "external_upload"] as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const entity = await prisma.entity.findUnique({ where: { id }, select: { label: true } });
  return { title: entity ? `${entity.label} | Fiches` : "Fiche introuvable" };
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
            entity.typeId === "etype_bien"
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
  } else if (entity.accountId) {
    const bindings = await prisma.patternBinding.findMany({
      where: {
        accountId: entity.accountId,
        isActive: true,
        patternTemplate: { source: { in: [...REEL_ATTACHABLE_SOURCES] } },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, customLabel: true, patternTemplate: { select: { label: true, source: true } } },
    });
    recipes = bindings.map((b) => ({
      id: b.id,
      label: patternLabel(b),
      source: b.patternTemplate.source,
    }));
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
    fieldSchema: entity.type.fieldSchema,
    fields: entity.fields,
    status: (entity.status as EntityFicheData["status"]) ?? null,
    accountId: entity.accountId,
    accountLabel: entity.account?.handle ?? null,
    scheduledAt: entity.scheduledAt ? entity.scheduledAt.toISOString() : null,
    scheduledAtLabel: entity.scheduledAt ? longDateTimeFr(entity.scheduledAt) : null,
    assigneeVideasteId: entity.assigneeVideasteId,
    assigneeVideasteName: entity.assigneeVideaste?.name ?? null,
    defaultAssigneeMonteurId: entity.defaultAssigneeMonteurId,
    defaultAssigneeCmId: entity.defaultAssigneeCmId,
    notes: entity.notes,
    relatedEntityId: entity.relatedEntityId,
    relatedLabel: entity.related?.label ?? null,
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
    <PageShell variant="narrow">
      <EntityFiche
        entity={data}
        isAdmin={isAdmin}
        canMarkShot={canMarkShot}
        canUploadRushes={canUploadRushes}
        canManageRushes={canManageRushes}
        canAttachSlot={canAttachSlot}
        attachMode={attachMode}
        recipes={recipes}
        accounts={accounts}
        videastes={videastes.map((u) => ({ id: u.id, name: u.name }))}
        monteurs={monteurs.map((u) => ({ id: u.id, name: u.name }))}
        cms={cms.map((u) => ({ id: u.id, name: u.name }))}
        currentUserId={userId}
        backHref={backHref}
      />
    </PageShell>
  );
}

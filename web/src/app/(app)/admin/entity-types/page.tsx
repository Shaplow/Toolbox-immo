import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { normalizeCustomFields } from "@/lib/customFields";
import { PageShell } from "@/components/ui/PageShell";
import { EntityTypesClient, type EntityTypeRow } from "./EntityTypesClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Types de fiches | Toolbox Immo Admin",
};

/**
 * /admin/entity-types — CRUD des types de fiche (EntityType). Admin-only.
 * Plan simplification Phase 5 (métaobjet) — configure les capacités et le
 * schéma de champs custom des types « Bien »/« Tournage » (système) et des
 * types custom éventuels.
 */
export default async function EntityTypesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const raw = await prisma.entityType.findMany({
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      namePlural: true,
      icon: true,
      fieldSchema: true,
      hasPlanning: true,
      hasAccount: true,
      hasRushes: true,
      hasAssignees: true,
      visibility: true,
      needsAdminValidation: true,
      needsClientValidation: true,
      position: true,
      isSystem: true,
      _count: { select: { entities: true } },
    },
  });

  const types: EntityTypeRow[] = raw.map((t) => ({
    id: t.id,
    name: t.name,
    namePlural: t.namePlural,
    icon: t.icon,
    fieldSchema: normalizeCustomFields(t.fieldSchema),
    hasPlanning: t.hasPlanning,
    hasAccount: t.hasAccount,
    hasRushes: t.hasRushes,
    hasAssignees: t.hasAssignees,
    visibility: t.visibility === "team" ? "team" : "admin",
    needsAdminValidation: t.needsAdminValidation,
    needsClientValidation: t.needsClientValidation,
    position: t.position,
    isSystem: t.isSystem,
    entityCount: t._count.entities,
  }));

  return (
    <PageShell variant="wide">
      <EntityTypesClient initialTypes={types} />
    </PageShell>
  );
}

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { PageShell } from "@/components/ui/PageShell";
import { listOrderTemplates } from "@/lib/services/order/orderTemplateService";
import { OrderTemplatesClient, type OrderTemplateRow } from "./OrderTemplatesClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Modèles de commande | Toolbox Immo Admin",
};

/**
 * /admin/order-templates — CRUD des modèles de bons de commande. Admin-only.
 * Un modèle = composition (types de fiches + recettes×count) + allowlist
 * clients. Les agences créent leurs commandes depuis ces modèles (/commandes).
 */
export default async function OrderTemplatesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const [templates, entityTypes, patternTemplates, clients] = await Promise.all([
    listOrderTemplates({ includeArchived: true }),
    prisma.entityType.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true, hasPlanning: true, hasRushes: true },
    }),
    prisma.patternTemplate.findMany({
      where: { isArchived: false },
      orderBy: { label: "asc" },
      select: { id: true, label: true, source: true },
    }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: OrderTemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isArchived: t.isArchived,
    position: t.position,
    items: t.items.map((i) => ({
      entityTypeId: i.entityTypeId,
      entityTypeName: i.entityType.name,
    })),
    recipes: t.recipes.map((r) => ({
      patternTemplateId: r.patternTemplateId,
      label: r.patternTemplate.label,
      count: r.count,
    })),
    clientIds: t.accesses.map((a) => a.clientId),
    clientNames: t.accesses.map((a) => a.client.name),
    orderCount: t._count.orders,
  }));

  return (
    <PageShell variant="wide">
      <OrderTemplatesClient
        initialTemplates={rows}
        entityTypes={entityTypes}
        patternTemplates={patternTemplates}
        clients={clients}
      />
    </PageShell>
  );
}

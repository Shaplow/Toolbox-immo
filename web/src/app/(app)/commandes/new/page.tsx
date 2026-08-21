import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { PageShell } from "@/components/ui/PageShell";
import { toUserRole } from "@/lib/permissions/role";
import { canSeeOrders } from "@/lib/permissions/orderScope";
import { normalizeCustomFields } from "@/lib/customFields";
import { NewOrderClient, type OrderTemplateOption } from "./NewOrderClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nouvelle commande | Toolbox Immo",
};

/**
 * /commandes/new — formulaire guidé de bon de commande.
 * Externe : modèles de son allowlist + comptes de son agence.
 * Admin : tous les modèles + choix du client (commande au nom d'un client).
 */
export default async function NewOrderPage() {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) redirect("/login");
  const role = toUserRole(ctx.effectiveUser.role);
  const clientId = ctx.effectiveUser.clientId ?? null;
  if (!canSeeOrders(role, clientId)) redirect("/home");
  const isAdmin = ctx.canAdminBypass;

  const templatesRaw = await prisma.orderTemplate.findMany({
    where: {
      isArchived: false,
      ...(isAdmin ? {} : { accesses: { some: { clientId: clientId ?? "__never__" } } }),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          entityTypeId: true,
          entityType: {
            select: {
              id: true,
              name: true,
              hasPlanning: true,
              hasAccount: true,
              fieldSchema: true,
            },
          },
        },
      },
      recipes: {
        select: { count: true, patternTemplate: { select: { label: true } } },
      },
    },
  });

  const templates: OrderTemplateOption[] = templatesRaw.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    items: t.items.map((i) => ({
      entityTypeId: i.entityTypeId,
      typeName: i.entityType.name,
      hasPlanning: i.entityType.hasPlanning,
      hasAccount: i.entityType.hasAccount,
      fieldSchema: normalizeCustomFields(i.entityType.fieldSchema),
    })),
    videoSummary: t.recipes
      .map((r) => (r.count > 1 ? `${r.patternTemplate.label} ×${r.count}` : r.patternTemplate.label))
      .join(", "),
  }));

  // Comptes : ceux de l'agence (externe) ou tous avec leur client (admin).
  const accounts = await prisma.instagramAccount.findMany({
    where: isAdmin ? { clientId: { not: null } } : { clientId: clientId ?? "__never__" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true, clientId: true },
  });

  const clients = isAdmin
    ? await prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <PageShell variant="default">
      <NewOrderClient
        templates={templates}
        accounts={accounts}
        clients={clients}
        isAdmin={isAdmin}
      />
    </PageShell>
  );
}

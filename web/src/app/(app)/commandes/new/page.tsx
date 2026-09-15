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
  title: "Nouvelle commande",
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
          shootTypes: { select: { shootTypeId: true } },
          entityType: {
            select: {
              id: true,
              name: true,
              hasPlanning: true,
              hasAccount: true,
              fieldSchema: true,
              labelTemplate: true,
            },
          },
        },
      },
      recipes: {
        select: {
          patternTemplateId: true,
          count: true,
          isOptional: true,
          defaultSelected: true,
          minCount: true,
          shootTypeId: true,
          patternTemplate: {
            select: { label: true, clientLabel: true, clientDescription: true },
          },
        },
        orderBy: { position: "asc" },
      },
      shootTypes: {
        select: { id: true, label: true, description: true, videosDecidedLater: true },
        orderBy: { position: "asc" },
      },
    },
  });

  /** Le client ne voit jamais « RVA1 » : le libellé interne est un repli. */
  const clientFacing = (r: {
    patternTemplate: { label: string; clientLabel: string | null };
  }) => r.patternTemplate.clientLabel ?? r.patternTemplate.label;

  const templates: OrderTemplateOption[] = templatesRaw.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    items: t.items.map((i) => ({
      entityTypeId: i.entityTypeId,
      // Vide = la fiche est demandée quel que soit le type de tournage.
      shootTypeIds: i.shootTypes.map((st) => st.shootTypeId),
      typeName: i.entityType.name,
      hasPlanning: i.entityType.hasPlanning,
      hasAccount: i.entityType.hasAccount,
      fieldSchema: normalizeCustomFields(i.entityType.fieldSchema),
      labelTemplate: i.entityType.labelTemplate,
    })),
    recipes: t.recipes.map((r) => ({
      patternTemplateId: r.patternTemplateId,
      label: clientFacing(r),
      description: r.patternTemplate.clientDescription,
      count: r.count,
      isOptional: r.isOptional,
      defaultSelected: r.defaultSelected,
      minCount: r.minCount,
      shootTypeId: r.shootTypeId,
    })),
    shootTypes: t.shootTypes.map((st) => ({
      id: st.id,
      label: st.label,
      description: st.description,
      videosDecidedLater: st.videosDecidedLater,
      // Ce que CE type produit — le second signal qui rend les types
      // comparables avant de choisir, à côté de la description. Même règle que
      // `videoCount` : imposées + optionnelles pré-cochées, communes comprises.
      videoCount: t.recipes
        .filter((r) => (!r.isOptional || r.defaultSelected) && (!r.shootTypeId || r.shootTypeId === st.id))
        .reduce((n, r) => n + r.count, 0),
    })),
    // Résumé / compteur : seulement les vidéos IMPOSÉES et les optionnelles
    // pré-cochées — annoncer « 5 vidéos » alors que deux sont décochées par
    // défaut serait faux dès l'ouverture du formulaire.
    //
    // Quand le modèle propose des types de tournage, ce résumé ne compte que
    // les vidéos COMMUNES : les autres dépendent d'un choix pas encore fait, et
    // additionner tous les types annoncerait un nombre que personne ne recevra.
    videoSummary: t.recipes
      .filter((r) => (!r.isOptional || r.defaultSelected) && !r.shootTypeId)
      .map((r) => (r.count > 1 ? `${clientFacing(r)} ×${r.count}` : clientFacing(r)))
      .join(", "),
    videoCount: t.recipes
      .filter((r) => (!r.isOptional || r.defaultSelected) && !r.shootTypeId)
      .reduce((n, r) => n + r.count, 0),
  }));

  const clients = isAdmin
    ? await prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <PageShell variant="default">
      <NewOrderClient
        templates={templates}
        clients={clients}
        isAdmin={isAdmin}
      />
    </PageShell>
  );
}

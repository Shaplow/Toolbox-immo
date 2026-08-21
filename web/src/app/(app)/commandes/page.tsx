import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { PageShell } from "@/components/ui/PageShell";
import { toUserRole } from "@/lib/permissions/role";
import { canSeeOrders } from "@/lib/permissions/orderScope";
import { listOrders } from "@/lib/services/order/orderService";
import { CommandesListClient, type PendingClientFiche } from "./CommandesListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Commandes | Toolbox Immo",
};

/**
 * /commandes — bons de commande, surface unique role-aware :
 *  - ADMIN : toutes les commandes (triage : soumises à valider en tête).
 *  - EXTERNAL rattaché à un client : ses commandes + ses fiches à valider
 *    (validation client, non bloquante) + CTA nouvelle commande.
 */
export default async function CommandesPage() {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) redirect("/login");
  const role = toUserRole(ctx.effectiveUser.role);
  const clientId = ctx.effectiveUser.clientId ?? null;
  if (!canSeeOrders(role, clientId)) redirect("/home");

  const isAdmin = ctx.canAdminBypass;
  const orders = await listOrders({}, ctx);

  // Fiches en attente de validation client dans le périmètre de l'agence
  // (via sa commande OU le compte du client — couvre les fiches créées par
  // l'équipe hors commande).
  let pendingFiches: PendingClientFiche[] = [];
  if (!isAdmin && clientId) {
    const rows = await prisma.entity.findMany({
      where: {
        validationStatus: "PENDING_CLIENT",
        isArchived: false,
        OR: [{ order: { clientId } }, { account: { clientId } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        label: true,
        type: { select: { name: true } },
        orderId: true,
      },
    });
    pendingFiches = rows.map((r) => ({
      id: r.id,
      label: r.label,
      typeName: r.type.name,
      orderId: r.orderId,
    }));
  }

  return (
    <PageShell variant="wide">
      <CommandesListClient orders={orders} isAdmin={isAdmin} pendingFiches={pendingFiches} />
    </PageShell>
  );
}

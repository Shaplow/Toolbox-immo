import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { PageShell } from "@/components/ui/PageShell";
import { toUserRole } from "@/lib/permissions/role";
import { canSeeOrders } from "@/lib/permissions/orderScope";
import { getOrder } from "@/lib/services/order/orderService";
import { NotFoundError } from "@/lib/services/_runtime/errors";
import { prisma } from "@/lib/prisma";
import type { EntityRush } from "@/components/entities/EntityRushesPanel";
import { OrderDetailClient, type OrderShootRushes } from "./OrderDetailClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Commande | Toolbox Immo",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * /commandes/[id] — détail d'un bon de commande, role-aware.
 * Admin : validation/refus, fiches, publications instanciées + placement.
 * Externe : suivi simplifié, édition des fiches tant que SUBMITTED/REJECTED.
 */
export default async function OrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) redirect("/login");
  const role = toUserRole(ctx.effectiveUser.role);
  if (!canSeeOrders(role, ctx.effectiveUser.clientId ?? null)) redirect("/home");

  let order;
  try {
    order = await getOrder(id, ctx);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  // Rushs du tournage de la commande — admin uniquement (panel partagé avec
  // la fiche). L'agence ne voit jamais les rushs.
  let shootRushes: OrderShootRushes | null = null;
  if (ctx.canAdminBypass) {
    const shootEntity = await prisma.entity.findFirst({
      where: { orderId: id, type: { hasPlanning: true, hasRushes: true } },
      select: {
        id: true,
        label: true,
        rushes: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            durationSec: true,
            uploadedAt: true,
            uploadedByUserId: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (shootEntity) {
      const rushes: EntityRush[] = shootEntity.rushes.map((r) => ({
        ...r,
        uploadedAt: r.uploadedAt.toISOString(),
      }));
      shootRushes = { entityId: shootEntity.id, label: shootEntity.label, rushes };
    }
  }

  return (
    <PageShell variant="default">
      <OrderDetailClient
        order={order}
        isAdmin={ctx.canAdminBypass}
        shootRushes={shootRushes}
        currentUserId={ctx.effectiveUser.id}
      />
    </PageShell>
  );
}

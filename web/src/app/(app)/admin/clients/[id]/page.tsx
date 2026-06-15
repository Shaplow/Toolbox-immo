/**
 * /admin/clients/[id] — fiche client (server component).
 *
 * Ticket F6 du plan recentré. La page a été convertie de client component
 * (useEffect + fetch + spinner initial) à server component qui :
 * - Gate via getUserContext + actualUser.role === "ADMIN".
 * - Fetch client + tous les comptes IG via Prisma directement.
 * - Passe initialData à ClientDetailClient (UI/state interactif).
 *
 * Bénéfices : pas de spinner au load (hydration directe), gating
 * serveur (vs client-side qui flicker), cohérence avec les autres
 * pages admin (clients liste, accounts liste, etc.).
 */

import { notFound, redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { ClientDetailClient, type ClientDetailAccountStub, type ClientDetailData } from "./ClientDetailClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  const ctx = await getUserContext();
  if (!ctx?.actualUser || ctx.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const [client, allAccounts] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        accounts: {
          select: { id: true, name: true, handle: true },
          orderBy: { name: "asc" },
        },
      },
    }),
    prisma.instagramAccount.findMany({
      // Exclut les comptes sentinels (curseurs partagés) du pool affiché.
      where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
      select: {
        id: true,
        name: true,
        handle: true,
        clientId: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!client) {
    notFound();
  }

  const initialClient: ClientDetailData = {
    id: client.id,
    name: client.name,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    accounts: client.accounts,
  };

  const initialAccounts: ClientDetailAccountStub[] = allAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    clientId: a.clientId,
    client: a.client,
  }));

  return (
    <ClientDetailClient
      clientId={id}
      initialClient={initialClient}
      initialAccounts={initialAccounts}
    />
  );
}

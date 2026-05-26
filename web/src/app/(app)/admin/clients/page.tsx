import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ClientsListAdmin, type ClientItem } from "@/components/admin/ClientsListAdmin";

export const dynamic = "force-dynamic";

export default async function AdminClientsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      createdAt: true,
      accounts: {
        select: { id: true, name: true, handle: true },
        orderBy: { handle: "asc" },
      },
    },
  });

  const items: ClientItem[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    createdAt: c.createdAt.toISOString(),
    accounts: c.accounts,
  }));

  return <ClientsListAdmin initialClients={items} />;
}

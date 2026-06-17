import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ClientsListAdmin, type ClientItem } from "@/components/admin/ClientsListAdmin";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { KPIPill } from "@/components/ui/molecules/KPIPill";

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

  const totalAccounts = items.reduce((acc, c) => acc + c.accounts.length, 0);

  return (
    <PageShell variant="wide">
      <div className="px-6 sm:px-8 pt-6 pb-12">
        <ToolPageHeader
          icon={Building2}
          title="Clients"
          kpis={
            <>
              <KPIPill label="Clients" value={items.length} />
              <KPIPill label="Comptes IG" value={totalAccounts} />
            </>
          }
        />
        <ClientsListAdmin initialClients={items} />
      </div>
    </PageShell>
  );
}

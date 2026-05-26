import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { AccountsListAdmin } from "@/components/admin/AccountsListAdmin";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const accounts = await prisma.instagramAccount.findMany({
    select: {
      id: true,
      handle: true,
      name: true,
      offre: true,
      client: { select: { id: true, name: true } },
      accountPatterns: {
        where: { isActive: true },
        select: { id: true },
      },
      publicationSlots: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
    orderBy: [{ client: { name: "asc" } }, { handle: "asc" }],
  });

  const accountItems = accounts.map((a) => ({
    id: a.id,
    handle: a.handle,
    name: a.name,
    offre: a.offre ?? "",
    activePatternCount: a.accountPatterns.length,
    lastPublishedAt: a.publicationSlots[0]?.publishedAt?.toISOString() ?? null,
    client: a.client,
  }));

  return <AccountsListAdmin accounts={accountItems} />;
}

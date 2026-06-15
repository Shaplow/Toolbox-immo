import { redirect } from "next/navigation";
import { Instagram } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { AccountsListAdmin } from "@/components/admin/AccountsListAdmin";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { KPIPill } from "@/components/ui/molecules/KPIPill";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const accounts = await prisma.instagramAccount.findMany({
    // Masque les comptes sentinels (curseurs partagés) du listing admin.
    where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
    select: {
      id: true,
      handle: true,
      name: true,
      client: { select: { id: true, name: true } },
      // P2 — KPI piloté désormais par patternBindings (recettes liées).
      patternBindings: {
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
    activePatternCount: a.patternBindings.length,
    lastPublishedAt: a.publicationSlots[0]?.publishedAt?.toISOString() ?? null,
    client: a.client,
  }));

  const totalBindings = accountItems.reduce((acc, a) => acc + a.activePatternCount, 0);

  return (
    <PageShell variant="wide">
      <div className="px-6 sm:px-8 pt-6 pb-12">
        <ToolPageHeader
          icon={Instagram}
          title="Comptes Instagram"
          subtitle="Tous les comptes IG et leurs recettes appliquées."
          iconTint="peach"
          kpis={
            <>
              <KPIPill label="Comptes" value={accountItems.length} tint="peach" />
              <KPIPill label="Recettes actives" value={totalBindings} tint="sky" />
            </>
          }
        />
        <AccountsListAdmin accounts={accountItems} />
      </div>
    </PageShell>
  );
}

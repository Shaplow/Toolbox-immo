import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Instagram } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { AccountPatternsList } from "@/components/admin/AccountPatternsList";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { handle: true },
  });
  return { title: `@${account?.handle ?? "Compte"} | Toolbox Immo Admin` };
}

export default async function AccountFichePage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      accountPatterns: {
        orderBy: [{ publishTime: "asc" }, { label: "asc" }],
        include: {
          template: { select: { id: true, name: true } },
          defaultAssigneeMonteur: { select: { id: true, name: true } },
          defaultAssigneeCm: { select: { id: true, name: true } },
          _count: { select: { publicationSlots: true } },
        },
      },
    },
  });

  if (!account) notFound();

  return (
    <div className="p-8 max-w-screen-xl mx-auto">
      {/* Breadcrumb */}
      <Link
        href={account.client ? `/admin/clients/${account.client.id}?tab=accounts` : "/admin/clients"}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ChevronLeft size={13} />
        {account.client?.name ?? "Clients"}
      </Link>

      {/* Header */}
      <ToolPageHeader
        icon={Instagram}
        iconColor="indigo"
        title={`@${account.handle}`}
        subtitle={`${account.client?.name ?? "Sans client"}`}
      />

      {/* Section Patterns */}
      <AccountPatternsList
        account={{ id: account.id, handle: account.handle }}
        patterns={account.accountPatterns}
      />

      {/* F3.3 — Lien direct vers le calendrier filtré (la section "Slots récents"
           placeholder a été retirée car elle donnait l'impression d'une feature
           inachevée). */}
      <div className="mt-10 pt-6 border-t border-gray-100">
        <Link
          href={`/calendar?accountId=${account.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Voir les slots de ce compte dans le calendrier →
        </Link>
      </div>
    </div>
  );
}

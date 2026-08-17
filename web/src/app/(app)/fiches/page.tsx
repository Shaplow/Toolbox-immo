import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
import { normalizeCustomFields } from "@/lib/customFields";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { PageShell } from "@/components/ui/PageShell";
import { FichesListClient } from "./FichesListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fiches | Toolbox Immo Admin",
};

interface PageProps {
  searchParams: Promise<{ type?: string }>;
}

/**
 * /fiches — surface unifiée « Fiches » (plan simplification Phase 5 —
 * métaobjet). Fusionne les anciennes surfaces `/biens` et `/events` sur le
 * modèle Entity/EntityType : un tab par type, liste ou planning selon les
 * capacités du type. Le détail (liste des fiches par type) est chargé
 * côté client (`/api/entities?typeId=`) — la page ne fournit que les types
 * et les listes d'assignés/comptes nécessaires aux modals admin.
 */
export default async function FichesPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  if (role === "EXTERNAL_GENERATOR") redirect("/home");

  const isAdmin = userContext.canAdminBypass;

  const rawTypes = await prisma.entityType.findMany({
    where: isAdmin ? {} : { visibility: "team" },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      namePlural: true,
      icon: true,
      fieldSchema: true,
      hasPlanning: true,
      hasAccount: true,
      hasRushes: true,
      hasAssignees: true,
      visibility: true,
      position: true,
      isSystem: true,
    },
  });

  const types = rawTypes.map((t) => ({
    ...t,
    fieldSchema: normalizeCustomFields(t.fieldSchema),
    visibility: t.visibility === "team" ? ("team" as const) : ("admin" as const),
  }));

  const { type: typeParam } = await searchParams;
  const selectedTypeId = types.some((t) => t.id === typeParam) ? typeParam! : (types[0]?.id ?? "");

  // Données des modals admin (création / attache) — chargées une fois, pas
  // par type (léger, ~qq dizaines de lignes max).
  const [accounts, videastes, monteurs, cms] = isAdmin
    ? await Promise.all([
        prisma.instagramAccount.findMany({
          where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, handle: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["VIDEASTE", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["MONTEUR", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["CM", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], [], [], []];

  return (
    <PageShell variant="wide">
      <FichesListClient
        types={types}
        initialSelectedTypeId={selectedTypeId}
        isAdmin={isAdmin}
        accounts={accounts}
        videastes={videastes.map((u) => ({ id: u.id, name: u.name }))}
        monteurs={monteurs.map((u) => ({ id: u.id, name: u.name }))}
        cms={cms.map((u) => ({ id: u.id, name: u.name }))}
      />
    </PageShell>
  );
}

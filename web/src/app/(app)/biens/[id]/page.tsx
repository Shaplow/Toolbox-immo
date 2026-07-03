import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { safeJSON } from "@/lib/utils/json";
import { BienEditorClient } from "./BienEditorClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const p = await prisma.property.findUnique({
    where: { id },
    select: { label: true },
  });
  return { title: p ? `${p.label} | Biens` : "Bien introuvable" };
}

/**
 * /biens/[id] — éditeur d'un bien (Property).
 *
 * Admin-only. Charge le bien depuis Prisma, délègue le rendu
 * au composant client BienEditorClient.
 */
export default async function BienEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [userContext, { id }] = await Promise.all([getUserContext(), params]);
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const [property, recipes, accounts] = await Promise.all([
    prisma.property.findUnique({
      where: { id },
      select: {
        id: true,
        label: true,
        fields: true,
        fieldSchema: true,
        updatedAt: true,
        isArchived: true,
      },
    }),
    prisma.patternTemplate.findMany({
      where: { isArchived: false },
      select: { id: true, label: true, source: true },
      orderBy: { label: "asc" },
    }),
    prisma.instagramAccount.findMany({
      select: { id: true, name: true, handle: true },
      orderBy: { handle: "asc" },
    }),
  ]);

  if (!property || property.isArchived) notFound();

  return (
    <BienEditorClient
      id={property.id}
      initialLabel={property.label}
      initialFields={safeJSON<Record<string, string>>(property.fields, {})}
      initialFieldSchema={safeJSON<string[]>(property.fieldSchema, [])}
      recipes={recipes}
      accounts={accounts}
    />
  );
}

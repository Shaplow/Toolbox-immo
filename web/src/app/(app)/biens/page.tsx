import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { safeJSON } from "@/lib/utils/json";
import { BiensListClient, type BienListItem } from "./BiensListClient";

const DEFAULT_SCHEMA_KEY = "property.defaultFieldSchema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Biens | Toolbox Immo Admin",
};

/**
 * /biens — liste des biens (Property) non archivés.
 *
 * Admin-only. Un bien est une fiche de données partagée (adresse, prix, etc.)
 * référencée par N missions (PublicationSlot.propertyId).
 */
export default async function BiensPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const [raw, defaultSetting] = await Promise.all([
    prisma.property.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        label: true,
        fieldSchema: true,
        updatedAt: true,
        _count: { select: { slots: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.appSetting.findUnique({ where: { key: DEFAULT_SCHEMA_KEY } }),
  ]);

  const biens: BienListItem[] = raw.map((p) => ({
    id: p.id,
    label: p.label,
    fieldSchema: safeJSON<string[]>(p.fieldSchema, []),
    updatedAt: p.updatedAt.toISOString(),
    slotCount: p._count.slots,
  }));

  const defaultFieldSchema = defaultSetting
    ? safeJSON<string[]>(defaultSetting.value, [])
    : [];

  return <BiensListClient initialBiens={biens} defaultFieldSchema={defaultFieldSchema} />;
}

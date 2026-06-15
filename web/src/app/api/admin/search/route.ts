/**
 * GET /api/admin/search?q=<query>
 *
 * Recherche globale ADMIN (Cmd+K dans la UI). Cherche en parallèle dans:
 *   - Clients (name)
 *   - InstagramAccount (handle, name) + client lié
 *   - Template (name)
 *   - CaptionPreset (name)
 *   - PublicationSlot récents (title, account.handle)
 *   - MediaLibrary (name)
 *   - DataLibrary (name)
 *   - DataCampaign (name) + parent library
 *
 * Retourne max 5 résultats par catégorie. Query <2 chars → []. ADMIN-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";

export type SearchResultItem = {
  kind:
    | "client"
    | "account"
    | "template"
    | "preset"
    | "slot"
    | "mediaLibrary"
    | "dataLibrary"
    | "dataCampaign";
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Limit per category to keep payload small.
  const TAKE = 5;
  const contains = { contains: q, mode: "insensitive" as const };

  const [
    clients,
    accounts,
    templates,
    presets,
    slots,
    mediaLibraries,
    dataLibraries,
    dataCampaigns,
  ] = await Promise.all([
    prisma.client.findMany({
      where: { name: contains },
      orderBy: { name: "asc" },
      take: TAKE,
      select: { id: true, name: true },
    }),
    prisma.instagramAccount.findMany({
      where: {
        AND: [
          { id: { notIn: [...SHARED_SENTINEL_IDS] } },
          { OR: [{ handle: contains }, { name: contains }] },
        ],
      },
      orderBy: { handle: "asc" },
      take: TAKE,
      select: {
        id: true,
        handle: true,
        name: true,
        client: { select: { name: true } },
      },
    }),
    prisma.template.findMany({
      where: { name: contains },
      orderBy: { updatedAt: "desc" },
      take: TAKE,
      select: { id: true, name: true, client: true },
    }),
    prisma.captionPreset.findMany({
      where: { name: contains },
      orderBy: { name: "asc" },
      take: TAKE,
      select: { id: true, name: true },
    }),
    prisma.publicationSlot.findMany({
      where: {
        OR: [
          { title: contains },
          { account: { handle: contains } },
        ],
      },
      orderBy: { scheduledAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        account: { select: { handle: true } },
      },
    }),
    prisma.mediaLibrary.findMany({
      where: { name: contains },
      orderBy: { name: "asc" },
      take: TAKE,
      select: { id: true, name: true, type: true },
    }),
    prisma.dataLibrary.findMany({
      where: { name: contains },
      orderBy: { name: "asc" },
      take: TAKE,
      select: { id: true, name: true, templateType: true },
    }),
    prisma.dataCampaign.findMany({
      where: { name: contains },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      select: {
        id: true,
        name: true,
        libraryId: true,
        library: { select: { name: true } },
      },
    }),
  ]);

  const results: SearchResultItem[] = [
    ...clients.map((c) => ({
      kind: "client" as const,
      id: c.id,
      label: c.name,
      sublabel: "Client",
      href: `/admin/clients/${c.id}`,
    })),
    ...accounts.map((a) => ({
      kind: "account" as const,
      id: a.id,
      label: `@${a.handle}`,
      sublabel: a.client?.name ?? a.name,
      href: `/admin/accounts/${a.id}`,
    })),
    ...templates.map((t) => ({
      kind: "template" as const,
      id: t.id,
      label: t.name,
      sublabel: t.client,
      href: `/templates/${t.id}/edit`,
    })),
    ...presets.map((p) => ({
      kind: "preset" as const,
      id: p.id,
      label: p.name,
      sublabel: "Preset captions",
      href: `/admin/captions/presets/${p.id}/edit`,
    })),
    ...slots.map((s) => ({
      kind: "slot" as const,
      id: s.id,
      label:
        s.title ??
        (s.scheduledAt
          ? `Publication du ${s.scheduledAt.toLocaleDateString("fr-FR")}`
          : "Publication en banque"),
      sublabel: `@${s.account.handle}`,
      href: `/publications/${s.id}`,
    })),
    ...mediaLibraries.map((m) => ({
      kind: "mediaLibrary" as const,
      id: m.id,
      label: m.name,
      sublabel: `Bibliothèque médias · ${m.type === "audio" ? "audio" : "vidéo"}`,
      href: `/admin/libraries/media/${m.id}`,
    })),
    ...dataLibraries.map((d) => ({
      kind: "dataLibrary" as const,
      id: d.id,
      label: d.name,
      sublabel: `Bibliothèque données · ${d.templateType}`,
      href: `/admin/libraries/data/${d.id}`,
    })),
    ...dataCampaigns.map((c) => ({
      kind: "dataCampaign" as const,
      id: c.id,
      label: c.name,
      sublabel: c.library?.name ? `Campagne · ${c.library.name}` : "Campagne",
      href: `/admin/libraries/data/${c.libraryId}/${c.id}`,
    })),
  ];

  return NextResponse.json({ results });
}

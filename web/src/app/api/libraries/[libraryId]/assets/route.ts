import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ libraryId: string }> };

// GET /api/libraries/[libraryId]/assets
// Auth-gated (no admin required) — returns public asset list for a library.
// Used by the generation form library picker for all authenticated users.
export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Optional tag filter — case-insensitive
  const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase() ?? "";

  const assets = await prisma.mediaAsset.findMany({
    where: {
      libraryId,
      ...(tag ? { tags: { contains: `"${tag}"`, mode: "insensitive" } } : {}),
    },
    orderBy: [{ lastUsedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      filename: true,
      url: true,
      mimeType: true,
      duration: true,
      usageCount: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json(assets);
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

// GET /api/admin/libraries/data — liste les DataLibrary (+ nombre de fiches + dossiers)
export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const [libraries, folderRows] = await Promise.all([
      prisma.dataLibrary.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          // Plan simplification Phase 4 — le wrapper DataCampaign est décommissionné,
          // les fiches sont comptées directement (libraryId direct).
          _count: { select: { entries: true } },
        },
      }),
      // Dossiers (DataEntry.setTag) de TOUTES les libs en une passe — alimente
      // le picker « Dossier » des recettes (PatternTemplate.descriptionDataSetTag).
      // Volontairement non filtré par DataEntryAccess : une recette est partagée
      // par N comptes, le compte affiché est une indication de configuration et
      // non une garantie de ce que le compte X verra au tirage (buildDataAccessFilter
      // s'applique côté selectDataEntry).
      prisma.dataEntry.groupBy({
        by: ["libraryId", "setTag"],
        where: { setTag: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const foldersByLibrary = new Map<string, { setTag: string; count: number }[]>();
    for (const row of folderRows) {
      if (!row.setTag) continue;
      const list = foldersByLibrary.get(row.libraryId) ?? [];
      list.push({ setTag: row.setTag, count: row._count._all });
      foldersByLibrary.set(row.libraryId, list);
    }
    // Tri naturel : RTEXT2 avant RTEXT10 — l'ordre alphabétique brut est
    // illisible dès qu'une bibliothèque a 40 dossiers numérotés.
    for (const list of foldersByLibrary.values()) {
      list.sort((a, b) => a.setTag.localeCompare(b.setTag, "fr", { numeric: true }));
    }

    return NextResponse.json(
      libraries.map((lib) => ({ ...lib, folders: foldersByLibrary.get(lib.id) ?? [] })),
    );
  } catch (err) {
    console.error("[admin/libraries/data] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}

// POST /api/admin/libraries/data — crée une DataLibrary
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await req.json() as { name?: string; templateType?: string; description?: string };
  const { name, templateType, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!templateType?.trim()) {
    return NextResponse.json({ error: "Le templateType est requis (ex: RPI, RTIPS)" }, { status: 400 });
  }

  try {
    // Plan simplification Phase 4 — plus de DataCampaign wrapper : la lib
    // devient directement une liste de fiches (DataEntry.libraryId direct).
    const library = await prisma.dataLibrary.create({
      data: {
        name: name.trim(),
        templateType: templateType.trim().toUpperCase(),
        description: description?.trim() ?? null,
      },
    });
    return NextResponse.json(library, { status: 201 });
  } catch (err) {
    console.error("[admin/libraries/data] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}

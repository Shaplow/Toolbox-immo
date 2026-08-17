import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { serializeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";

// POST /api/templates/[id]/duplicate — ADMIN seulement
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  const source = await prisma.template.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Normalisation au write — aligné sur PUT /api/templates/[id] qui sérialise
  // avant persister. Sans ça, la copie hérite des champs legacy/orphelins
  // (groupIds orphelins, conditions invalides) du template source.
  // Note : si le JSON est corrompu côté DB, on retombe sur la string brute
  // pour ne pas bloquer la duplication (le builder normalisera au prochain GET).
  let normalizedJsonData = source.jsonData;
  try {
    const parsed = JSON.parse(source.jsonData) as TemplateJSON;
    normalizedJsonData = JSON.stringify(serializeTemplateJSON(parsed));
  } catch {
    // garder source.jsonData tel quel
  }

  const copy = await prisma.template.create({
    data: {
      name:        `Copie de ${source.name}`,
      client:      source.client,
      formats:     source.formats,
      // contentType (RPI / RTIPS / ...) doit suivre la copie sinon la recette
      // validation casse et la pipeline éditoriale route le slot vers le mauvais
      // bucket.
      contentType: source.contentType,
      jsonData:    normalizedJsonData,
      userId:      userContext.effectiveUser.id,
    },
  });

  return NextResponse.json(copy, { status: 201 });
}

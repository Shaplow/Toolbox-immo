import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { parseTemplateTransferPayload } from "@/lib/templateTransfer";
import { serializeTemplateJSON } from "@/lib/templateNormalization";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("payload" in body)) {
    return NextResponse.json({ error: "Fichier d'import invalide" }, { status: 400 });
  }

  try {
    const parsed = parseTemplateTransferPayload(body.payload);
    const template = await prisma.template.create({
      data: {
        name: parsed.name,
        client: parsed.client,
        formats: JSON.stringify(parsed.formats),
        jsonData: JSON.stringify(serializeTemplateJSON(parsed.jsonData)),
        userId: userContext.effectiveUser.id,
      },
    });

    return NextResponse.json({
      id: template.id,
      name: template.name,
      client: template.client,
      formats: parsed.formats,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Import impossible",
    }, { status: 400 });
  }
}
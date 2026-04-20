import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTemplateTransferPayload } from "@/lib/templateTransfer";
import { serializeTemplateJSON } from "@/lib/templateNormalization";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const userContext = await resolveUserContext(session, req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

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
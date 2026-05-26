import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { parseCaptionPresetTransferPayload } from "@/lib/captionPresetTransfer";

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Reserve aux administrateurs" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("payload" in body)) {
    return NextResponse.json({ error: "Fichier d'import invalide" }, { status: 400 });
  }

  try {
    const parsed = parseCaptionPresetTransferPayload(body.payload);
    const preset = await prisma.captionPreset.create({
      data: {
        name: parsed.name,
        userId: userContext.effectiveUser.id,
        isBuiltin: false,
        config: JSON.stringify(parsed.config),
      },
    });

    return NextResponse.json({
      id: preset.id,
      name: preset.name,
      isBuiltin: preset.isBuiltin,
      config: parsed.config,
      createdAt: preset.createdAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Import impossible",
    }, { status: 400 });
  }
}
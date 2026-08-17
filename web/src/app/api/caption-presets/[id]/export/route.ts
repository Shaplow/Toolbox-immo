import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { buildCaptionPresetExportFilename, buildCaptionPresetTransferPayload } from "@/lib/captionPresetTransfer";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;
  const isAdmin = userContext.canAdminBypass;

  const preset = await prisma.captionPreset.findFirst({
    where: isAdmin
      ? { id }
      : {
          id,
          OR: [
            { userId: userContext.effectiveUser.id },
            { accesses: { some: { userId: userContext.effectiveUser.id } } },
          ],
        },
  });

  if (!preset) {
    return NextResponse.json({ error: "Preset introuvable" }, { status: 404 });
  }

  const payload = buildCaptionPresetTransferPayload({
    name: preset.name,
    config: JSON.parse(preset.config) as Record<string, unknown>,
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildCaptionPresetExportFilename(preset.name)}"`,
    },
  });
}
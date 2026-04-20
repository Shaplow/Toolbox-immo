import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCaptionPresetExportFilename, buildCaptionPresetTransferPayload } from "@/lib/captionPresetTransfer";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const { id } = await params;
  const userContext = await resolveUserContext(session, req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
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
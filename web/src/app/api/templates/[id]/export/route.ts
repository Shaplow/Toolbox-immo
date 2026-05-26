import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { buildTemplateExportFilename, buildTemplateTransferPayload } from "@/lib/templateTransfer";
import type { TemplateJSON } from "@/types/template";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = userContext.canAdminBypass;

  const template = await prisma.template.findFirst({
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
  if (!template) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  const payload = buildTemplateTransferPayload({
    name: template.name,
    client: template.client,
    formats: JSON.parse(template.formats) as string[],
    jsonData: JSON.parse(template.jsonData) as TemplateJSON,
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildTemplateExportFilename(template.name)}"`,
    },
  });
}

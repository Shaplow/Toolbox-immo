/**
 * GET /api/publications/[id]/brief
 *   → { brief: PublicationBrief | null, attachments: PublicationBriefAttachment[] }
 *
 * PUT /api/publications/[id]/brief
 *   body { body: string } (max 8000 chars)
 *   → upsert PublicationBrief + logActivity BRIEF_UPDATED
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération).
 * PUT : permission canEditBrief (ADMIN ou CM assigné).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditBrief } from "@/lib/permissions/publications";
import { logActivity } from "@/lib/services/slot/activity";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";

const MAX_BRIEF_LENGTH = 8000;

type Params = { params: Promise<{ id: string }> };

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: slotId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });

  const brief = await prisma.publicationBrief.findUnique({
    where: { slotId },
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({
    brief: brief
      ? {
          id: brief.id,
          body: brief.body,
          updatedAt: brief.updatedAt.toISOString(),
          updatedByUserId: brief.updatedByUserId,
        }
      : null,
    attachments: brief?.attachments.map((a) => ({
      id: a.id,
      briefId: a.briefId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })) ?? [],
  });
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: Params) {
  const { id: slotId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  const { userContext, slot, role, userId } = r.ctx;

  if (!canEditBrief({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  const body = await req.json() as { body?: string };

  if (typeof body.body !== "string") {
    return NextResponse.json({ error: "Le champ 'body' (string) est requis" }, { status: 400 });
  }

  if (body.body.length > MAX_BRIEF_LENGTH) {
    return NextResponse.json(
      { error: `Le brief ne peut pas dépasser ${MAX_BRIEF_LENGTH} caractères` },
      { status: 400 }
    );
  }

  const brief = await prisma.publicationBrief.upsert({
    where: { slotId },
    create: { slotId, body: body.body, updatedByUserId: userId },
    update: { body: body.body, updatedByUserId: userId, updatedAt: new Date() },
    select: { id: true, body: true, updatedAt: true, updatedByUserId: true },
  });

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "BRIEF_UPDATED",
    payload: { action: "body_updated" },
  });

  return NextResponse.json({
    brief: {
      id: brief.id,
      body: brief.body,
      updatedAt: brief.updatedAt.toISOString(),
      updatedByUserId: brief.updatedByUserId,
    },
  });
}

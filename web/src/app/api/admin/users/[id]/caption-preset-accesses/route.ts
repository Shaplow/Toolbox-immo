import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]/caption-preset-accesses
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id: userId } = await params;
  const accesses = await prisma.captionPresetAccess.findMany({
    where: { userId },
    select: { presetId: true },
  });
  return NextResponse.json(accesses.map((a) => a.presetId));
}

// POST /api/admin/users/[id]/caption-preset-accesses — assigner un preset
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id: userId } = await params;
  const { presetId } = await req.json() as { presetId: string };

  await prisma.captionPresetAccess.upsert({
    where: { userId_presetId: { userId, presetId } },
    create: { userId, presetId },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users/[id]/caption-preset-accesses — révoquer un preset
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const { id: userId } = await params;
  const { presetId } = await req.json() as { presetId: string };

  await prisma.captionPresetAccess.deleteMany({
    where: { userId, presetId },
  });
  return NextResponse.json({ ok: true });
}

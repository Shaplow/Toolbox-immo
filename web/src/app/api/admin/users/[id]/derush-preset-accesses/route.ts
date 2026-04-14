import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]/derush-preset-accesses
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: userId } = await params;
  const accesses = await prisma.derushPresetAccess.findMany({
    where: { userId },
    select: { presetId: true },
  });
  return NextResponse.json(accesses.map((a) => a.presetId));
}

// POST /api/admin/users/[id]/derush-preset-accesses — assigner un preset
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: userId } = await params;
  const { presetId } = await req.json() as { presetId: string };

  await prisma.derushPresetAccess.upsert({
    where: { userId_presetId: { userId, presetId } },
    create: { userId, presetId },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users/[id]/derush-preset-accesses — révoquer un preset
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: userId } = await params;
  const { presetId } = await req.json() as { presetId: string };

  await prisma.derushPresetAccess.deleteMany({
    where: { userId, presetId },
  });
  return NextResponse.json({ ok: true });
}

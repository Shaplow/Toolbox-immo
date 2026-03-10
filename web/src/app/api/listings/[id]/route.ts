import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: { id, userId: session.user.id },
    include: { template: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    ...listing,
    jsonData: JSON.parse(listing.jsonData),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  // Only admins can delete listings
  if ((session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Réservé aux admins" }, { status: 403 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  // Cascade: delete renders first, then listing
  await prisma.render.deleteMany({ where: { listingId: id } });
  await prisma.listing.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  const { data } = await req.json() as { data: Record<string, unknown> };
  const updated = await prisma.listing.update({
    where: { id },
    data: { jsonData: JSON.stringify(data) },
  });

  return NextResponse.json(updated);
}

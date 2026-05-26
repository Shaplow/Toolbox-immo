import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: userContext.canAdminBypass ? { id } : { id, userId: userContext.effectiveUser.id },
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  // Only admins can delete listings
  if (!userContext.canAdminBypass) {
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
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: userContext.canAdminBypass ? { id } : { id, userId: userContext.effectiveUser.id },
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

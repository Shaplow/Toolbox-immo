/**
 * GET  /api/description/prompts  — liste les prompts actifs (user authentifié)
 * POST /api/description/prompts  — créer un prompt (admin uniquement)
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const prompts = await prisma.descriptionPrompt.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, prompt: true, createdAt: true },
  });

  return NextResponse.json(prompts);
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json() as { name?: string; prompt?: string };
  const { name, prompt } = body;

  if (!name?.trim() || !prompt?.trim()) {
    return NextResponse.json({ error: "Nom et prompt requis" }, { status: 400 });
  }

  const created = await prisma.descriptionPrompt.create({
    data: { name: name.trim(), prompt: prompt.trim() },
  });

  return NextResponse.json(created, { status: 201 });
}

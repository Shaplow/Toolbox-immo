/**
 * GET /api/admin/patterns — catalogue des PatternTemplate (recettes globales).
 * POST /api/admin/patterns — crée une nouvelle recette globale.
 *
 * Admin-only. Une recette globale peut être appliquée à N comptes via
 * PatternBinding (route `/api/admin/accounts/[id]/bindings`).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  validatePatternTemplateInput,
  toPatternTemplateCreateData,
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";

type CreateBody = PatternTemplateInputPayload;

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  const templates = await prisma.patternTemplate.findMany({
    where: { isArchived: false },
    orderBy: [{ source: "asc" }, { label: "asc" }],
    include: {
      _count: { select: { bindings: true } },
    },
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
  const err = await validatePatternTemplateInput(body, { requireAll: true }, prisma);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const created = await prisma.patternTemplate.create({
    // Sprint D — audit log light : trace l'auteur de la création.
    data: toPatternTemplateCreateData(body, ctx.actualUser.id),
  });
  return NextResponse.json(created, { status: 201 });
}

export type PatternTemplateCreateBody = CreateBody;

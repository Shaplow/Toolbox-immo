/**
 * GET /api/admin/accounts/[id]/bindings — liste les PatternBinding du compte.
 * POST /api/admin/accounts/[id]/bindings — crée un binding (= applique une
 *   recette globale au compte avec son propre planning et ses assignations).
 *
 * Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type CreateBody = {
  patternTemplateId?: string;
  customLabel?: string | null;
  dayOfWeek?: number[];
  publishTime?: string;
  isActive?: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  defaultAssigneeVideasteId?: string | null;
  templateIdOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
  coverModeOverride?: string | null;
  notes?: string | null;
};

const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
const VALID_COVER_MODES = ["none", "manualSelect", "autoPack", "monteurUpload"];

function validateBody(body: CreateBody, requireAll: boolean): string | null {
  if (requireAll) {
    if (!body.patternTemplateId) return "patternTemplateId requis";
    if (!body.publishTime) return "publishTime requis";
  }
  if (body.publishTime !== undefined && !PUBLISH_TIME_RE.test(body.publishTime)) {
    return "publishTime doit être HH:MM";
  }
  if (body.dayOfWeek !== undefined) {
    if (!Array.isArray(body.dayOfWeek)) return "dayOfWeek doit être un tableau";
    for (const d of body.dayOfWeek) {
      if (!Number.isInteger(d) || d < 1 || d > 7) return "dayOfWeek doit contenir des entiers 1-7";
    }
  }
  if (
    body.coverModeOverride !== undefined &&
    body.coverModeOverride !== null &&
    !VALID_COVER_MODES.includes(body.coverModeOverride)
  ) {
    return "coverModeOverride invalide";
  }
  return null;
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id } = await params;
  // Inclure les assignees résolus (Prisma renvoie undefined sans select
  // explicite — bug réel : AddSlotModal lit `defaultAssigneeMonteur.name`
  // et obtient null/undefined sans cet include).
  const bindings = await prisma.patternBinding.findMany({
    where: { accountId: id },
    include: {
      patternTemplate: true,
      defaultAssigneeMonteur: { select: { id: true, name: true } },
      defaultAssigneeCm: { select: { id: true, name: true } },
      defaultAssigneeVideaste: { select: { id: true, name: true } },
    },
    orderBy: [{ publishTime: "asc" }],
  });
  return NextResponse.json(bindings);
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: accountId } = await params;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const err = validateBody(body, true);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Vérifier que le template existe et n'est pas archivé.
  const template = await prisma.patternTemplate.findUnique({
    where: { id: body.patternTemplateId! },
  });
  if (!template) {
    return NextResponse.json({ error: "Recette introuvable" }, { status: 404 });
  }
  if (template.isArchived) {
    return NextResponse.json(
      { error: "Recette archivée — impossible de créer une nouvelle liaison." },
      { status: 400 },
    );
  }

  const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const created = await prisma.patternBinding.create({
    data: {
      accountId,
      patternTemplateId: body.patternTemplateId!,
      customLabel: body.customLabel ?? null,
      dayOfWeek: body.dayOfWeek ?? [],
      publishTime: body.publishTime!,
      isActive: body.isActive ?? true,
      defaultAssigneeMonteurId: body.defaultAssigneeMonteurId ?? null,
      defaultAssigneeCmId: body.defaultAssigneeCmId ?? null,
      defaultAssigneeVideasteId: body.defaultAssigneeVideasteId ?? null,
      templateIdOverride: body.templateIdOverride ?? null,
      captionPresetIdOverride: body.captionPresetIdOverride ?? null,
      descriptionPromptIdOverride: body.descriptionPromptIdOverride ?? null,
      coverModeOverride: body.coverModeOverride ?? null,
      notes: body.notes ?? null,
    },
    include: { patternTemplate: true },
  });
  return NextResponse.json(created, { status: 201 });
}

export type PatternBindingCreateBody = CreateBody;

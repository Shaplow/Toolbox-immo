/**
 * GET  /api/admin/accounts/[id]/patterns — liste les patterns du compte
 * POST /api/admin/accounts/[id]/patterns — crée un pattern sur le compte
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const VALID_SOURCES = ["auto_template", "manual_rushes", "external_upload"] as const;
const VALID_COVER_MODES = ["auto", "manualSelect", "none"] as const;
const VALID_NEEDS_DESCRIPTION = ["preFilled", "autoGenerate", "manualWrite", "none"] as const;
const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

const patternIncludes = {
  template: { select: { id: true, name: true } },
  defaultAssigneeMonteur: { select: { id: true, name: true } },
  defaultAssigneeCm: { select: { id: true, name: true } },
  _count: { select: { publicationSlots: true } },
} as const;

type PostBody = {
  label?: string;
  source?: string;
  templateId?: string | null;
  coverMode?: string;
  coverConfig?: unknown;
  needsDescription?: string;
  needsCaptions?: boolean;
  needsClientValidation?: boolean;
  needsRushes?: boolean;
  needsBrief?: boolean;
  dayOfWeek?: number;
  publishTime?: string;
  isActive?: boolean;
  defaultAssigneeMonteurId?: string | null;
  defaultAssigneeCmId?: string | null;
  notes?: string | null;
};

function validatePatternBody(body: PostBody, requireAll: boolean): string | null {
  if (requireAll) {
    if (!body.label?.trim()) return "Le champ label est requis";
    if (!body.source) return "Le champ source est requis";
    if (!body.coverMode) return "Le champ coverMode est requis";
    if (!body.needsDescription) return "Le champ needsDescription est requis";
    if (body.dayOfWeek == null) return "Le champ dayOfWeek est requis";
    if (!body.publishTime) return "Le champ publishTime est requis";
  }

  if (body.source !== undefined && !VALID_SOURCES.includes(body.source as (typeof VALID_SOURCES)[number])) {
    return `source invalide. Valeurs acceptées : ${VALID_SOURCES.join(", ")}`;
  }
  if (body.coverMode !== undefined && !VALID_COVER_MODES.includes(body.coverMode as (typeof VALID_COVER_MODES)[number])) {
    return `coverMode invalide. Valeurs acceptées : ${VALID_COVER_MODES.join(", ")}`;
  }
  if (body.needsDescription !== undefined && !VALID_NEEDS_DESCRIPTION.includes(body.needsDescription as (typeof VALID_NEEDS_DESCRIPTION)[number])) {
    return `needsDescription invalide. Valeurs acceptées : ${VALID_NEEDS_DESCRIPTION.join(", ")}`;
  }
  if (body.dayOfWeek !== undefined) {
    const d = Number(body.dayOfWeek);
    if (!Number.isInteger(d) || d < 1 || d > 7) return "dayOfWeek doit être un entier entre 1 (lundi) et 7 (dimanche)";
  }
  if (body.publishTime !== undefined && !PUBLISH_TIME_RE.test(body.publishTime)) {
    return "publishTime doit être au format HH:MM";
  }

  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({ where: { id }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const patterns = await prisma.accountPattern.findMany({
    where: { accountId: id },
    orderBy: [{ dayOfWeek: "asc" }, { publishTime: "asc" }],
    include: patternIncludes,
  });

  return NextResponse.json(patterns);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const account = await prisma.instagramAccount.findUnique({ where: { id }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const body = await req.json() as PostBody;
  const validationError = validatePatternBody(body, true);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const pattern = await prisma.accountPattern.create({
      data: {
        accountId: id,
        label: body.label!.trim(),
        source: body.source!,
        templateId: body.templateId ?? null,
        coverMode: body.coverMode!,
        coverConfig: body.coverConfig !== undefined ? (body.coverConfig as import("@prisma/client").Prisma.InputJsonValue) : undefined,
        needsDescription: body.needsDescription!,
        needsCaptions: body.needsCaptions ?? false,
        needsClientValidation: body.needsClientValidation ?? false,
        needsRushes: body.needsRushes ?? false,
        needsBrief: body.needsBrief ?? false,
        dayOfWeek: Number(body.dayOfWeek),
        publishTime: body.publishTime!,
        isActive: body.isActive ?? true,
        defaultAssigneeMonteurId: body.defaultAssigneeMonteurId ?? null,
        defaultAssigneeCmId: body.defaultAssigneeCmId ?? null,
        notes: body.notes ?? null,
      },
      include: patternIncludes,
    });
    return NextResponse.json(pattern, { status: 201 });
  } catch (err: unknown) {
    console.error("[admin/accounts/[id]/patterns] POST error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

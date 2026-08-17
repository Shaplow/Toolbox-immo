import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { TemplateJSON } from "@/types/template";

type Params = { params: Promise<{ id: string }> };

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Résout la liste des groupIds valides depuis le template JSON stocké dans le pack. */
async function resolveTemplateGroupIds(packId: string): Promise<Set<string>> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    select: {
      render: { select: { template: { select: { jsonData: true } } } },
      template: { select: { jsonData: true } }, // fallback pour packs one-off (sans render)
    },
  });
  // Priorité render.template, fallback pack.template (Phase 5 — slots one-off)
  const jsonData = pack?.render?.template?.jsonData ?? pack?.template?.jsonData ?? null;
  if (!jsonData) return new Set();
  try {
    const tpl = JSON.parse(jsonData) as TemplateJSON;
    return new Set((tpl.groups ?? []).map((g) => g.id));
  } catch {
    return new Set();
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;

  // Parse body
  const body = await req.json().catch(() => ({})) as {
    overlayOffsetX?: unknown;
    overlayOffsetY?: unknown;
    overlayGroupIds?: unknown;
  };

  // Validation overlayOffsetX
  const OFFSET_MIN = -5000;
  const OFFSET_MAX = 5000;
  let offsetX: number | undefined;
  let offsetY: number | undefined;

  if (body.overlayOffsetX !== undefined) {
    if (typeof body.overlayOffsetX !== "number" || !Number.isFinite(body.overlayOffsetX)) {
      return NextResponse.json({ error: "overlayOffsetX doit être un nombre fini" }, { status: 400 });
    }
    if (body.overlayOffsetX < OFFSET_MIN || body.overlayOffsetX > OFFSET_MAX) {
      return NextResponse.json(
        { error: `overlayOffsetX hors bornes (${OFFSET_MIN}–${OFFSET_MAX})` },
        { status: 400 },
      );
    }
    offsetX = body.overlayOffsetX;
  }

  if (body.overlayOffsetY !== undefined) {
    if (typeof body.overlayOffsetY !== "number" || !Number.isFinite(body.overlayOffsetY)) {
      return NextResponse.json({ error: "overlayOffsetY doit être un nombre fini" }, { status: 400 });
    }
    if (body.overlayOffsetY < OFFSET_MIN || body.overlayOffsetY > OFFSET_MAX) {
      return NextResponse.json(
        { error: `overlayOffsetY hors bornes (${OFFSET_MIN}–${OFFSET_MAX})` },
        { status: 400 },
      );
    }
    offsetY = body.overlayOffsetY;
  }

  // Validation overlayGroupIds
  let overlayGroupIds: string[] | undefined;
  if (body.overlayGroupIds !== undefined) {
    if (!Array.isArray(body.overlayGroupIds)) {
      return NextResponse.json({ error: "overlayGroupIds doit être un array" }, { status: 400 });
    }
    if (!body.overlayGroupIds.every((item) => typeof item === "string")) {
      return NextResponse.json({ error: "overlayGroupIds doit contenir uniquement des strings" }, { status: 400 });
    }
    overlayGroupIds = body.overlayGroupIds as string[];
  }

  if (offsetX === undefined && offsetY === undefined && overlayGroupIds === undefined) {
    return NextResponse.json(
      { error: "Au moins un champ requis : overlayOffsetX, overlayOffsetY ou overlayGroupIds" },
      { status: 400 },
    );
  }

  // Ownership check
  const pack = await prisma.coverFramePack.findUnique({
    where: { id },
    select: { userId: true, overlayGroupIds: true, overlayOffsetX: true, overlayOffsetY: true },
  });
  if (!pack || (!isAdmin && pack.userId !== userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
  }

  // Validate group IDs against template
  if (overlayGroupIds !== undefined && overlayGroupIds.length > 0) {
    const validGroupIds = await resolveTemplateGroupIds(id);
    const invalidIds = overlayGroupIds.filter((gid) => !validGroupIds.has(gid));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Groupes invalides (non présents dans le template) : ${invalidIds.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Build update payload
  const updateData: Record<string, unknown> = {};
  if (offsetX !== undefined) updateData.overlayOffsetX = offsetX;
  if (offsetY !== undefined) updateData.overlayOffsetY = offsetY;
  if (overlayGroupIds !== undefined) {
    updateData.overlayGroupIds = JSON.stringify(overlayGroupIds);
  }

  const updated = await prisma.coverFramePack.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      overlayOffsetX: true,
      overlayOffsetY: true,
      overlayGroupIds: true,
    },
  });

  return NextResponse.json({
    ok: true,
    id: updated.id,
    overlayOffsetX: updated.overlayOffsetX,
    overlayOffsetY: updated.overlayOffsetY,
    overlayGroupIds: safeJson<string[]>(updated.overlayGroupIds, []),
  });
}

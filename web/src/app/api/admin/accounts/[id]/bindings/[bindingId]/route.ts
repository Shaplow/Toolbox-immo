/**
 * PATCH /api/admin/accounts/[id]/bindings/[bindingId] — édite un binding.
 * DELETE /api/admin/accounts/[id]/bindings/[bindingId] — supprime un binding
 *   (les slots historiques voient leur patternBindingId tomber à null via SetNull).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type PatchBody = {
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

interface Params {
  params: Promise<{ id: string; bindingId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: accountId, bindingId } = await params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
  if (body.publishTime !== undefined && !PUBLISH_TIME_RE.test(body.publishTime)) {
    return NextResponse.json({ error: "publishTime doit être HH:MM" }, { status: 400 });
  }
  if (body.dayOfWeek !== undefined) {
    if (!Array.isArray(body.dayOfWeek)) {
      return NextResponse.json({ error: "dayOfWeek doit être un tableau" }, { status: 400 });
    }
    for (const d of body.dayOfWeek) {
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        return NextResponse.json(
          { error: "dayOfWeek doit contenir des entiers 1-7" },
          { status: 400 },
        );
      }
    }
  }
  if (
    body.coverModeOverride !== undefined &&
    body.coverModeOverride !== null &&
    !VALID_COVER_MODES.includes(body.coverModeOverride)
  ) {
    return NextResponse.json({ error: "coverModeOverride invalide" }, { status: 400 });
  }

  const existing = await prisma.patternBinding.findUnique({ where: { id: bindingId } });
  if (!existing || existing.accountId !== accountId) {
    return NextResponse.json({ error: "Liaison introuvable" }, { status: 404 });
  }

  const updated = await prisma.patternBinding.update({
    where: { id: bindingId },
    // include cohérent avec la route GET pour que les call-sites UI
    // (PatternBindingForm onSave → router.refresh()) reçoivent les assignees
    // résolus et non null.
    include: {
      patternTemplate: true,
      defaultAssigneeMonteur: { select: { id: true, name: true } },
      defaultAssigneeCm: { select: { id: true, name: true } },
      defaultAssigneeVideaste: { select: { id: true, name: true } },
    },
    data: {
      ...(body.customLabel !== undefined ? { customLabel: body.customLabel } : {}),
      ...(body.dayOfWeek !== undefined ? { dayOfWeek: body.dayOfWeek } : {}),
      ...(body.publishTime !== undefined ? { publishTime: body.publishTime } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.defaultAssigneeMonteurId !== undefined
        ? { defaultAssigneeMonteurId: body.defaultAssigneeMonteurId }
        : {}),
      ...(body.defaultAssigneeCmId !== undefined
        ? { defaultAssigneeCmId: body.defaultAssigneeCmId }
        : {}),
      ...(body.defaultAssigneeVideasteId !== undefined
        ? { defaultAssigneeVideasteId: body.defaultAssigneeVideasteId }
        : {}),
      ...(body.templateIdOverride !== undefined ? { templateIdOverride: body.templateIdOverride } : {}),
      ...(body.captionPresetIdOverride !== undefined
        ? { captionPresetIdOverride: body.captionPresetIdOverride }
        : {}),
      ...(body.descriptionPromptIdOverride !== undefined
        ? { descriptionPromptIdOverride: body.descriptionPromptIdOverride }
        : {}),
      ...(body.coverModeOverride !== undefined ? { coverModeOverride: body.coverModeOverride } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  const { id: accountId, bindingId } = await params;

  const existing = await prisma.patternBinding.findUnique({ where: { id: bindingId } });
  if (!existing || existing.accountId !== accountId) {
    return NextResponse.json({ error: "Liaison introuvable" }, { status: 404 });
  }
  await prisma.patternBinding.delete({ where: { id: bindingId } });
  return NextResponse.json({ deleted: true, id: bindingId });
}

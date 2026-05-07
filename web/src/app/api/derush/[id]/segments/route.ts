/**
 * PATCH /api/derush/[id]/segments
 *
 * Enregistre un override manuel sur un segment.
 * Body:
 *   { segmentId: string, action: "accept" | "reject" }
 *   { segmentId: string, action: "edit_text", text: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_SEGMENT_TEXT_LENGTH = 2_000;

type Body =
  | { segmentId: string; action: "accept" | "reject" }
  | { segmentId: string; action: "edit_text"; text: string };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json({ error: "Job non terminé" }, { status: 409 });
  }

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { segmentId, action } = body;
  if (!segmentId || !action) {
    return NextResponse.json({ error: "segmentId et action requis" }, { status: 400 });
  }

  if (action === "edit_text") {
    const { text } = body as { segmentId: string; action: "edit_text"; text: string };
    if (typeof text !== "string") {
      return NextResponse.json({ error: "text requis pour edit_text" }, { status: 400 });
    }
    if (text.length > MAX_SEGMENT_TEXT_LENGTH) {
      return NextResponse.json({ error: `text trop long (max ${MAX_SEGMENT_TEXT_LENGTH} caractères)` }, { status: 400 });
    }
    let textOverrides: Record<string, string> = {};
    try { textOverrides = JSON.parse(job.segmentTextOverrides || "{}") as Record<string, string>; } catch { /* ignore malformed */ }
    if (text.trim() === "") {
      // Empty = remove override (restore original)
      delete textOverrides[segmentId];
    } else {
      textOverrides[segmentId] = text.trim();
    }
    await prisma.derushJob.update({
      where: { id },
      data: { segmentTextOverrides: JSON.stringify(textOverrides) },
    });
    return NextResponse.json({ ok: true, textOverrides });
  }

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  let overrides: Record<string, "accept" | "reject"> = {};
  try { overrides = JSON.parse(job.segmentOverrides || "{}") as Record<string, "accept" | "reject">; } catch { /* ignore malformed */ }
  overrides[segmentId] = action;

  await prisma.derushJob.update({
    where: { id },
    data: { segmentOverrides: JSON.stringify(overrides) },
  });

  return NextResponse.json({ ok: true, overrides });
}

/**
 * GET /api/derush/[id]/result
 *
 * Retourne le JSON segments analysés (DerushSegment[]) depuis R2.
 * Le job doit être COMPLETED et avoir un outputJsonKey.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFromR2 } from "@/lib/r2";

export async function GET(
  _req: NextRequest,
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
    return NextResponse.json({ error: "Analyse non terminée" }, { status: 409 });
  }
  if (!job.outputJsonKey) {
    return NextResponse.json({ error: "Résultat non disponible" }, { status: 404 });
  }

  let raw: Buffer;
  try {
    raw = await getFromR2(job.outputJsonKey);
  } catch (err) {
    console.error("[derush/result] R2 fetch failed:", err);
    return NextResponse.json({ error: "Impossible de charger le résultat" }, { status: 502 });
  }

  const data = JSON.parse(raw.toString("utf-8")) as { segments?: unknown[] } | unknown[];

  // Apply manual overrides (accept/reject toggles from the UI)
  let overrides: Record<string, "accept" | "reject"> = {};
  let textOverrides: Record<string, string> = {};
  try { overrides = JSON.parse(job.segmentOverrides || "{}") as Record<string, "accept" | "reject">; } catch { /* ignore malformed */ }
  try { textOverrides = JSON.parse(job.segmentTextOverrides || "{}") as Record<string, string>; } catch { /* ignore malformed */ }
  const segments: unknown[] = Array.isArray(data) ? data : ((data as { segments?: unknown[] }).segments ?? []);
  if (Object.keys(overrides).length > 0 || Object.keys(textOverrides).length > 0) {
    for (const seg of segments) {
      const s = seg as Record<string, unknown>;
      const segId = s.id as string;
      const override = overrides[segId];
      if (override === "accept") {
        s.is_rejected = false;
        s.reject_reason = null;
        if (!Array.isArray(s.tags)) s.tags = [];
        const tags = s.tags as string[];
        if (!tags.includes("manual_override")) tags.push("manual_override");
      } else if (override === "reject") {
        s.is_rejected = true;
        s.reject_reason = "manual_override";
      }
      // Apply text override
      if (textOverrides[segId] !== undefined) {
        s.text = textOverrides[segId];
        if (!Array.isArray(s.tags)) s.tags = [];
        const tags = s.tags as string[];
        if (!tags.includes("manual_override")) tags.push("manual_override");
      }
    }
  }

  return NextResponse.json(Array.isArray(data) ? segments : { ...(data as object), segments });
}

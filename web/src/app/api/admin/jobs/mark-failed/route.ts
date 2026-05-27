/**
 * POST /api/admin/jobs/mark-failed
 *
 * Marque un job actif (Render, Caption, Transcription, Description,
 * CoverFramePack, MediaAutocutJob) comme FAILED manuellement. Utilisé
 * par la page /admin/jobs (ticket E8) pour libérer les slots bloqués
 * par des jobs zombies.
 *
 * Body: { type, id }
 * - type: "render" | "caption" | "transcription" | "description" |
 *         "cover-pack" | "autocut"
 * - id: cuid du job
 *
 * Gating: ADMIN bypass uniquement (canAdminBypass = ADMIN réel hors
 * impersonation). On utilise l'audit log via captureMessage pour tracer
 * qui a marqué quoi.
 */

import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { captureMessage } from "@/lib/observability/captureError";

interface Body {
  type?: string;
  id?: string;
}

const VALID_TYPES = new Set([
  "render",
  "caption",
  "transcription",
  "description",
  "cover-pack",
  "autocut",
]);

export async function POST(req: Request) {
  const ctx = await getUserContext();
  if (!ctx?.actualUser || !ctx.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const { type, id } = body;
  if (!type || !id || typeof type !== "string" || typeof id !== "string") {
    return NextResponse.json({ error: "type et id requis (strings)" }, { status: 400 });
  }
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: `Type invalide. Attendus: ${[...VALID_TYPES].join(", ")}` }, { status: 400 });
  }

  try {
    switch (type) {
      case "render":
        // RenderStatus enum: PENDING | PROCESSING | DONE | ERROR (pas FAILED).
        await prisma.render.update({ where: { id }, data: { status: "ERROR" } });
        break;
      case "caption":
        await prisma.captionJob.update({ where: { id }, data: { status: "FAILED" } });
        break;
      case "transcription":
        await prisma.transcriptionJob.update({ where: { id }, data: { status: "FAILED" } });
        break;
      case "description":
        await prisma.descriptionJob.update({ where: { id }, data: { status: "FAILED" } });
        break;
      case "cover-pack":
        await prisma.coverFramePack.update({ where: { id }, data: { status: "FAILED" } });
        break;
      case "autocut":
        await prisma.mediaAutocutJob.update({ where: { id }, data: { status: "FAILED" } });
        break;
    }

    captureMessage(`Admin marked ${type} ${id} as FAILED`, {
      tag: "admin-jobs-mark-failed",
      level: "warning",
      extra: { type, id, actualUserId: ctx.actualUser.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

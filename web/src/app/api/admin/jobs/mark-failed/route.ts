/**
 * POST /api/admin/jobs/mark-failed
 *
 * Marque un job actif (Render, Caption, Transcription, Description,
 * CoverFramePack, MediaAutocutJob) comme FAILED manuellement. Utilisé
 * par la page /admin/jobs (ticket E8) pour libérer les slots bloqués
 * par des jobs zombies.
 *
 * Body: { type, id } — validé par markJobFailedSchema (E5).
 * Gating: ADMIN bypass uniquement.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { captureMessage } from "@/lib/observability/captureError";
import { markJobFailedSchema, validateBody } from "@/lib/validation/apiSchemas";

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ctx = auth.ctx;

  const parsed = await validateBody(req, markJobFailedSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { type, id } = parsed.data;

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
        // Minuscules : le domaine de MediaAutocutJob.status est
        // pending|processing|done|failed. Écrire "FAILED" rendait le job invisible
        // à tous les filtres de l'atelier — et sans errorMsg, l'admin n'avait
        // aucune trace de pourquoi il avait disparu.
        await prisma.mediaAutocutJob.update({
          where: { id },
          data: {
            status: "failed",
            // Pas d'id d'utilisateur ici : errorMsg est affiché dans l'atelier à
            // tout rôle passant canManageMediaAssets. La traçabilité de l'acteur
            // vit dans le captureMessage ci-dessous.
            errorMsg: "Marqué en échec manuellement depuis /admin/jobs",
          },
        });
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

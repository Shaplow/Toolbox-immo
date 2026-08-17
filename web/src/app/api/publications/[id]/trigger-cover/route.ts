/**
 * POST /api/publications/[id]/trigger-cover
 *
 * Lance manuellement la génération du CoverFramePack pour un slot qui n'a
 * pas de Render automatique (cas slot one-off : manual_rushes ou external_upload).
 * La cover est extraite de la PublicationVersion courante (vidéo uploadée).
 *
 * ADMIN uniquement. Idempotent : skip si un pack existe déjà pour cette version.
 *
 * Toute la logique métier est partagée avec l'auto-trigger post-promote dans
 * `tryAutoTriggerCover` (services/slot/autoCoverTrigger.ts) — cette route est
 * une couche fine auth + traduction en HTTP.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { tryAutoTriggerCover } from "@/lib/services/slot/autoCoverTrigger";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id: slotId } = await params;

  const result = await tryAutoTriggerCover({
    slotId,
    actorId: userContext.actualUser.id,
    trigger: "MANUAL_FROM_VERSION",
  });

  switch (result.status) {
    case "queued":
      return NextResponse.json({
        ok: true,
        packId: result.packId,
        presetName: result.presetName,
      });
    case "idempotent":
      return NextResponse.json(
        { ok: true, packId: result.packId, message: "Pack déjà existant pour cette version" },
        { status: 200 },
      );
    case "skipped":
      // Traduction explicite des raisons → message HTTP
      if (result.reason === "no_current_version") {
        return NextResponse.json(
          { error: "Aucune version courante uploadée — uploadez d'abord la vidéo" },
          { status: 400 },
        );
      }
      if (result.reason.startsWith("cover_mode_")) {
        return NextResponse.json(
          { error: `Cover mode est "${result.reason.replace("cover_mode_", "")}" — auto requis pour ce trigger` },
          { status: 400 },
        );
      }
      if (result.reason === "no_cover_preset") {
        return NextResponse.json(
          { error: "Aucun preset cover défini (override slot ou pattern)" },
          { status: 400 },
        );
      }
      if (result.reason === "preset_not_found") {
        return NextResponse.json(
          { error: "Preset cover introuvable" },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: result.reason }, { status: 400 });
    case "error":
      return NextResponse.json({ error: result.reason }, { status: 500 });
  }
}

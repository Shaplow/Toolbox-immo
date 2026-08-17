/**
 * GET  /api/admin/pod        — état actuel du pod (status, podId, activeJobCount, …)
 * POST /api/admin/pod        — actions de maintenance
 *   { action: "stop" }           → force-stop le pod sur RunPod + reset DB (image conservée)
 *   { action: "terminate" }      → supprime le pod sur RunPod + efface podId (force re-pull :latest)
 *   { action: "reset-counter" }  → remet activeJobCount à 0 sans toucher RunPod
 *
 * Accès : ADMIN uniquement.
 *
 * Typiquement utilisé quand un webhook RunPod est perdu et que le pod tourne
 * indéfiniment à cause d'un activeJobCount bloqué à > 0.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { forceStopPod, forceTerminatePod, resetPodJobCounter } from "@/lib/podOrchestrator";

// ─── GET — pod status ─────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const state = await prisma.podState.findUnique({ where: { id: "singleton" } });

  if (!state) {
    return NextResponse.json({ status: "stopped", podId: null, activeJobCount: 0, lastJobAt: null, podUrl: null });
  }

  const idleSinceMs = state.lastJobAt ? Date.now() - state.lastJobAt.getTime() : null;

  return NextResponse.json({
    status: state.status,
    podId: state.podId,
    podUrl: state.podUrl,
    activeJobCount: state.activeJobCount,
    lastJobAt: state.lastJobAt,
    idleSinceMs,
    updatedAt: state.updatedAt,
  });
}

// ─── POST — maintenance actions ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const body = await req.json() as { action?: string };
  const { action } = body;

  if (action === "stop") {
    const result = await forceStopPod();
    return NextResponse.json({ ok: true, action: "stop", podId: result.podId });
  }

  if (action === "terminate") {
    const result = await forceTerminatePod();
    return NextResponse.json({ ok: true, action: "terminate", podId: result.podId });
  }

  if (action === "reset-counter") {
    await resetPodJobCounter();
    return NextResponse.json({ ok: true, action: "reset-counter" });
  }

  return NextResponse.json(
    { error: `Action inconnue: "${action}". Valeurs acceptées: "stop", "terminate", "reset-counter"` },
    { status: 400 }
  );
}

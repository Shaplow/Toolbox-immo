import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndParseRunpodWebhook } from "@/lib/webhooks/runpod";
import { isR2PublicUrl } from "@/lib/r2";
import { applyCoverFrameResults, failCoverFramePack } from "@/lib/coverAuto";

/**
 * POST /api/webhooks/runpod/cover-frames
 *
 * Reçoit la callback RunPod quand un job `cover_frames` termine.
 *
 * Sécurité : `verifyAndParseRunpodWebhook` (HMAC prioritaire, repli `?secret=`).
 * On n'exige PAS le HMAC ici : sur le chemin Serverless — le nominal — c'est
 * l'infrastructure RunPod qui délivre la callback. Elle ne connaît pas
 * `RUNPOD_WEBHOOK_SECRET` et ne peut pas signer le corps ; seul le pod signe.
 * Durcir cette route rejetterait la totalité des callbacks Serverless.
 */

type CoverFramesOutput = {
  /** Echo de CoverFramePack.id — permet de résoudre le pack même si `runpodJobId`
   *  n'a pas encore été écrit (RunPod peut rappeler avant la fin de notre update). */
  pack_id?: string;
  /** Numéro du tirage au moment de la soumission. Garde anti-webhook-périmé. */
  attempt?: number;
  frames?: Array<{ id?: string; timestamp?: number; key?: string; url?: string }>;
  failures?: Array<{ id?: string; timestamp?: number; error?: string }>;
  error?: string;
};

export async function POST(req: NextRequest) {
  const parsed = await verifyAndParseRunpodWebhook<CoverFramesOutput>(req);
  if (!parsed.ok) return parsed.response;

  const { id: runpodJobId, status, output, error } = parsed.body;

  let pack = await prisma.coverFramePack.findUnique({
    where: { runpodJobId },
    select: { id: true, userId: true, extractAttempt: true, runpodJobId: true },
  });

  if (!pack && output?.pack_id) {
    // Race : RunPod a rappelé avant qu'on ait fini d'écrire runpodJobId. Le worker
    // echo pack_id précisément pour ça — on retrouve la ligne et on la backfille.
    pack = await prisma.coverFramePack.findUnique({
      where: { id: output.pack_id },
      select: { id: true, userId: true, extractAttempt: true, runpodJobId: true },
    });
    if (pack && !pack.runpodJobId) {
      await prisma.coverFramePack.update({ where: { id: pack.id }, data: { runpodJobId } });
    }
  }

  if (!pack) {
    // Réellement inconnu (pack supprimé, webhook rejoué très tard). 200 pour couper
    // les relances de RunPod.
    console.warn(`[webhook/cover-frames] pack inconnu pour runpodJobId=${runpodJobId}`);
    return NextResponse.json({ ok: true });
  }

  const attempt = typeof output?.attempt === "number" ? output.attempt : null;
  if (attempt !== null && attempt !== pack.extractAttempt) {
    // Le pack a été remis à zéro entre-temps (« Refaire un tirage ») : ce résultat
    // pointe sur des objets R2 déjà purgés. L'ignorer est le comportement correct.
    console.warn(
      `[webhook/cover-frames] résultat périmé pour pack=${pack.id} ` +
        `(tentative ${attempt}, courante ${pack.extractAttempt})`,
    );
    return NextResponse.json({ ok: true, stale: true });
  }

  if (status !== "COMPLETED" || !output || output.error) {
    const errorMsg = output?.error ?? error ?? `Job RunPod ${status}`;
    await failCoverFramePack(pack.id, attempt, `Extraction des frames échouée — ${errorMsg}`);
    return NextResponse.json({ ok: true });
  }

  // Garde d'origine : `renderFinalCover` refetch `candidate.imageUrl` côté serveur
  // pour composer la cover finale (Puppeteer). Une URL arbitraire y devient une
  // SSRF. On n'accepte que notre R2 public, et une clé sous le préfixe attendu —
  // recalculé ici, jamais repris du payload.
  const expectedPrefix = `covers/${pack.userId}/${pack.id}/`;
  const frames = (output.frames ?? []).flatMap((frame) => {
    if (!frame.id || !frame.url || typeof frame.timestamp !== "number") return [];
    if (!isR2PublicUrl(frame.url) || !frame.key?.startsWith(expectedPrefix)) {
      console.error(
        `[webhook/cover-frames] frame rejetée pour pack=${pack.id} — url ou clé hors R2 attendu`,
      );
      return [];
    }
    return [{
      candidateId: frame.id,
      timestamp: frame.timestamp,
      imageUrl: frame.url,
      imageKey: frame.key,
    }];
  });

  if (frames.length === 0) {
    await failCoverFramePack(
      pack.id,
      attempt,
      "Le worker n'a renvoyé aucune frame exploitable.",
    );
    return NextResponse.json({ ok: true });
  }

  if (output.failures?.length) {
    console.warn(
      `[webhook/cover-frames] pack=${pack.id} extraction partielle : ` +
        `${frames.length} frames, ${output.failures.length} en échec`,
    );
  }

  // applyCoverFrameResults est idempotent (il n'accepte qu'un pack PROCESSING) —
  // un webhook rejoué ne recrée rien.
  await applyCoverFrameResults(pack.id, attempt, frames);
  return NextResponse.json({ ok: true });
}

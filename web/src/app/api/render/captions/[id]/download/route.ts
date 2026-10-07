/**
 * GET /api/render/captions/[id]/download
 *
 * Télécharge la vidéo d'un sous-titrage en passant par l'app plutôt que par l'URL
 * publique du CDN : c'est le seul chemin qui enregistre l'activité (`lastAccessedAt`)
 * dont dépend la purge à 60 jours (lib/captions/outputRetention.ts). Chaque
 * téléchargement repousse l'expiration de 60 jours, celui d'un admin compris.
 *
 * Le fichier est désigné par `outputKey` ; les anciennes lignes qui n'en ont pas portent
 * seulement `outputUrl` (une URL du CDN) et leur clé en est tirée (`r2KeyOf`).
 *
 * Réponses :
 *   302  vers le fichier : URL R2 pré-signée (Content-Disposition: attachment), ou, en
 *        stockage local (dev), le chemin /api/captions/outputs/…, servi sans contrôle
 *        d'accès (cf. `resolveTarget`) : seul le contrôle du propriétaire de cette route
 *        garde la remise de l'URL
 *   401  non connecté
 *   403  ni propriétaire ni admin
 *   404  job inconnu, ou aucun fichier à servir
 *   409  job pas terminé
 *   410  vidéo supprimée par la purge (`outputExpiredAt`), ou purge passée entre la
 *        lecture du job et l'enregistrement de l'accès
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { createPresignedDownloadUrl, isR2PublicUrl, r2Configured } from "@/lib/r2";
import { r2KeyFromPublicUrl } from "@/lib/clientExport/finalVideo";
import { CAPTION_RETENTION_COPY, captionOutputKind } from "@/lib/captions/outputRetention";
import { attachmentDisposition, sanitizeZipStem } from "@/lib/transcription/batches";

/** Le navigateur suit la redirection aussitôt : 15 minutes suffisent. */
const PRESIGNED_TTL_SECONDS = 900;

/** Seul préfixe local accepté : le proxy captions, de même origine que l'app. */
const LOCAL_OUTPUT_PREFIX = "/api/captions/";

/**
 * Jamais en cache : une redirection rejouée par le navigateur ou un relais ne
 * repasserait plus par la route (aucune activité enregistrée) et pointerait vers
 * une URL pré-signée périmée.
 */
const NO_STORE = { "Cache-Control": "no-store" };

/** `inputUrl` : nom de fichier brut (Atelier) ou URL absolue (pipeline auto). */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Nom proposé au téléchargement : « <vidéo source> - sous-titres.mp4 », ou
 * « - aperçu.mp4 » pour l'aperçu de 6 s (d'après la clé servie, pas `outputKey` :
 * une ancienne ligne n'en a pas). Seule une URL perd sa query : un nom brut peut
 * contenir « ? ».
 */
function downloadFilename(inputUrl: string | null, key: string): string {
  const raw = inputUrl ?? "";
  const path = ABSOLUTE_URL.test(raw) ? raw.split(/[?#]/, 1)[0] : raw;
  const stem = sanitizeZipStem(path.slice(path.lastIndexOf("/") + 1), "video");
  const suffix = captionOutputKind(key) === "preview" ? "aperçu" : "sous-titres";
  return `${stem} - ${suffix}.mp4`;
}

type DownloadTarget = { kind: "r2"; key: string } | { kind: "local"; path: string };

/**
 * Clé R2 du fichier : `outputKey`, sinon celle que porte `outputUrl` (anciennes lignes,
 * d'avant `outputKey` : sans ce repli leur bouton Télécharger répondrait 404 en prod).
 * L'URL passe deux gardes : l'origine du CDN (`isR2PublicUrl`, celle des webhooks), puis
 * le préfixe STRICT de R2_PUBLIC_URL (`r2KeyFromPublicUrl`, qui retire aussi query et
 * fragment). Une URL hors de notre R2 ne donne aucune clé.
 */
function r2KeyOf(job: { outputKey: string | null; outputUrl: string | null }): string | null {
  if (job.outputKey) return job.outputKey;
  if (!isR2PublicUrl(job.outputUrl)) return null;
  return r2KeyFromPublicUrl(job.outputUrl, process.env.R2_PUBLIC_URL);
}

/** Où est le fichier ? Null si rien ne peut être servi. */
function resolveTarget(job: { outputKey: string | null; outputUrl: string | null }): DownloadTarget | null {
  if (r2Configured()) {
    const key = r2KeyOf(job);
    if (key) return { kind: "r2", key };
  }
  // Stockage local, en dev seulement (`isLocalStorage()` est faux en production). Le chemin
  // /api/captions/outputs/* y est servi par la réécriture `beforeFiles` de next.config.ts,
  // SANS authentification : elle passe avant le route handler api/captions/[...path] (donc
  // avant son contrôle du propriétaire) et le matcher de proxy.ts écarte les chemins à
  // extension. Le contrôle de cette route ne garde donc que la remise de l'URL, pas le
  // fichier. Seul ce préfixe est accepté : une URL absolue ou protocole-relative ferait de
  // la route une redirection ouverte depuis le domaine de l'app.
  if (job.outputUrl?.startsWith(LOCAL_OUTPUT_PREFIX)) return { kind: "local", path: job.outputUrl };
  return null;
}

function gone() {
  return NextResponse.json({ error: CAPTION_RETENTION_COPY.expiredError, expired: true }, { status: 410 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  // `select` : la ligne porte aussi `srtContent` et `config`, inutiles ici.
  const job = await prisma.captionJob.findUnique({
    where: { id },
    select: { userId: true, status: true, inputUrl: true, outputKey: true, outputUrl: true, outputExpiredAt: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json({ error: "Sous-titrage non terminé" }, { status: 409 });
  }
  if (job.outputExpiredAt) return gone();

  // Décidé avant d'enregistrer l'accès : une requête qui ne sert aucun fichier
  // n'est pas une activité, elle ne doit pas repousser la purge.
  const target = resolveTarget(job);
  if (!target) {
    return NextResponse.json({ error: "Fichier de sortie introuvable" }, { status: 404 });
  }

  // Enregistrement et garde de la purge en un seul UPDATE … WHERE : si la purge a
  // réclamé la ligne depuis la lecture ci-dessus, 0 ligne ; sinon l'accès est posé
  // et la purge ne peut plus la réclamer (sa propre garde relit `lastAccessedAt`).
  const { count } = await prisma.captionJob.updateMany({
    where: { id, status: "COMPLETED", outputExpiredAt: null },
    data: { lastAccessedAt: new Date() },
  });
  if (count === 0) return gone();

  if (target.kind === "r2") {
    const filename = downloadFilename(job.inputUrl, target.key);
    const url = await createPresignedDownloadUrl(
      target.key,
      filename,
      PRESIGNED_TTL_SECONDS,
      attachmentDisposition(filename),
    );
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  }
  return NextResponse.redirect(new URL(target.path, req.url), { status: 302, headers: NO_STORE });
}

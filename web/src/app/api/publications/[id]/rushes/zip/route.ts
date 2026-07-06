/**
 * GET /api/publications/[id]/rushes/zip
 *
 * Télécharge tous les rushes non-supprimés d'un slot dans un seul .zip.
 * Permet à la CM / au monteur de récupérer le bundle en un clic au lieu
 * de télécharger fichier par fichier.
 *
 * Garde permissions : seul un user ayant `canSeePublication` accède
 * (équivalent aux liens individuels).
 *
 * L'archive est **streamée** : chaque rush est lu en flux depuis R2 et poussé
 * directement dans l'archive (STORE, pas de compression — vidéos déjà compressées),
 * l'archive étant elle-même streamée vers la réponse. La mémoire serveur reste
 * ~constante quelle que soit la taille totale (vs l'ancienne construction JSZip
 * in-memory qui bufferisait 2-3× le bundle en RAM → OOM/PM2 restart → 502).
 */
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canSeePublication } from "@/lib/permissions/publications";
import { getR2ObjectStream, r2Configured } from "@/lib/r2";

// archiver + node:stream requièrent le runtime Node (pas edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id: slotId } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      title: true,
      assigneeCmId: true,
      assigneeMonteurId: true,
      assigneeVideasteId: true,
      account: { select: { handle: true } },
    },
  });
  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const allowed = canSeePublication(userContext.effectiveUser, {
    id: slot.id,
    assigneeCmId: slot.assigneeCmId,
    assigneeMonteurId: slot.assigneeMonteurId,
    assigneeVideasteId: slot.assigneeVideasteId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  if (!r2Configured()) {
    return NextResponse.json(
      { error: "R2 non configuré — téléchargement zip indisponible." },
      { status: 503 },
    );
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { slotId, deletedAt: null },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, r2Key: true, fileName: true },
  });

  if (rushes.length === 0) {
    return NextResponse.json({ error: "Aucun rush à zipper." }, { status: 404 });
  }

  // Archive streamée. STORE : les rushes vidéo sont déjà compressés, DEFLATE
  // n'apporterait rien et coûterait du CPU.
  const archive = new ZipArchive({ store: true });
  archive.on("warning", (err) => console.warn("[rushes/zip] archive warning:", err));
  archive.on("error", (err) => console.error("[rushes/zip] archive error:", err));

  // Producteur : append séquentiel (on attend la fin de lecture de chaque flux R2
  // avant d'ouvrir le suivant) → un seul flux R2 ouvert à la fois, mémoire bornée.
  const used = new Set<string>();
  void (async () => {
    for (const rush of rushes) {
      try {
        const body = await getR2ObjectStream(rush.r2Key);
        archive.append(body, { name: ensureUniqueName(used, rush.fileName) });
        await finished(body);
      } catch (err) {
        console.warn(`[rushes/zip] skip rush ${rush.id} (r2Key=${rush.r2Key}): ${String(err)}`);
      }
    }
    await archive.finalize();
  })().catch((err) => {
    console.error("[rushes/zip] producer failed:", err);
    archive.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  const archiveName = slugifyForFilename(
    `${slot.account?.handle ?? "sans-compte"}-${slot.title ?? slotId}-rushes`,
  );

  const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}.zip"`,
      // Désactive le proxy_buffering Nginx pour cette réponse : le zip streame
      // vers le client sans re-bufferisation (sinon time-to-first-byte long +
      // fichiers temporaires disque côté Nginx).
      "X-Accel-Buffering": "no",
    },
  });
}

/** Dédoublonne les noms de fichiers en cas de conflit (re-upload du même nom). */
function ensureUniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (used.has(`${base}-${i}${ext}`)) i++;
  const unique = `${base}-${i}${ext}`;
  used.add(unique);
  return unique;
}

function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "rushes";
}

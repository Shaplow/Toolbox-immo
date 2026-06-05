/**
 * GET /api/publications/[id]/rushes/zip
 *
 * Télécharge tous les rushes non-supprimés d'un slot dans un seul .zip.
 * Permet à la CM / au monteur de récupérer le bundle en un clic au lieu
 * de télécharger fichier par fichier.
 *
 * Garde permissions : seul un user ayant `canSeePublication` accède
 * (équivalent aux liens individuels). Limite taille totale 5 GB pour
 * éviter d'exploser la mémoire du serveur (JSZip in-memory).
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canSeePublication } from "@/lib/permissions/publications";
import { getFromR2, r2Configured } from "@/lib/r2";

type RouteContext = { params: Promise<{ id: string }> };

// 5 GB cap — protège la mémoire serveur. Au-delà, on conseille DL unitaire.
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;

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
    select: { id: true, r2Key: true, fileName: true, sizeBytes: true },
  });

  if (rushes.length === 0) {
    return NextResponse.json({ error: "Aucun rush à zipper." }, { status: 404 });
  }

  // Si > 50% des rushes ont sizeBytes null (uploads legacy ou clients qui
  // omettaient le champ), le guard MAX_TOTAL_BYTES devient inutilisable :
  // chaque null contribue 0 et le cap est silencieusement contourné, ce qui
  // permet d'exploser la mémoire du process Next en chargeant N rushes en
  // RAM. On refuse plutôt que tenter — mieux vaut explicite que crash.
  const nullSizeCount = rushes.filter((r) => r.sizeBytes == null).length;
  if (nullSizeCount > rushes.length / 2) {
    return NextResponse.json(
      {
        error:
          "Impossible d'estimer la taille totale (trop de rushes sans sizeBytes). Téléchargez les rushes individuellement.",
      },
      { status: 409 },
    );
  }

  const totalBytes = rushes.reduce((acc, r) => acc + (r.sizeBytes ?? 0), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Bundle trop volumineux (${Math.round(totalBytes / (1024 * 1024 * 1024))} GB > 5 GB). Télécharger les rushes individuellement.`,
      },
      { status: 413 },
    );
  }

  // Build zip in-memory. Pour rester simple — pour très gros bundles, on
  // envisagera archiver streaming. Ici on dépasse rarement 1 GB.
  const zip = new JSZip();
  for (const rush of rushes) {
    try {
      const buf = await getFromR2(rush.r2Key);
      // Dédoublonner les noms si conflit (rare mais possible si re-upload)
      const safeName = ensureUniqueName(zip, rush.fileName);
      zip.file(safeName, buf, { binary: true });
    } catch (err) {
      console.warn(`[rushes/zip] skip rush ${rush.id} (r2Key=${rush.r2Key}): ${String(err)}`);
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE", // les rushes vidéo sont déjà compressés — pas de gain à DEFLATE
  });

  const archiveName = slugifyForFilename(
    `${slot.account.handle}-${slot.title ?? slotId}-rushes`,
  );

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveName}.zip"`,
      "Content-Length": zipBuffer.length.toString(),
    },
  });
}

function ensureUniqueName(zip: JSZip, name: string): string {
  if (!zip.file(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (zip.file(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
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

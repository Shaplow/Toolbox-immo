/**
 * PUT /api/publications/[id]/upload-local?r2Key=<key>
 *
 * Endpoint de fallback local pour les uploads de publications quand R2
 * n'est pas configuré (dev). Le client envoie le fichier brut comme corps
 * de la requête, comme s'il faisait un PUT vers une URL S3 pré-signée.
 *
 * Sécurité :
 * - Auth obligatoire (getUserContext).
 * - Le slot doit être accessible au user (canUserAccessSlot).
 * - La permission par kind est vérifiée comme dans upload-presign — sauf
 *   qu'ici on dérive le kind du r2Key (chemin /rushes/, /versions/, /brief/).
 * - r2Key doit commencer par `publications/{slotId}/` (anti cross-slot).
 * - Path traversal bloqué par lib/storage.
 *
 * En prod ou si R2 est configuré, retourne 503 — cette route n'a pas vocation
 * à coexister avec R2.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import {
  canUploadRushes,
  canUploadVersion,
  canEditBrief,
} from "@/lib/permissions/publications";
import { isLocalStorage, writeLocalObject } from "@/lib/storage";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

type Params = { params: Promise<{ id: string }> };

// Mêmes seuils que upload-presign — répétés pour ne pas créer de dépendance
// cyclique (presign importerait storage qui importerait presign).
// Ce chemin traverse Next.js et bufferise le fichier entier en RAM : il ne doit
// PAS hériter du plafond de rush (100 Go), qui ne vaut que pour le direct-to-R2.
// Le vrai plafond ici est `client_max_body_size` de nginx et la RAM du process.
const MAX_SIZE_BY_KIND: Record<string, number> = {
  rush: UPLOAD_LIMITS.SERVER_PROXIED_MAX_BYTES,
  version: UPLOAD_LIMITS.SERVER_PROXIED_MAX_BYTES,
  "brief-attachment": UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES,
};

function inferKindFromKey(r2Key: string, slotId: string): "rush" | "version" | "brief-attachment" | null {
  const prefix = `publications/${slotId}/`;
  if (!r2Key.startsWith(prefix)) return null;
  const rest = r2Key.slice(prefix.length);
  if (rest.startsWith("rushes/")) return "rush";
  if (rest.startsWith("versions/")) return "version";
  if (rest.startsWith("brief/")) return "brief-attachment";
  return null;
}

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isLocalStorage()) {
    return NextResponse.json(
      { error: "Fallback local désactivé (R2 configuré ou prod)" },
      { status: 503 },
    );
  }

  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const r2Key = req.nextUrl.searchParams.get("r2Key") ?? "";
  if (!r2Key) {
    return NextResponse.json({ error: "Paramètre r2Key requis" }, { status: 400 });
  }

  const kind = inferKindFromKey(r2Key, slotId);
  if (!kind) {
    return NextResponse.json(
      { error: "r2Key invalide ou hors slot" },
      { status: 400 },
    );
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const user = { id: userId, role };
  if (kind === "rush" && !canUploadRushes(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }
  if (kind === "version" && !canUploadVersion(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }
  if (kind === "brief-attachment" && !canEditBrief(user, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  const maxSize = MAX_SIZE_BY_KIND[kind];
  if (contentLength > maxSize) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${Math.round(maxSize / (1024 * 1024))} MB)` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > maxSize) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${Math.round(maxSize / (1024 * 1024))} MB)` },
      { status: 413 },
    );
  }

  try {
    await writeLocalObject(r2Key, buf);
  } catch (err) {
    console.error(`[upload-local] write failed key=${r2Key}:`, err);
    return NextResponse.json(
      { error: "Échec écriture disque" },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 200 });
}

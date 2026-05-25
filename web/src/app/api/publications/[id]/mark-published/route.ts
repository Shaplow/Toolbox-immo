/**
 * POST /api/publications/[id]/mark-published — marque un slot comme publié sur Instagram
 *
 * Auth : session obligatoire → 401.
 *        canMarkPublished → 403 (pas 404 — cas légitime à expliquer à l'utilisateur).
 *
 * Body : { url: string, publishedAt?: string ISO }
 *   - url       : doit commencer par "https://" (validation minimale, domain check Phase 2)
 *   - publishedAt : ISO parsable ; si absent, on utilise now()
 *
 * Stockage URL : le modèle PublicationSlot n'a pas encore de champ dédié
 * pour l'URL Instagram (TODO Phase 1.3.4 — ajouter publishedUrl + publishedAt).
 * Stratégie minimale pour ce commit : l'URL est stockée dans `notes` sous la forme
 * d'une ligne PUBLISHED_URL: <url> ajoutée en tête, afin de ne pas écraser
 * les notes existantes.
 *
 * Après update : log d'activité PUBLISHED.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canMarkPublished } from "@/lib/permissions/publications";
import { logActivity } from "@/lib/publications/activity";
import type { UserRole } from "@/types/roles";
import { USER_ROLES } from "@/types/roles";

/** Normalise un rôle brut vers UserRole. Valeur inconnue → USER. */
function toUserRole(raw?: string | null): UserRole {
  if (raw && Object.hasOwn(USER_ROLES, raw)) return raw as UserRole;
  return "USER";
}

/** Construit la nouvelle valeur de `notes` en ajoutant/remplaçant la ligne PUBLISHED_URL. */
function upsertPublishedUrlInNotes(existingNotes: string | null, url: string): string {
  const PREFIX = "PUBLISHED_URL: ";
  const newLine = `${PREFIX}${url}`;

  if (!existingNotes) {
    return newLine;
  }

  // Remplacer la ligne existante si elle est déjà là, sinon la préfixer.
  const lines = existingNotes.split("\n");
  const existingIndex = lines.findIndex((l) => l.startsWith(PREFIX));

  if (existingIndex >= 0) {
    lines[existingIndex] = newLine;
    return lines.join("\n");
  }

  // Pas encore de ligne PUBLISHED_URL — la mettre en tête.
  return `${newLine}\n${existingNotes}`;
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      notes: true,
      status: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  // 403 ici (pas 404) : l'utilisateur sait que le slot existe ; on lui explique
  // qu'il n'a pas la permission de marquer comme publié.
  if (!canMarkPublished({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Permission insuffisante pour marquer ce slot comme publié" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { url, publishedAt: publishedAtRaw } = rawBody as Record<string, unknown>;

  if (typeof url !== "string" || !url.startsWith("https://")) {
    return NextResponse.json(
      { error: "url est requis et doit commencer par https://" },
      { status: 400 }
    );
  }

  let effectivePublishedAt: Date;
  if (publishedAtRaw !== undefined) {
    const parsed = new Date(publishedAtRaw as string);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "publishedAt invalide" }, { status: 400 });
    }
    effectivePublishedAt = parsed;
  } else {
    effectivePublishedAt = new Date();
  }

  const updatedNotes = upsertPublishedUrlInNotes(slot.notes, url);

  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      status: "PUBLISHED",
      notes: updatedNotes,
    },
    select: { id: true, status: true, notes: true, updatedAt: true },
  });

  // Log non bloquant.
  await logActivity(prisma, {
    slotId,
    actorId: userId,
    type: "PUBLISHED",
    payload: {
      url,
      publishedAt: effectivePublishedAt.toISOString(),
    },
  });

  return NextResponse.json({
    ...updated,
    // Exposer l'URL et la date effective pour confirmation côté client.
    publishedUrl: url,
    publishedAt: effectivePublishedAt.toISOString(),
  });
}

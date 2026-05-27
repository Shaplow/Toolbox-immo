/**
 * POST /api/publications/[id]/mark-published — marque un slot comme publié sur Instagram
 *
 * Auth : session obligatoire → 401.
 *        canMarkPublished → 403 (pas 404 — cas légitime à expliquer à l'utilisateur).
 *
 * Body : { url: string, publishedAt?: string ISO }
 *   - url       : doit être une URL https:// pointant vers instagram.com ou www.instagram.com,
 *                 max 500 caractères. Validation stricte via URL() + allowlist hôtes.
 *   - publishedAt : ISO parsable ; si absent, on utilise now()
 *
 * Stockage URL : champ dédié `publishedUrl` + `publishedAt` sur PublicationSlot
 * (migration 20260525134426_add_published_url_to_slot).
 *
 * Après update : log d'activité PUBLISHED.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canMarkPublished } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/publications/activity";
import { canTransition } from "@/lib/publications/transitions";

/** Hôtes Instagram autorisés pour l'URL de publication. */
const ALLOWED_INSTAGRAM_HOSTS = ["www.instagram.com", "instagram.com"] as const;

/** Longueur max de l'URL Instagram. */
const MAX_URL_LENGTH = 500;

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

  // L5 — Vérification de transition : seul ADMIN peut passer depuis n'importe quel statut.
  // CM ne peut publier que depuis SCHEDULED (statut attendu avant publication IG).
  // L'ADMIN bypass la matrice (canTransition retourne true pour ADMIN vers tout statut).
  if (!canTransition(slot.status, "PUBLISHED", role)) {
    return NextResponse.json(
      {
        error: `Transition non autorisée : impossible de passer de "${slot.status}" à "PUBLISHED" pour le rôle "${role}"`,
      },
      { status: 400 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { url, publishedAt: publishedAtRaw } = rawBody as Record<string, unknown>;

  if (typeof url !== "string") {
    return NextResponse.json({ error: "url est requis" }, { status: 400 });
  }

  // M1 — Validation URL stricte : protocole, hôte, longueur.
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: `URL trop longue (max ${MAX_URL_LENGTH})` }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL invalide" }, { status: 400 });
  }

  if (parsedUrl.protocol !== "https:") {
    return NextResponse.json({ error: "URL doit être en https" }, { status: 400 });
  }

  if (!(ALLOWED_INSTAGRAM_HOSTS as readonly string[]).includes(parsedUrl.host)) {
    return NextResponse.json({ error: "URL doit pointer vers instagram.com" }, { status: 400 });
  }

  let effectivePublishedAt: Date;
  if (publishedAtRaw !== undefined) {
    const parsed = new Date(publishedAtRaw as string);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "publishedAt invalide" }, { status: 400 });
    }
    // E4 — fix L6 : borner publishedAt à une fenêtre raisonnable.
    // Avant : dates futures lointaines ou très anciennes acceptées (data hygiene
    // risque + tri/affichage cassé). Maintenant : 2020-01-01 ≤ publishedAt ≤ now + 1 an.
    const minDate = new Date("2020-01-01T00:00:00Z");
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (parsed < minDate || parsed > maxDate) {
      return NextResponse.json(
        { error: "publishedAt hors fenêtre autorisée (2020 → +1 an)" },
        { status: 400 }
      );
    }
    effectivePublishedAt = parsed;
  } else {
    effectivePublishedAt = new Date();
  }

  // H2 — Stocker l'URL et la date dans les champs dédiés (plus de hack notes).
  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      status: "PUBLISHED",
      publishedUrl: url,
      publishedAt: effectivePublishedAt,
    },
    select: { id: true, status: true, publishedUrl: true, publishedAt: true, updatedAt: true },
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
    publishedUrl: url,
    publishedAt: effectivePublishedAt.toISOString(),
  });
}

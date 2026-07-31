/**
 * POST /api/publications/[id]/mark-published — marque un slot comme publié sur Instagram
 *
 * Auth : session obligatoire → 401.
 *        canMarkPublished → 403 (pas 404 — cas légitime à expliquer à l'utilisateur).
 *
 * Body : { url?: string, publishedAt?: string ISO }
 *   - url       : doit être une URL https:// pointant vers instagram.com ou www.instagram.com,
 *                 max 500 caractères. Validation stricte via URL() + allowlist hôtes.
 *                 **Optionnel pour un ADMIN uniquement** : le post est parti mais le lien
 *                 n'est pas encore récupéré. Le slot passe PUBLISHED avec publishedUrl null,
 *                 et l'UI le signale comme incomplet. Les autres rôles doivent le fournir.
 *   - publishedAt : ISO parsable ; si absent, on utilise now()
 *
 * Stockage URL : champ dédié `publishedUrl` + `publishedAt` sur PublicationSlot
 * (migration 20260525134426_add_published_url_to_slot).
 *
 * Après update : log d'activité PUBLISHED.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canMarkPublished, canMarkPublishedWithoutUrl } from "@/lib/permissions/publications";
import { logActivity } from "@/lib/services/slot/activity";
import { canTransition } from "@/lib/services/slot/transitions";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";

/** Hôtes Instagram autorisés pour l'URL de publication. */
const ALLOWED_INSTAGRAM_HOSTS = ["www.instagram.com", "instagram.com"] as const;

/** Longueur max de l'URL Instagram. */
const MAX_URL_LENGTH = 500;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: slotId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  const { userContext, slot, role, userId } = r.ctx;

  // 403 ici (pas 404) : l'utilisateur sait que le slot existe ; on lui explique
  // qu'il n'a pas la permission de marquer comme publié.
  if (!canMarkPublished({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Permission insuffisante pour marquer ce slot comme publié" }, { status: 403 });
  }

  // Missions — une publication sur Instagram suppose un compte. Une mission sans
  // compte (production stock) ne peut pas être marquée publiée tant qu'aucun
  // compte n'a été assigné. resolveSlotContext ne charge pas accountId (volontairement
  // minimal) → petit findUnique dédié.
  const slotAccount = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { accountId: true, publishedAt: true },
  });
  if (!slotAccount?.accountId) {
    return NextResponse.json(
      { error: "Assignez d'abord un compte Instagram à cette mission avant de la marquer publiée." },
      { status: 400 },
    );
  }

  // L5 — Vérification de transition : seul ADMIN peut passer depuis n'importe quel statut.
  // CM ne peut publier que depuis SCHEDULED (statut attendu avant publication IG).
  // L'ADMIN bypass la matrice (canTransition retourne true pour ADMIN vers tout statut).
  //
  // Exception : un slot DÉJÀ publié n'effectue aucune transition — cette route sert
  // alors à compléter ou corriger l'URL. La matrice (PUBLISHED → ["ARCHIVED"]) la
  // refuserait à un CM, ce qui bloquerait le rattrapage d'un post marqué publié sans lien.
  const isCompletingPublished = slot.status === "PUBLISHED";
  if (!isCompletingPublished && !canTransition(slot.status, "PUBLISHED", role)) {
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

  // URL absente ou vide : toléré pour un ADMIN seulement (publication constatée,
  // lien à renseigner plus tard). Pour tous les autres rôles, elle reste requise.
  const rawUrl = typeof url === "string" ? url.trim() : "";
  const hasUrl = rawUrl.length > 0;

  if (!hasUrl) {
    if (url !== undefined && url !== null && typeof url !== "string") {
      return NextResponse.json({ error: "url doit être une chaîne" }, { status: 400 });
    }
    if (!canMarkPublishedWithoutUrl({ role })) {
      return NextResponse.json({ error: "url est requis" }, { status: 400 });
    }
  }

  // M1 — Validation URL stricte : protocole, hôte, longueur.
  if (hasUrl) {
    if (rawUrl.length > MAX_URL_LENGTH) {
      return NextResponse.json({ error: `URL trop longue (max ${MAX_URL_LENGTH})` }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: "URL invalide" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "URL doit être en https" }, { status: 400 });
    }

    if (!(ALLOWED_INSTAGRAM_HOSTS as readonly string[]).includes(parsedUrl.host)) {
      return NextResponse.json({ error: "URL doit pointer vers instagram.com" }, { status: 400 });
    }
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
  } else if (isCompletingPublished && slotAccount.publishedAt) {
    // On complète l'URL d'un slot déjà publié : la date de publication d'origine
    // fait foi, la remplacer par now() la fausserait.
    effectivePublishedAt = slotAccount.publishedAt;
  } else {
    effectivePublishedAt = new Date();
  }

  // H2 — Stocker l'URL et la date dans les champs dédiés (plus de hack notes).
  // publishedUrl n'est écrit que si une URL est fournie : sur un slot déjà publié,
  // écrire null effacerait le lien existant (le bouton « Corriger l'URL » emprunte
  // cette même route).
  const updated = await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      status: "PUBLISHED",
      ...(hasUrl ? { publishedUrl: rawUrl } : {}),
      publishedAt: effectivePublishedAt,
    },
    select: { id: true, status: true, publishedUrl: true, publishedAt: true, updatedAt: true },
  });

  // Log non bloquant.
  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "PUBLISHED",
    payload: {
      ...(hasUrl ? { url: rawUrl } : {}),
      publishedAt: effectivePublishedAt.toISOString(),
    },
  });

  return NextResponse.json({
    ...updated,
    publishedAt: effectivePublishedAt.toISOString(),
  });
}

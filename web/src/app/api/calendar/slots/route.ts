/**
 * GET  /api/calendar/slots — liste les slots avec filtres, scopée par rôle
 * POST /api/calendar/slots — création manuelle d'un slot (admin uniquement)
 *
 * Filtrage par rôle (commit 1.2.2) :
 *   ADMIN   → tous les slots (aucune restriction)
 *   MONTEUR → uniquement les slots dont assigneeMonteurId = userId
 *   CM      → uniquement les slots dont assigneeCmId = userId
 *   USER    → aucun slot (clause impossible "__never__")
 *
 * L'impersonation s'applique : la vue est celle de effectiveUser. Un admin qui
 * impersonne un MONTEUR voit uniquement les slots assignés à ce MONTEUR.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { whereClauseForUser } from "@/lib/permissions/slotScope";
import type { UserRole } from "@/types/roles";
import { USER_ROLES } from "@/types/roles";

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/** Normalise un rôle brut (String en base) vers UserRole. Valeur inconnue → USER. */
function toUserRole(raw?: string | null): UserRole {
  if (raw && Object.hasOwn(USER_ROLES, raw)) return raw as UserRole;
  return "USER";
}

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // ADMIN, MONTEUR, et CM peuvent lire. USER n'a pas accès à la pipeline éditoriale.
  if (role === "USER") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const contentType = searchParams.get("contentType") ?? undefined;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  // Le scope de rôle est placé en premier dans AND pour que les filtres URL
  // ne puissent jamais l'écraser (protection contre un futur filtre ?id=X qui
  // overriderait le scope USER "{id:'__never__'}" via spread).
  const roleScope = whereClauseForUser(role, userId);

  const slots = await prisma.publicationSlot.findMany({
    where: {
      AND: [
        roleScope,
        accountId ? { accountId } : {},
        status ? { status } : {},
        contentType ? { contentType } : {},
        dateFrom || dateTo
          ? {
              scheduledAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {},
      ],
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
    },
  });

  return NextResponse.json({
    slots: slots.map((s) => ({
      ...s,
      fields: safeJSON<Record<string, string>>(s.fields, {}),
      fieldSchema: safeJSON<string[]>(s.fieldSchema, []),
    })),
    hasMore: slots.length === 500,
  });
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  // POST reste réservé aux admins — la création de slots est une opération de planification.
  // L'impersonation ne donne pas les droits d'un admin : canAdminBypass est false quand on impersonne.
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const body = await req.json();
  const {
    accountId,
    scheduledAt,
    title,
    caption,
    notes,
    templateId,
    fields,
    fieldSchema,
    // Recipe-based creation (commit 1.2.3)
    recipeId,
    // Les assignees peuvent être fournis explicitement (override) ou déduits depuis la recipe
    assigneeMonteurId: rawAssigneeMonteurId,
    assigneeCmId: rawAssigneeCmId,
  } = body;

  // contentType peut venir du body (legacy) ou être dérivé depuis recipe.code
  let { contentType } = body as { contentType?: string };

  // --- Résolution de la recipe si fournie ---
  let resolvedAssigneeMonteurId: string | null = rawAssigneeMonteurId ?? null;
  let resolvedAssigneeCmId: string | null = rawAssigneeCmId ?? null;

  if (recipeId) {
    const recipe = await prisma.contentRecipe.findUnique({ where: { id: recipeId } });
    if (!recipe) {
      return NextResponse.json({ error: "Recipe introuvable" }, { status: 400 });
    }
    // Dériver contentType depuis recipe.code si non fourni dans le body
    if (!contentType) {
      contentType = recipe.code;
    }
    // Préfill des assignees : la valeur du body prime (override admin), sinon fallback recipe
    if (!resolvedAssigneeMonteurId && recipe.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = recipe.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && recipe.defaultAssigneeCmId) {
      resolvedAssigneeCmId = recipe.defaultAssigneeCmId;
    }
  }

  if (!accountId || !scheduledAt || !contentType) {
    return NextResponse.json(
      { error: "accountId, scheduledAt et contentType sont requis (ou fournir recipeId)" },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const parsedScheduledAt = new Date(scheduledAt);
  if (isNaN(parsedScheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduledAt invalide" }, { status: 400 });
  }

  // Valider que les assignees référencent des Users existants si fournis
  if (resolvedAssigneeMonteurId) {
    const monteur = await prisma.user.findUnique({ where: { id: resolvedAssigneeMonteurId } });
    if (!monteur) {
      return NextResponse.json({ error: "assigneeMonteurId : utilisateur introuvable" }, { status: 400 });
    }
  }
  if (resolvedAssigneeCmId) {
    const cm = await prisma.user.findUnique({ where: { id: resolvedAssigneeCmId } });
    if (!cm) {
      return NextResponse.json({ error: "assigneeCmId : utilisateur introuvable" }, { status: 400 });
    }
  }

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId,
      scheduledAt: parsedScheduledAt,
      contentType,
      title: title ?? null,
      caption: caption ?? null,
      notes: notes ?? null,
      templateId: templateId ?? null,
      fields: fields ? JSON.stringify(fields) : "{}",
      fieldSchema: fieldSchema ? JSON.stringify(fieldSchema) : "[]",
      isAuto: false,
      recipeId: recipeId ?? null,
      assigneeMonteurId: resolvedAssigneeMonteurId,
      assigneeCmId: resolvedAssigneeCmId,
    },
    include: {
      account: { select: { id: true, name: true, handle: true, offre: true } },
    },
  });

  return NextResponse.json({
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  });
}

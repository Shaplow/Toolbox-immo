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
import { toUserRole } from "@/lib/permissions/role";
import { syncSlotsPipelineStatuses } from "@/lib/publications/transitions";

/** Safely parse a JSON string. Returns `fallback` if the string is falsy or invalid. */
function safeJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // ADMIN, MONTEUR, et CM peuvent lire. USER n'a pas accès à la pipeline éditoriale.
  if (role === "EXTERNAL_GENERATOR") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const patternId = searchParams.get("patternId") ?? undefined;
  const monteurId = searchParams.get("monteurId") ?? undefined;
  const cmId = searchParams.get("cmId") ?? undefined;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  // Le scope de rôle est placé en premier dans AND pour que les filtres URL
  // ne puissent jamais l'écraser (protection contre un futur filtre ?id=X qui
  // overriderait le scope USER "{id:'__never__'}" via spread).
  const roleScope = whereClauseForUser(role, userId);

  // Les filtres monteurId/cmId sont des raffinements UX (ADMIN qui cherche
  // les slots d'un monteur). Si un MONTEUR ou CM essaie de les utiliser, le
  // roleScope reste prioritaire (intersection AND) — sauf risque sécurité.
  const slots = await prisma.publicationSlot.findMany({
    where: {
      AND: [
        roleScope,
        accountId ? { accountId } : {},
        status ? { status } : {},
        patternId ? { patternId } : {},
        monteurId ? { assigneeMonteurId: monteurId } : {},
        cmId ? { assigneeCmId: cmId } : {},
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
      account: { select: { id: true, name: true, handle: true } },
      template: { select: { id: true, name: true } },
      render: { select: { id: true, status: true, pngUrl: true, videoUrl: true } },
      // pattern.source + needsCaptions sont nécessaires pour le rattrapage
      // opportuniste des statuts (syncSlotsPipelineStatuses) — rattrape les
      // slots créés avant l'introduction des auto-transitions pipeline.
      // needs* + allows* pour l'affichage des valeurs héritées dans les
      // OverrideSelect du SlotDetailPanel (Cohérence Workflows Phase 4).
      pattern: {
        select: {
          label: true,
          source: true,
          needsCaptions: true,
          needsClientValidation: true,
          allowsClientRevision: true,
          needsDescription: true,
          needsRushes: true,
          needsBrief: true,
        },
      },
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });

  // Rattrapage opportuniste : un slot dont le render est PROCESSING/DONE
  // doit passer en IN_PROGRESS/READY_FOR_CM. Best-effort, non bloquant.
  const updates = await syncSlotsPipelineStatuses(
    prisma,
    slots.map((s) => ({
      id: s.id,
      status: s.status,
      pattern: s.pattern
        ? { source: s.pattern.source, needsCaptions: s.pattern.needsCaptions }
        : null,
      render: s.render ? { status: s.render.status } : null,
      captionJobs: s.captionJobs.map((c) => ({ status: c.status })),
    })),
  );

  return NextResponse.json({
    slots: slots.map((s) => ({
      ...s,
      // Reflet immédiat des transitions appliquées dans la réponse
      status: updates.get(s.id) ?? s.status,
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
    // Pattern-based creation (Phase 1.6)
    patternId,
    // Les assignees peuvent être fournis explicitement (override) ou déduits depuis le pattern
    assigneeMonteurId: rawAssigneeMonteurId,
    assigneeCmId: rawAssigneeCmId,
    assigneeVideasteId: rawAssigneeVideasteId,
    // Phase 6 — overrides one-off (uniquement si pattern=null)
    needsCaptionsOverride,
    needsDescriptionOverride,
    needsRushesOverride,
    needsBriefOverride,
    coverModeOverride,
    // Phase 2 (Cohérence Rôles) — pickers preset/prompt one-off
    coverPresetIdOverride,
    captionPresetIdOverride,
    descriptionPromptIdOverride,
  } = body;

  // --- Résolution du pattern si fourni ---
  let resolvedAssigneeMonteurId: string | null = rawAssigneeMonteurId ?? null;
  let resolvedAssigneeCmId: string | null = rawAssigneeCmId ?? null;
  let resolvedAssigneeVideasteId: string | null = rawAssigneeVideasteId ?? null;

  if (patternId) {
    const pattern = await prisma.accountPattern.findUnique({ where: { id: patternId } });
    if (!pattern) {
      return NextResponse.json({ error: "Pattern introuvable" }, { status: 400 });
    }
    // Préfill des assignees : la valeur du body prime (override admin), sinon fallback pattern
    if (!resolvedAssigneeMonteurId && pattern.defaultAssigneeMonteurId) {
      resolvedAssigneeMonteurId = pattern.defaultAssigneeMonteurId;
    }
    if (!resolvedAssigneeCmId && pattern.defaultAssigneeCmId) {
      resolvedAssigneeCmId = pattern.defaultAssigneeCmId;
    }
    if (!resolvedAssigneeVideasteId && pattern.defaultAssigneeVideasteId) {
      resolvedAssigneeVideasteId = pattern.defaultAssigneeVideasteId;
    }
  }

  if (!accountId || !scheduledAt) {
    return NextResponse.json(
      { error: "accountId et scheduledAt sont requis" },
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
  if (resolvedAssigneeVideasteId) {
    const videaste = await prisma.user.findUnique({ where: { id: resolvedAssigneeVideasteId } });
    if (!videaste) {
      return NextResponse.json({ error: "assigneeVideasteId : utilisateur introuvable" }, { status: 400 });
    }
  }

  const slot = await prisma.publicationSlot.create({
    data: {
      accountId,
      scheduledAt: parsedScheduledAt,
      title: title ?? null,
      caption: caption ?? null,
      notes: notes ?? null,
      templateId: templateId ?? null,
      fields: fields ? JSON.stringify(fields) : "{}",
      fieldSchema: fieldSchema ? JSON.stringify(fieldSchema) : "[]",
      isAuto: false,
      patternId: patternId ?? null,
      assigneeMonteurId: resolvedAssigneeMonteurId,
      assigneeCmId: resolvedAssigneeCmId,
      assigneeVideasteId: resolvedAssigneeVideasteId,
      // Phase 6 — overrides one-off (uniquement si fournis dans le body)
      ...(needsCaptionsOverride !== undefined
        ? { needsCaptionsOverride: needsCaptionsOverride as boolean | null }
        : {}),
      ...(needsDescriptionOverride !== undefined
        ? { needsDescriptionOverride: needsDescriptionOverride as string | null }
        : {}),
      ...(needsRushesOverride !== undefined
        ? { needsRushesOverride: needsRushesOverride as boolean | null }
        : {}),
      ...(needsBriefOverride !== undefined
        ? { needsBriefOverride: needsBriefOverride as boolean | null }
        : {}),
      ...(coverModeOverride !== undefined
        ? { coverModeOverride: coverModeOverride as string | null }
        : {}),
      ...(coverPresetIdOverride !== undefined
        ? { coverPresetIdOverride: coverPresetIdOverride as string | null }
        : {}),
      ...(captionPresetIdOverride !== undefined
        ? { captionPresetIdOverride: captionPresetIdOverride as string | null }
        : {}),
      ...(descriptionPromptIdOverride !== undefined
        ? { descriptionPromptIdOverride: descriptionPromptIdOverride as string | null }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true, handle: true } },
    },
  });

  return NextResponse.json({
    ...slot,
    fields: safeJSON<Record<string, string>>(slot.fields, {}),
    fieldSchema: safeJSON<string[]>(slot.fieldSchema, []),
  });
}

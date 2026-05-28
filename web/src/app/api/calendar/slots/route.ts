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
 *
 * POST : logique métier extraite dans `services/slot/slotService.createSlot`.
 * GET  : à extraire en S1.7 — pour l'instant, reste tel quel.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { whereClauseForUser } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { syncSlotsPipelineStatuses } from "@/lib/services/slot/transitions";
import { createSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

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
          // Phase 5 — coverMode pour OverrideEnumSelect dans SlotDetailPanel
          coverMode: true,
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
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  try {
    const slot = await createSlot(body, userContext);
    return NextResponse.json(slot);
  } catch (err) {
    return mapServiceError(err);
  }
}

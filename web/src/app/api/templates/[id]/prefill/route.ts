/**
 * POST /api/templates/:id/prefill
 *
 * Calcule le contexte de pré-remplissage Content Library pour un template,
 * scopé sur un compte Instagram donné. Utilisé par ListingForm pour charger
 * les suggestions côté client après sélection du compte IG (quand le prefill
 * SSR a été bloqué car aucun accountId n'était connu au rendu de la page).
 *
 * Body JSON : {
 *   accountId?:     string | null,
 *   slotId?:        string | null,
 *   listingId?:     string | null,
 *   initialValues?: Record<string, unknown>,
 * }
 *
 * Réponse 200 : {
 *   context: LibraryPrefillContext | null,
 *   updatedInitialValues: Record<string, unknown>,
 * }
 *
 * Auth : getUserContext() (règle dure CLAUDE.md) + canAccessTemplate.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canAccessTemplate } from "@/lib/permissions";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";
import { buildMergedSchema } from "@/lib/generate/buildMergedSchema";
import { buildLibraryPrefillContext } from "@/lib/generate/buildLibraryPrefillContext";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id: templateId } = await params;

  const ok = userContext.canAdminBypass
    ? true
    : await canAccessTemplate(
        userContext.effectiveUser.id,
        templateId,
        userContext.effectiveUser.role ?? undefined,
      );
  if (!ok) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Parse body — default gracefully
  let body: {
    accountId?: string | null;
    slotId?: string | null;
    listingId?: string | null;
    initialValues?: Record<string, unknown>;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Mauvais JSON — on continue avec les defaults
  }

  const { accountId = null, slotId = null, listingId = null, initialValues = {} } = body;

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const mergedSchema = buildMergedSchema(json);

  const { context, updatedInitialValues } = await buildLibraryPrefillContext({
    json,
    mergedSchema,
    initialValues,
    accountId,
    slotId,
    listingId,
  });

  return NextResponse.json({
    context: context ?? null,
    updatedInitialValues: updatedInitialValues ?? {},
  });
}

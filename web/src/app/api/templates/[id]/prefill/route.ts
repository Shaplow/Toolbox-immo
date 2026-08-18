/**
 * POST /api/templates/:id/prefill
 *
 * Calcule le pré-remplissage complet du formulaire de génération pour un
 * template, scopé sur un compte Instagram donné : rejoue `buildSlotPrefill`
 * (fiche data, fiche tournage, overrides mission) EN PLUS de
 * `buildLibraryPrefillContext` (Content Library). Utilisé par ListingForm
 * pour recharger les suggestions côté client après sélection du compte IG
 * (quand le prefill SSR a été bloqué car aucun accountId n'était connu au
 * rendu de la page) — jusqu'ici cette route ne rejouait QUE le Content
 * Library, perdant silencieusement la fiche/le tournage au changement de
 * compte (asymétrie SSR/CSR).
 *
 * Body JSON : {
 *   accountId?:     string | null,
 *   slotId?:        string | null,
 *   listingId?:     string | null,
 *   initialValues?: Record<string, unknown>,
 *   provenance?:    ProvenanceMap,
 * }
 *
 * Réponse 200 : {
 *   context: LibraryPrefillContext | null,
 *   updatedInitialValues: Record<string, unknown>,
 *   provenance: ProvenanceMap,
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
import { buildSlotPrefill } from "@/lib/generate/buildSlotPrefill";
import { customFieldToSchemaField } from "@/lib/customFields";
import type { ProvenanceMap } from "@/lib/generate/provenance";

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
    provenance?: ProvenanceMap;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Mauvais JSON — on continue avec les defaults
  }

  const {
    accountId = null,
    slotId = null,
    listingId = null,
    initialValues = {},
    provenance: incomingProvenance = {},
  } = body;

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const mergedSchema = buildMergedSchema(json);

  // Rejoue fiche/tournage/mission sur le même `slotId` — symétrique au SSR.
  // `initialValues` porte les valeurs de formulaire courantes côté client
  // (couche de plus haute précédence), `incomingProvenance` leur provenance
  // suivie côté client (ListingForm) le cas échéant.
  const slotPrefill = await buildSlotPrefill({
    slotId,
    schema: mergedSchema,
    existingValues: initialValues,
    existingProvenance: incomingProvenance,
  });

  for (const cf of slotPrefill.customFormFields) {
    if (!mergedSchema.some((f) => f.key === cf.key)) {
      mergedSchema.push(customFieldToSchemaField(cf));
    }
  }

  const { context, updatedInitialValues } = await buildLibraryPrefillContext({
    json,
    mergedSchema,
    initialValues: slotPrefill.initialValues,
    accountId,
    slotId,
    listingId,
    provenance: slotPrefill.provenance,
  });

  return NextResponse.json({
    context: context ?? null,
    updatedInitialValues: updatedInitialValues ?? {},
    provenance: context?.prefilledKeys ?? slotPrefill.provenance,
  });
}

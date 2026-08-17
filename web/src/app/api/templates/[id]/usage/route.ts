/**
 * GET /api/templates/:id/usage
 *
 * Liste les recettes (PatternTemplate × PatternBinding) qui utilisent ce
 * template (templateId = id), pour rendre visible dans le builder l'impact
 * d'un changement de config Auto Captions / Auto Cover sur les publications.
 *
 * Retour : { patterns: TemplateUsagePattern[] } (cf. types/patternUsage.ts).
 * `kind` discrimine les lignes binding (id = PatternBinding.id) des lignes
 * « recette globale » sans binding (id = PatternTemplate.id).
 *
 * Sécurité :
 *  - Admin uniquement (les non-admins n'ont pas besoin de cette info dans
 *    le builder, qui leur reste accessible pour leurs propres templates).
 *  - 401 si non connecté, 403 si non-admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import type { TemplateUsagePattern } from "@/types/patternUsage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const templates = await prisma.patternTemplate.findMany({
    where: { templateId: id, isArchived: false },
    select: {
      id: true,
      label: true,
      captionPresetId: true,
      coverConfig: true,
      bindings: {
        select: {
          id: true,
          isActive: true,
          customLabel: true,
          captionPresetIdOverride: true,
          account: { select: { id: true, handle: true, name: true } },
        },
      },
    },
    orderBy: { label: "asc" },
  });

  // Une ligne par binding (recette appliquée à un compte) ; une ligne « globale »
  // sans compte pour les recettes catalogue sans binding.
  const result: TemplateUsagePattern[] = templates.flatMap((t): TemplateUsagePattern[] => {
    const cfg = (t.coverConfig as { enabled?: boolean; coverPresetName?: string } | null) ?? {};
    const base = {
      captionPresetId: t.captionPresetId,
      coverPresetName: cfg.coverPresetName ?? null,
      coverEnabled: cfg.enabled === true,
    };
    if (t.bindings.length === 0) {
      return [
        {
          kind: "template" as const,
          id: t.id,
          label: t.label,
          isActive: true,
          accountId: "",
          accountHandle: "recette globale",
          accountName: null as string | null,
          ...base,
        },
      ];
    }
    return t.bindings.map((b) => ({
      kind: "binding" as const,
      id: b.id,
      label: b.customLabel ?? t.label,
      isActive: b.isActive,
      accountId: b.account.id,
      accountHandle: b.account.handle,
      accountName: b.account.name,
      ...base,
      captionPresetId: b.captionPresetIdOverride ?? t.captionPresetId,
    }));
  });

  return NextResponse.json({ patterns: result });
}

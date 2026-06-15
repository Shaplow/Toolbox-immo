import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { PatternsCatalogClient } from "@/components/admin/PatternsCatalogClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalogue de recettes | Toolbox Immo Admin",
};

/**
 * /admin/patterns — catalogue global des recettes éditoriales (PatternTemplate).
 *
 * Une recette = un blueprint réutilisable cross-comptes (template + presets
 * + flags workflow). L'admin applique une recette à un compte via une
 * "liaison" (PatternBinding) qui porte le planning et les assignations
 * spécifiques au compte.
 */
export default async function AdminPatternsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  // Liste les recettes actives + compteur de liaisons (= sur combien de
  // comptes la recette est appliquée).
  const templates = await prisma.patternTemplate.findMany({
    where: { isArchived: false },
    orderBy: [{ source: "asc" }, { label: "asc" }],
    include: {
      template: { select: { id: true, name: true } },
      captionPreset: { select: { id: true, name: true } },
      descriptionPrompt: { select: { id: true, name: true } },
      _count: { select: { bindings: true } },
    },
  });

  // Données d'options pour le formulaire d'édition (créées via les routes
  // mais utiles à fournir au composant client pour éviter un fetch
  // supplémentaire).
  const [builderTemplates, captionPresets, descriptionPrompts] = await Promise.all([
    prisma.template.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.captionPreset.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.descriptionPrompt.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PatternsCatalogClient
      initialTemplates={templates.map((t) => ({
        id: t.id,
        label: t.label,
        source: t.source,
        templateName: t.template?.name ?? null,
        captionPresetName: t.captionPreset?.name ?? null,
        descriptionPromptName: t.descriptionPrompt?.name ?? null,
        needsCaptionsMode: t.needsCaptionsMode,
        needsDescription: t.needsDescription,
        coverMode: t.coverMode,
        needsAdminValidation: t.needsAdminValidation,
        needsClientValidation: t.needsClientValidation,
        allowsClientRevision: t.allowsClientRevision,
        needsBrief: t.needsBrief,
        bindingCount: t._count.bindings,
        notes: t.notes,
        updatedAt: t.updatedAt.toISOString(),
      }))}
      builderTemplates={builderTemplates}
      captionPresets={captionPresets}
      descriptionPrompts={descriptionPrompts}
    />
  );
}

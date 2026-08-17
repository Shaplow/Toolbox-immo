import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { PatternEditClient } from "./PatternEditClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const tpl = await prisma.patternTemplate.findUnique({
    where: { id },
    select: { label: true },
  });
  return {
    title: tpl ? `${tpl.label} · Édition recette | Toolbox Immo Admin` : "Édition recette",
  };
}

/**
 * /admin/patterns/[id]/edit — page SSR dédiée à l'édition d'une recette.
 *
 * Phase 9 V2 — Le drawer modal (PatternTemplateForm dans Drawer) reste utilisé
 * pour la création rapide depuis le catalogue ou la cascade depuis le picker
 * binding. Pour l'édition, l'écran complet est mieux : 18 champs + ConfirmDialog
 * d'impact + section "Comptes liés" lazy-loaded scrollait trop dans un drawer
 * 640px.
 */
export default async function PatternEditPage({ params }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }
  const { id } = await params;

  const tpl = await prisma.patternTemplate.findUnique({
    where: { id },
    include: {
      _count: { select: { bindings: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });
  if (!tpl) notFound();

  const [builderTemplates, captionPresets, descriptionPrompts, videoLibraries] = await Promise.all([
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
    prisma.mediaLibrary.findMany({
      where: { type: "video" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PatternEditClient
      templateId={tpl.id}
      initial={{
        id: tpl.id,
        label: tpl.label,
        source: tpl.source,
        templateId: tpl.templateId,
        captionPresetId: tpl.captionPresetId,
        descriptionPromptId: tpl.descriptionPromptId,
        descriptionFixedText: tpl.descriptionFixedText,
        coverMode: tpl.coverMode,
        needsDescription: tpl.needsDescription,
        needsCaptionsMode: tpl.needsCaptionsMode,
        needsAdminValidation: tpl.needsAdminValidation,
        needsClientValidation: tpl.needsClientValidation,
        allowsClientRevision: tpl.allowsClientRevision,
        needsBrief: tpl.needsBrief,
        requiresProperty: tpl.requiresProperty,
        requiresEntityTypeId: tpl.requiresEntityTypeId,
        notes: tpl.notes,
        bindingCount: tpl._count.bindings,
        autoSaveToLibraryId: tpl.autoSaveToLibraryId ?? null,
      }}
      builderTemplates={builderTemplates}
      captionPresets={captionPresets}
      descriptionPrompts={descriptionPrompts}
      videoLibraries={videoLibraries}
    />
  );
}

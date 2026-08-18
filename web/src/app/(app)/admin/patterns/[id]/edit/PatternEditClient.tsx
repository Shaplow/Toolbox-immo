"use client";

/**
 * PatternEditClient — wrapper client pour l'édition d'une recette en page SSR.
 *
 * Phase 9 V2 — branche PatternTemplateForm sur les routes API (PATCH/DELETE) +
 * navigue back vers le catalogue après save/archive/cancel. Le composant
 * form est partagé avec le drawer du catalogue (création rapide).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookMarked } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { toast } from "@/components/ui/Toast";
import {
  PatternTemplateForm,
  type PatternTemplateFormValues,
  type PatternTemplateInitial,
} from "@/components/admin/PatternTemplateForm";

interface PatternEditClientProps {
  templateId: string;
  initial: PatternTemplateInitial;
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
  videoLibraries: { id: string; name: string }[];
}

export function PatternEditClient({
  templateId,
  initial,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
}: PatternEditClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleSave(values: PatternTemplateFormValues) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success("Recette mise à jour");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${templateId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de l'archivage");
      }
      toast.success("Recette archivée");
      router.push("/admin/patterns");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    router.push("/admin/patterns");
  }

  return (
    <PageShell variant="default">
      <ToolPageHeader
        icon={BookMarked}
        title={initial.label || "Édition recette"}
        subtitle="Configuration · Édition recette"
        breadcrumb={
          <Link
            href="/admin/patterns"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft size={13} />
            Catalogue de recettes
          </Link>
        }
      />

      <div className="max-w-3xl mx-auto rounded-xl bg-card border border-border overflow-hidden">
        <PatternTemplateForm
          initial={initial}
          templateId={templateId}
          builderTemplates={builderTemplates}
          captionPresets={captionPresets}
          descriptionPrompts={descriptionPrompts}
          videoLibraries={videoLibraries}
          saving={saving}
          onSave={handleSave}
          onArchive={handleArchive}
          onClose={handleClose}
        />
      </div>
    </PageShell>
  );
}

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
import { ArrowLeft } from "lucide-react";
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
}

export function PatternEditClient({
  templateId,
  initial,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
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
    if (initial.bindingCount && initial.bindingCount > 0) {
      toast.error(
        `Cette recette est utilisée par ${initial.bindingCount} compte${initial.bindingCount > 1 ? "s" : ""}. Délie les liaisons avant d'archiver.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${templateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur lors de l'archivage");
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
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <Link
                href="/admin/patterns"
                className="inline-flex items-center gap-1.5 text-[12px] text-gray-600 hover:text-gray-900 transition-colors font-medium"
              >
                <ArrowLeft size={13} />
                Catalogue de recettes
              </Link>
              <p className="mt-4 text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Configuration · Édition recette
              </p>
            </div>

            <div className="rounded-3xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_4px_16px_-4px_rgba(15,23,42,0.10)] overflow-hidden">
              <PatternTemplateForm
                initial={initial}
                templateId={templateId}
                builderTemplates={builderTemplates}
                captionPresets={captionPresets}
                descriptionPrompts={descriptionPrompts}
                saving={saving}
                onSave={handleSave}
                onArchive={handleArchive}
                onClose={handleClose}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

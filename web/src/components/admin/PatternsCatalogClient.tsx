"use client";

/**
 * PatternsCatalogClient — UI du catalogue /admin/patterns.
 *
 * Liste glass des PatternTemplate avec compteur de liaisons par recette.
 * Click sur une card → ouvre PatternTemplateForm en Drawer pour édition.
 * Bouton "Nouvelle recette" → même drawer en mode création.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
  FileText,
  Inbox,
  Eye,
  MoreVertical,
  Rocket,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { DeployTemplateModal } from "./DeployTemplateModal";
import { PatternTemplateForm, type PatternTemplateFormValues } from "./PatternTemplateForm";
import { PatternPeekDrawer } from "./PatternPeekDrawer";

export interface CatalogItem {
  id: string;
  label: string;
  source: string;
  templateName: string | null;
  captionPresetName: string | null;
  descriptionPromptName: string | null;
  needsCaptionsMode: string;
  needsDescription: string;
  coverMode: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  bindingCount: number;
  notes: string | null;
  updatedAt: string;
}

interface PatternsCatalogClientProps {
  initialTemplates: CatalogItem[];
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
}

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Template auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

const SOURCE_VARIANT: Record<string, "default" | "sky" | "peach" | "sage"> = {
  auto_template: "sky",
  manual_rushes: "peach",
  external_upload: "sage",
};

export function PatternsCatalogClient({
  initialTemplates,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
}: PatternsCatalogClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialTemplates);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [saving, setSaving] = useState(false);
  // Phase 10 V2 — aperçu rapide d'une recette avant édition.
  const [peekTemplateId, setPeekTemplateId] = useState<string | null>(null);
  // Phase 9 V2 — actions inline sur cards (déploiement + archivage sans ouvrir
  // le drawer/page d'édition).
  const [deployTarget, setDeployTarget] = useState<CatalogItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CatalogItem | null>(null);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        SOURCE_LABEL[i.source]?.toLowerCase().includes(q) ||
        i.templateName?.toLowerCase().includes(q),
    );
  }, [items, query]);

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  // Phase 9 V2 — l'édition vit désormais sur une page SSR dédiée
  // (/admin/patterns/[id]/edit) plutôt qu'un drawer modal. Le drawer reste
  // utilisé pour la création rapide (nouvelle recette).
  function navigateToEdit(item: CatalogItem) {
    router.push(`/admin/patterns/${item.id}/edit`);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  async function handleSave(values: PatternTemplateFormValues) {
    setSaving(true);
    try {
      const url = editing
        ? `/api/admin/patterns/${editing.id}`
        : "/api/admin/patterns";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success(editing ? "Recette mise à jour" : "Recette créée");
      closeDrawer();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(item: CatalogItem) {
    if (item.bindingCount > 0) {
      toast.error(
        `Cette recette est utilisée par ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""}. Délie les liaisons avant d'archiver.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur lors de l'archivage");
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success("Recette archivée");
      closeDrawer();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <header className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Configuration
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Catalogue de recettes
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  Recettes éditoriales globales — réutilisables sur plusieurs comptes Instagram via des liaisons.
                </p>
              </div>
              <Button variant="primary" icon={Plus} onClick={openCreate}>
                Nouvelle recette
              </Button>
            </header>

            {/* Search */}
            <div className="max-w-md">
              <Input
                value={query}
                onChange={setQuery}
                placeholder="Filtrer par label, source, template…"
              />
            </div>

            {/* Liste */}
            {filteredItems.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={items.length === 0 ? "Aucune recette" : "Aucun résultat"}
                description={
                  items.length === 0
                    ? "Crée ta première recette éditoriale réutilisable sur plusieurs comptes."
                    : "Aucune recette ne correspond à ce filtre."
                }
                cta={
                  items.length === 0
                    ? { label: "Nouvelle recette", onClick: openCreate }
                    : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigateToEdit(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigateToEdit(item);
                      }
                    }}
                    className="group relative text-left rounded-2xl p-4 bg-white/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.08)] transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                  >
                    <div
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <ButtonIcon
                        icon={Eye}
                        label="Aperçu rapide"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPeekTemplateId(item.id);
                        }}
                      />
                      <DropdownMenu
                        align="end"
                        trigger={
                          <ButtonIcon
                            icon={MoreVertical}
                            label="Actions"
                            variant="ghost"
                            size="sm"
                          />
                        }
                        items={[
                          {
                            label: "Déployer sur d'autres comptes",
                            icon: Rocket,
                            onClick: () => setDeployTarget(item),
                          },
                          {
                            label:
                              item.bindingCount > 0
                                ? `Liée à ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""} — ne peut pas être archivée`
                                : "Archiver la recette",
                            icon: Trash2,
                            destructive: true,
                            disabled: item.bindingCount > 0,
                            onClick: () => setArchiveTarget(item),
                          },
                        ]}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-2 pr-6">
                      <h2 className="text-[15px] font-semibold text-gray-950 truncate">
                        {item.label}
                      </h2>
                      <Chip variant={SOURCE_VARIANT[item.source] ?? "default"} size="sm">
                        {SOURCE_LABEL[item.source] ?? item.source}
                      </Chip>
                    </div>
                    <div className="space-y-1 text-[11.5px] text-gray-600">
                      {item.templateName && (
                        <p className="inline-flex items-center gap-1.5">
                          <Sparkles size={11} className="text-gray-400" />
                          <span>Template : {item.templateName}</span>
                        </p>
                      )}
                      {item.captionPresetName && (
                        <p className="inline-flex items-center gap-1.5">
                          <FileText size={11} className="text-gray-400" />
                          <span>Captions : {item.captionPresetName}</span>
                        </p>
                      )}
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/40 flex items-center justify-between text-[11px] text-gray-500">
                      <span>
                        {item.bindingCount === 0
                          ? "Aucune liaison"
                          : `${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""} liés`}
                      </span>
                      <span className="font-mono tabular-nums">
                        {new Date(item.updatedAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phase 10 V2 — peek drawer. onOpenEdit navigue désormais vers la
          page SSR d'édition (Phase 9 V2) plutôt que d'ouvrir un drawer. */}
      <PatternPeekDrawer
        open={peekTemplateId !== null}
        patternId={peekTemplateId}
        onClose={() => setPeekTemplateId(null)}
        onOpenEdit={(id) => router.push(`/admin/patterns/${id}/edit`)}
      />

      {/* Phase 9 V2 — déploiement inline depuis le menu kebab. */}
      {deployTarget && (
        <DeployTemplateModal
          templateId={deployTarget.id}
          templateLabel={deployTarget.label}
          onDeployed={(count) => {
            setDeployTarget(null);
            toast.success(
              count === 0
                ? "Aucun nouveau compte lié"
                : `Recette déployée sur ${count} compte${count > 1 ? "s" : ""}`,
            );
            router.refresh();
          }}
          onClose={() => setDeployTarget(null)}
        />
      )}

      {/* Phase 9 V2 — archivage inline depuis le menu kebab. */}
      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archiver cette recette ?"
        description={
          archiveTarget
            ? `« ${archiveTarget.label} » disparaîtra du catalogue. Action réversible via l'API.`
            : ""
        }
        confirmLabel="Archiver"
        variant="danger"
        loading={saving}
        onConfirm={async () => {
          if (!archiveTarget) return;
          await handleArchive(archiveTarget);
          setArchiveTarget(null);
        }}
        onCancel={() => setArchiveTarget(null)}
      />

      {drawerOpen && (
        <Drawer open onClose={closeDrawer} side="right" size="lg">
          <PatternTemplateForm
            initial={
              editing
                ? {
                    id: editing.id,
                    label: editing.label,
                    source: editing.source,
                    templateId: null,
                    captionPresetId: null,
                    descriptionPromptId: null,
                    coverMode: editing.coverMode,
                    needsDescription: editing.needsDescription,
                    needsCaptionsMode: editing.needsCaptionsMode,
                    needsAdminValidation: editing.needsAdminValidation,
                    needsClientValidation: editing.needsClientValidation,
                    allowsClientRevision: editing.allowsClientRevision,
                    needsBrief: editing.needsBrief,
                    notes: editing.notes,
                    bindingCount: editing.bindingCount,
                  }
                : null
            }
            templateId={editing?.id ?? null}
            builderTemplates={builderTemplates}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
            saving={saving}
            onSave={handleSave}
            onArchive={editing ? () => void handleArchive(editing) : undefined}
            onClose={closeDrawer}
          />
        </Drawer>
      )}
    </div>
  );
}

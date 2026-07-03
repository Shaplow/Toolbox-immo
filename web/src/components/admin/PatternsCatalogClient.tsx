"use client";

/**
 * PatternsCatalogClient — Catalogue global des recettes.
 *
 * G.2 — Le catalogue est secondaire. Les recettes vivent désormais sur la
 * fiche compte (AccountRecipesList). Ce catalogue sert uniquement à
 * réutiliser/dupliquer une recette sur plusieurs comptes en 1 click via
 * l'action "Appliquer à des comptes" (DeployTemplateModal).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  Plus,
  Sparkles,
  FileText,
  Eye,
  MoreVertical,
  Rocket,
  Trash2,
  Clapperboard,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { KPIPill } from "@/components/ui/molecules/KPIPill";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { toast } from "@/components/ui/Toast";
import { DeployTemplateModal } from "./DeployTemplateModal";
import { PatternTemplateForm, type PatternTemplateFormValues } from "./PatternTemplateForm";
import { PatternPeekDrawer } from "./PatternPeekDrawer";
import { SOURCE_LABELS_FR, SOURCE_VARIANT } from "@/lib/i18n/entityLabels";

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
  videoLibraries: { id: string; name: string }[];
}

export function PatternsCatalogClient({
  initialTemplates,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
}: PatternsCatalogClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialTemplates);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [peekTemplateId, setPeekTemplateId] = useState<string | null>(null);
  const [deployTarget, setDeployTarget] = useState<CatalogItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CatalogItem | null>(null);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        SOURCE_LABELS_FR[i.source]?.toLowerCase().includes(q) ||
        i.templateName?.toLowerCase().includes(q),
    );
  }, [items, query]);

  function openCreate() {
    setDrawerOpen(true);
  }

  function navigateToEdit(item: CatalogItem) {
    router.push(`/admin/patterns/${item.id}/edit`);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  async function handleCreate(values: PatternTemplateFormValues) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success("Recette créée");
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
        `Cette recette est utilisée par ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""}. Retire-la des comptes avant d'archiver.`,
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

  const totalUsage = items.reduce((acc, i) => acc + i.bindingCount, 0);

  return (
    <PageShell variant="default">
      <div className="px-6 sm:px-8 pt-6 pb-12 space-y-6">
        <ToolPageHeader
          icon={BookMarked}
          title="Catalogue de recettes"
          subtitle="Recettes réutilisables sur plusieurs comptes."
          kpis={
            <>
              <KPIPill label="Recettes" value={items.length} />
              <KPIPill label="Applications" value={totalUsage} />
            </>
          }
          actions={
            <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
              Nouvelle recette
            </Button>
          }
        />

        <div className="max-w-md">
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Filtrer par label, source, template…"
          />
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title={items.length === 0 ? "Catalogue vide" : "Aucun résultat"}
            description={
              items.length === 0
                ? "Crée une recette réutilisable sur plusieurs comptes."
                : undefined
            }
            cta={items.length === 0 ? { label: "Nouvelle recette", onClick: openCreate } : undefined}
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
                className="group relative text-left rounded-md p-4 bg-card border border-border cursor-pointer transition-colors hover:bg-muted/30 hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-ring/40"
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
                        label: "Lancer une mission",
                        icon: Clapperboard,
                        onClick: () => router.push(`/missions/new?recipeId=${item.id}`),
                      },
                      {
                        label: "Appliquer à des comptes",
                        icon: Rocket,
                        onClick: () => setDeployTarget(item),
                      },
                      {
                        label:
                          item.bindingCount > 0
                            ? `Utilisée par ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""}`
                            : "Archiver",
                        icon: Trash2,
                        destructive: true,
                        disabled: item.bindingCount > 0,
                        onClick: () => setArchiveTarget(item),
                      },
                    ]}
                  />
                </div>

                <div className="flex items-start justify-between gap-2 pr-7">
                  <h2 className="text-[15px] font-semibold text-foreground truncate">
                    {item.label}
                  </h2>
                  <Chip variant={SOURCE_VARIANT[item.source] ?? "default"} size="sm">
                    {SOURCE_LABELS_FR[item.source] ?? item.source}
                  </Chip>
                </div>

                <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                  {item.templateName && (
                    <p className="inline-flex items-center gap-1.5">
                      <Sparkles size={11} />
                      <span className="truncate">Template : {item.templateName}</span>
                    </p>
                  )}
                  {item.captionPresetName && (
                    <p className="inline-flex items-center gap-1.5">
                      <FileText size={11} />
                      <span className="truncate">Captions : {item.captionPresetName}</span>
                    </p>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {item.bindingCount === 0
                      ? "Non utilisée"
                      : `Utilisée par ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""}`}
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

      <PatternPeekDrawer
        open={peekTemplateId !== null}
        patternId={peekTemplateId}
        onClose={() => setPeekTemplateId(null)}
        onOpenEdit={(id) => router.push(`/admin/patterns/${id}/edit`)}
      />

      {deployTarget && (
        <DeployTemplateModal
          templateId={deployTarget.id}
          templateLabel={deployTarget.label}
          onDeployed={(count) => {
            setDeployTarget(null);
            toast.success(
              count === 0
                ? "Aucun nouveau compte appliqué"
                : `Recette appliquée à ${count} compte${count > 1 ? "s" : ""}`,
            );
            router.refresh();
          }}
          onClose={() => setDeployTarget(null)}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archiver cette recette ?"
        description={
          archiveTarget
            ? `« ${archiveTarget.label} » disparaîtra du catalogue.`
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
            initial={null}
            templateId={null}
            builderTemplates={builderTemplates}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
            videoLibraries={videoLibraries}
            saving={saving}
            onSave={handleCreate}
            onClose={closeDrawer}
          />
        </Drawer>
      )}
    </PageShell>
  );
}

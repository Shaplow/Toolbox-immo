"use client";

/**
 * PatternsCatalogClient — Catalogue global des recettes.
 *
 * G.2 — Le catalogue est secondaire. Les recettes vivent désormais sur la
 * fiche compte (AccountRecipesList). Ce catalogue sert à réutiliser/dupliquer
 * une recette sur plusieurs comptes ("Appliquer à des comptes"), et depuis la
 * vague « famille » c'est aussi LA surface de rangement : la famille est
 * éditable en ligne sur chaque carte et en masse sur une sélection, parce que
 * renseigner ~20 recettes une par une via le drawer d'édition est le vrai
 * bloqueur du filtrage par famille dans « Remplir la semaine ».
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  CheckSquare,
  Plus,
  Sparkles,
  FileText,
  Eye,
  MoreVertical,
  Rocket,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { KPIPill } from "@/components/ui/molecules/KPIPill";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { toast } from "@/components/ui/Toast";
import { BulkActionBar } from "@/components/admin/libraries/shared/BulkActionBar";
import { DeployTemplateModal, type DeployTarget } from "./DeployTemplateModal";
import { PatternTemplateForm, type PatternTemplateFormValues } from "./PatternTemplateForm";
import { PatternPeekDrawer } from "./PatternPeekDrawer";
import { SOURCE_LABELS_FR, SOURCE_VARIANT } from "@/lib/i18n/glossary";
import { shortDateFr } from "@/lib/date/formatFr";
import { compareNatural } from "@/lib/utils/naturalSort";

export interface CatalogItem {
  id: string;
  label: string;
  /** Famille éditoriale (« TRANSACTION »…) — `null` tant qu'elle n'est pas rangée. */
  family: string | null;
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
  clients: { id: string; name: string }[];
}

/** Forme brute renvoyée par POST /api/admin/patterns — PatternTemplate Prisma tel quel (pas le CatalogItem flatten que consomme cette liste : pas de noms joints, pas de _count). */
interface PatternTemplateApiResponse {
  id: string;
  label: string;
  family: string | null;
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  needsCaptionsMode: string;
  needsDescription: string;
  coverMode: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  notes: string | null;
  updatedAt: string;
}

function findOptionName(options: { id: string; name: string }[], id: string | null): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.name ?? null;
}

/** Reconstruit un `CatalogItem` à partir de la réponse POST /patterns pour une mise à jour optimiste (cf. handleCreate). */
function templateResponseToCatalogItem(
  t: PatternTemplateApiResponse,
  opts: {
    builderTemplates: { id: string; name: string }[];
    captionPresets: { id: string; name: string }[];
    descriptionPrompts: { id: string; name: string }[];
    bindingCount: number;
  },
): CatalogItem {
  return {
    id: t.id,
    label: t.label,
    family: t.family ?? null,
    source: t.source,
    templateName: findOptionName(opts.builderTemplates, t.templateId),
    captionPresetName: findOptionName(opts.captionPresets, t.captionPresetId),
    descriptionPromptName: findOptionName(opts.descriptionPrompts, t.descriptionPromptId),
    needsCaptionsMode: t.needsCaptionsMode,
    needsDescription: t.needsDescription,
    coverMode: t.coverMode,
    needsAdminValidation: t.needsAdminValidation,
    needsClientValidation: t.needsClientValidation,
    allowsClientRevision: t.allowsClientRevision,
    needsBrief: t.needsBrief,
    bindingCount: opts.bindingCount,
    notes: t.notes,
    updatedAt: t.updatedAt,
  };
}

/**
 * Sentinelle « retirer la famille ». Une valeur DISTINCTE de `""` : avec `""`,
 * le Combobox trouvait une option correspondant à la valeur courante et
 * affichait « Sans famille » comme un choix fait, au lieu du placeholder qui
 * invite à ranger. La conversion en `null` se fait à l'écriture.
 */
const CLEAR_FAMILY = "__clear__";

export function PatternsCatalogClient({
  initialTemplates,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
  clients,
}: PatternsCatalogClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialTemplates);
  // Même classe de fix que AccountRecipesList (P7) — `useState(initialTemplates)`
  // ne capture que le tout premier rendu ; App Router préserve ce state à
  // travers un `router.refresh()` (handleCreate, DeployTemplateModal.onDeployed).
  // Sans ce resync, la liste restait figée sur l'état du montage initial.
  useEffect(() => {
    setItems(initialTemplates);
  }, [initialTemplates]);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [peekTemplateId, setPeekTemplateId] = useState<string | null>(null);
  const [deployTargets, setDeployTargets] = useState<DeployTarget[] | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CatalogItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkFamily, setBulkFamily] = useState<string>("");
  const [familyBusyId, setFamilyBusyId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.family?.toLowerCase().includes(q) ||
        SOURCE_LABELS_FR[i.source]?.toLowerCase().includes(q) ||
        i.templateName?.toLowerCase().includes(q),
    );
  }, [items, query]);

  /** Familles déjà saisies — alimente le Combobox, pas de table ni d'enum (doctrine `setTag`). */
  const knownFamilies = useMemo(
    () =>
      [...new Set(items.map((i) => i.family).filter((f): f is string => !!f))].sort(
        compareNatural,
      ),
    [items],
  );
  const familyOptions = useMemo(
    () => knownFamilies.map((f) => ({ value: f, label: f })),
    [knownFamilies],
  );
  const CLEAR_OPTION = { value: CLEAR_FAMILY, label: "— Retirer la famille —" };

  const selectionActive = selectedIds.size > 0;
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Doctrine BulkActionBar : « tout sélectionner » porte sur les lignes VISIBLES. */
  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (filteredItems.every((i) => prev.has(i.id))) {
        const next = new Set(prev);
        for (const i of filteredItems) next.delete(i.id);
        return next;
      }
      const next = new Set(prev);
      for (const i of filteredItems) next.add(i.id);
      return next;
    });
  }

  function openCreate() {
    setDrawerOpen(true);
  }

  function navigateToEdit(item: CatalogItem) {
    router.push(`/admin/patterns/${item.id}/edit`);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  /**
   * Range N recettes dans une famille. Le PATCH n'envoie QUE `family` : le
   * payload partagé (`toPatternTemplateUpdateData`) ignore toute clé absente,
   * donc aucun autre champ de la recette n'est touché.
   *
   * Résultats partiels : un échec au milieu ne doit pas faire croire à un
   * échec global — les recettes rangées le restent à l'écran.
   */
  async function applyFamily(targets: CatalogItem[], family: string): Promise<void> {
    const value = family.trim() ? family.trim() : null;
    const results = await Promise.all(
      targets.map(async (item) => {
        try {
          const res = await fetch(`/api/admin/patterns/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ family: value }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Erreur ${res.status}`);
          }
          return { id: item.id, ok: true as const };
        } catch (err) {
          return {
            id: item.id,
            ok: false as const,
            error: err instanceof Error ? err.message : "Erreur",
          };
        }
      }),
    );
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    if (okIds.size > 0) {
      setItems((prev) =>
        prev.map((i) => (okIds.has(i.id) ? { ...i, family: value } : i)),
      );
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      toast.error(
        `${failed.length} recette${failed.length > 1 ? "s" : ""} non rangée${failed.length > 1 ? "s" : ""} — ${
          "error" in failed[0] ? failed[0].error : "Erreur"
        }`,
      );
    }
    if (okIds.size > 0) {
      toast.success(
        value === null
          ? `${okIds.size} recette${okIds.size > 1 ? "s" : ""} sortie${okIds.size > 1 ? "s" : ""} de sa famille`
          : `${okIds.size} recette${okIds.size > 1 ? "s" : ""} rangée${okIds.size > 1 ? "s" : ""} dans « ${value} »`,
      );
    }
  }

  async function handleInlineFamily(item: CatalogItem, family: string) {
    if ((item.family ?? "") === family) return;
    setFamilyBusyId(item.id);
    try {
      await applyFamily([item], family);
    } finally {
      setFamilyBusyId(null);
    }
  }

  async function handleBulkFamily() {
    if (selectedItems.length === 0) return;
    setSaving(true);
    try {
      await applyFamily(selectedItems, bulkFamily === CLEAR_FAMILY ? "" : bulkFamily);
    } finally {
      setSaving(false);
    }
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
      let created: PatternTemplateApiResponse;
      try {
        created = (await res.json()) as PatternTemplateApiResponse;
      } catch {
        // res.ok mais corps illisible (proxy coupé, timeout) — l'écriture a
        // bien eu lieu côté serveur : ne pas le traiter comme un échec
        // (mirror du même fix dans AccountRecipesList.tsx).
        toast.success("Recette créée — actualisation de la liste…");
        closeDrawer();
        router.refresh();
        return;
      }
      // Mise à jour optimiste depuis la réponse — sans ça la nouvelle
      // recette n'apparaissait qu'après un reload complet de la page (le
      // router.refresh() seul ne resynchronise pas ce state, cf. useEffect
      // ci-dessus, ajouté pour le cas général).
      setItems((prev) => [
        templateResponseToCatalogItem(created, {
          builderTemplates,
          captionPresets,
          descriptionPrompts,
          bindingCount: 0,
        }),
        ...prev,
      ]);
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
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de l'archivage");
      }
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
  const unfiled = items.filter((i) => !i.family).length;

  return (
    <PageShell variant="default">
      <div className={`px-6 sm:px-8 pt-6 space-y-6 ${selectionActive ? "pb-28" : "pb-12"}`}>
        <ToolPageHeader
          icon={BookMarked}
          title="Catalogue de recettes"
          subtitle="Recettes réutilisables sur plusieurs comptes."
          kpis={
            <>
              <KPIPill label="Recettes" value={items.length} />
              <KPIPill label="Applications" value={totalUsage} />
              <KPIPill label="Sans famille" value={unfiled} />
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
            placeholder="Filtrer par label, famille, source, template…"
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
            {filteredItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  // En sélection, le clic sur la carte coche au lieu de
                  // naviguer : quitter la page au milieu d'un rangement en
                  // masse perdrait la sélection.
                  onClick={() => (selectionActive ? toggleSelect(item.id) : navigateToEdit(item))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (selectionActive) toggleSelect(item.id);
                      else navigateToEdit(item);
                    }
                  }}
                  className={`group relative text-left rounded-md p-4 bg-card border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40 ${
                    isSelected
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-border hover:bg-muted/30 hover:border-zinc-300"
                  }`}
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
                          label: "Appliquer à des comptes",
                          icon: Rocket,
                          onClick: () => setDeployTargets([{ id: item.id, label: item.label }]),
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

                  <div className="flex items-start gap-2 pr-7">
                    <button
                      type="button"
                      aria-label={isSelected ? "Désélectionner" : "Sélectionner"}
                      aria-pressed={isSelected}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(item.id);
                      }}
                      className={`mt-0.5 shrink-0 transition-opacity ${
                        isSelected || selectionActive
                          ? "text-primary opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                    <h2 className="flex-1 min-w-0 text-[15px] font-semibold text-foreground truncate">
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

                  {/* Rangement en ligne — la carte navigue au clic, donc tout
                      l'éditeur arrête la propagation. */}
                  <div
                    className="mt-3"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Combobox
                      value={item.family ?? ""}
                      onChange={(v) =>
                        void handleInlineFamily(item, v === CLEAR_FAMILY ? "" : v)
                      }
                      // « Retirer » n'a de sens que s'il y a quelque chose à retirer.
                      options={item.family ? [CLEAR_OPTION, ...familyOptions] : familyOptions}
                      allowCustom
                      loading={familyBusyId === item.id}
                      placeholder="Famille — à ranger"
                      emptyMessage="Tapez pour créer une famille."
                    />
                  </div>

                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {item.bindingCount === 0
                        ? "Non utilisée"
                        : `Utilisée par ${item.bindingCount} compte${item.bindingCount > 1 ? "s" : ""}`}
                    </span>
                    <span className="font-mono tabular-nums">
                      {shortDateFr(item.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectionActive && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          allSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAllVisible}
          onCancel={() => setSelectedIds(new Set())}
        >
          <div className="w-48">
            <Combobox
              value={bulkFamily}
              onChange={setBulkFamily}
              options={[CLEAR_OPTION, ...familyOptions]}
              allowCustom
              placeholder="Famille…"
              emptyMessage="Tapez pour créer une famille."
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={saving}
            onClick={() => void handleBulkFamily()}
          >
            Ranger dans cette famille
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Rocket}
            onClick={() =>
              setDeployTargets(selectedItems.map((i) => ({ id: i.id, label: i.label })))
            }
          >
            Appliquer à des comptes
          </Button>
        </BulkActionBar>
      )}

      <PatternPeekDrawer
        open={peekTemplateId !== null}
        patternTemplateId={peekTemplateId}
        onClose={() => setPeekTemplateId(null)}
        onOpenEdit={(id) => router.push(`/admin/patterns/${id}/edit`)}
      />

      {deployTargets && deployTargets.length > 0 && (
        <DeployTemplateModal
          templates={deployTargets}
          onDeployed={() => {
            setDeployTargets(null);
            setSelectedIds(new Set());
            router.refresh();
          }}
          onClose={() => setDeployTargets(null)}
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
            clients={clients}
            knownFamilies={knownFamilies}
            saving={saving}
            onSave={handleCreate}
            onClose={closeDrawer}
          />
        </Drawer>
      )}
    </PageShell>
  );
}

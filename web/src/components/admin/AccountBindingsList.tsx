"use client";

/**
 * AccountBindingsList — section "Recettes liées" sur la fiche compte admin.
 *
 * Liste les PatternBinding du compte (= recettes globales appliquées) avec
 * leur planning et assignations spécifiques. Click sur une card → drawer
 * d'édition. Bouton "Lier une recette" → picker catalogue → drawer création.
 *
 * Sprint B — Le picker inclut une option « Créer une nouvelle recette » qui
 * ouvre PatternTemplateForm en cascade (drawer secondaire) ; à la sauvegarde,
 * le nouveau template est ajouté au catalogue local et auto-sélectionné pour
 * la création du binding.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Clock, Users, Inbox, UserCheck, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { Combobox } from "@/components/ui/Combobox";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import {
  PatternBindingForm,
  type PatternBindingFormValues,
} from "./PatternBindingForm";
import {
  PatternTemplateForm,
  type PatternTemplateFormValues,
} from "./PatternTemplateForm";
import { BulkReplaceAssigneeModal } from "./BulkReplaceAssigneeModal";
import { PatternPeekDrawer } from "./PatternPeekDrawer";
import { SOURCE_LABELS_FR, SOURCE_VARIANT } from "@/lib/i18n/entityLabels";

const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export interface BindingItem {
  id: string;
  patternTemplateId: string;
  templateLabel: string;
  templateSource: string;
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurName: string | null;
  defaultAssigneeCmName: string | null;
  defaultAssigneeVideasteName: string | null;
}

export interface CatalogTemplate {
  id: string;
  label: string;
  source: string;
}

export interface AssigneeOption {
  id: string;
  name: string;
}

interface AccountBindingsListProps {
  accountId: string;
  accountHandle: string;
  initialBindings: BindingItem[];
  catalogTemplates: CatalogTemplate[];
  /** Sprint B — pour la création inline d'une recette dans le picker. */
  builderTemplates: { id: string; name: string }[];
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
}

/** Valeur spéciale dans le picker = ouvre la création inline. */
const CREATE_NEW_TEMPLATE_VALUE = "__create_new__";

export function AccountBindingsList({
  accountId,
  accountHandle,
  initialBindings,
  catalogTemplates: initialCatalog,
  builderTemplates,
  monteurs,
  cms,
  videastes,
  captionPresets,
  descriptionPrompts,
}: AccountBindingsListProps) {
  const router = useRouter();
  const [bindings, setBindings] = useState<BindingItem[]>(initialBindings);
  // Sprint B — catalog en state local pour pouvoir y appender un template
  // créé inline sans router.refresh() (qui flushe les autres state).
  const [catalogTemplates, setCatalogTemplates] =
    useState<CatalogTemplate[]>(initialCatalog);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<BindingItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedTemplateId, setPickedTemplateId] = useState<string>("");
  // Sprint B — cascade création template depuis picker.
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  // Sprint C — bulk replace assignée par défaut sur les bindings du compte.
  const [bulkReplaceOpen, setBulkReplaceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Phase 10 V2 — aperçu rapide de la recette parente.
  const [peekTemplateId, setPeekTemplateId] = useState<string | null>(null);
  // Lock per-binding sur le toggle isActive — empêche les double-clics de
  // lancer deux PATCH concurrents avec des `previous` capturés à des instants
  // incohérents (sinon le rollback peut figer l'UI sur le mauvais état si
  // l'un des deux PATCH échoue).
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());

  const sortedBindings = useMemo(() => {
    return [...bindings].sort((a, b) => a.publishTime.localeCompare(b.publishTime));
  }, [bindings]);

  function openEdit(item: BindingItem) {
    setEditing(item);
    setDrawerOpen(true);
  }

  function openPicker() {
    setPickedTemplateId(catalogTemplates[0]?.id ?? "");
    setPickerOpen(true);
  }

  // Sprint B — bouton "Créer une nouvelle recette" dans le picker.
  function startCreateTemplate() {
    setPickerOpen(false);
    setCreatingTemplate(true);
  }

  async function handleCreateTemplate(values: PatternTemplateFormValues) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Erreur ${res.status}`);
      }
      const created = (await res.json()) as {
        id: string;
        label: string;
        source: string;
      };
      const newCatalogItem: CatalogTemplate = {
        id: created.id,
        label: created.label,
        source: created.source,
      };
      // Append au catalogue local + auto-select pour la suite du flow binding.
      setCatalogTemplates((prev) => [...prev, newCatalogItem]);
      setCreatingTemplate(false);
      toast.success("Recette créée — liaison en cours");
      // Enchaîne immédiatement sur la création du binding pour cette recette.
      startCreateForTemplate(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  function startCreateForTemplate(templateId: string) {
    setPickerOpen(false);
    setEditing({
      id: "",
      patternTemplateId: templateId,
      templateLabel:
        catalogTemplates.find((t) => t.id === templateId)?.label ?? "Recette",
      templateSource:
        catalogTemplates.find((t) => t.id === templateId)?.source ?? "",
      customLabel: null,
      dayOfWeek: [],
      publishTime: "09:00",
      isActive: true,
      defaultAssigneeMonteurName: null,
      defaultAssigneeCmName: null,
      defaultAssigneeVideasteName: null,
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  async function handleSave(values: PatternBindingFormValues) {
    if (!editing) return;
    setSaving(true);
    try {
      const isCreate = !editing.id;
      const url = isCreate
        ? `/api/admin/accounts/${accountId}/bindings`
        : `/api/admin/accounts/${accountId}/bindings/${editing.id}`;
      const method = isCreate ? "POST" : "PATCH";
      const body = isCreate
        ? {
            patternTemplateId: editing.patternTemplateId,
            ...values,
          }
        : values;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Erreur ${res.status}`);
      }
      toast.success(isCreate ? "Recette liée" : "Liaison mise à jour");
      closeDrawer();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  // Phase 10 V2 — auto-save inline du toggle isActive sur chaque binding.
  // Optimistic update + rollback en cas d'erreur. Pas de hook useAutoSave
  // (debounce inutile pour un toggle binaire ponctuel).
  async function toggleBindingActive(bindingId: string, next: boolean) {
    // Lock : un seul PATCH isActive en vol par binding (cf. pendingToggles).
    if (pendingToggles.has(bindingId)) return;
    const previous = bindings.find((b) => b.id === bindingId);
    if (!previous) return;
    setPendingToggles((prev) => {
      const updated = new Set(prev);
      updated.add(bindingId);
      return updated;
    });
    setBindings((prev) =>
      prev.map((b) => (b.id === bindingId ? { ...b, isActive: next } : b)),
    );
    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/bindings/${bindingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Erreur ${res.status}`);
      }
      toast.success(next ? "Liaison activée" : "Liaison désactivée");
    } catch (err) {
      setBindings((prev) =>
        prev.map((b) =>
          b.id === bindingId ? { ...b, isActive: previous.isActive } : b,
        ),
      );
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPendingToggles((prev) => {
        const updated = new Set(prev);
        updated.delete(bindingId);
        return updated;
      });
    }
  }

  async function handleDelete(item: BindingItem) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/bindings/${item.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      setBindings((prev) => prev.filter((b) => b.id !== item.id));
      toast.success("Liaison supprimée");
      closeDrawer();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">
            Recettes liées
          </h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Recettes éditoriales globales appliquées à @{accountHandle} avec planning et assignations spécifiques.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={UserCheck}
            onClick={() => setBulkReplaceOpen(true)}
            title="Remplacer une assignée par défaut sur toutes les liaisons du compte"
            disabled={sortedBindings.length === 0}
          >
            Remplacer assignée
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={openPicker}>
            Lier une recette
          </Button>
        </div>
      </header>

      {sortedBindings.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Aucune recette liée"
          description="Lie une recette globale pour générer du contenu sur ce compte."
          cta={{ label: "Lier une recette", onClick: openPicker }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortedBindings.map((b) => (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => openEdit(b)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openEdit(b);
                }
              }}
              className={`group relative text-left rounded-2xl p-4 bg-white/65 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.08)] transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400/40 ${
                !b.isActive ? "opacity-50" : ""
              }`}
            >
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <ButtonIcon
                  icon={Eye}
                  label="Aperçu de la recette"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPeekTemplateId(b.patternTemplateId);
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 mb-2 pr-6">
                <h3 className="text-[14px] font-semibold text-gray-950 truncate inline-flex items-center gap-1.5">
                  <Sparkles size={12} className="text-gray-400 shrink-0" />
                  {b.customLabel ?? b.templateLabel}
                </h3>
                <Chip variant={SOURCE_VARIANT[b.templateSource] ?? "default"} size="sm">
                  {SOURCE_LABELS_FR[b.templateSource] ?? b.templateSource}
                </Chip>
              </div>
              <div className="space-y-1 text-[11.5px] text-gray-600">
                <p className="inline-flex items-center gap-1.5">
                  <Clock size={11} className="text-gray-400" />
                  <span className="font-mono tabular-nums">{b.publishTime}</span>
                  <span className="text-gray-400">·</span>
                  <span>
                    {b.dayOfWeek.length === 0
                      ? "Pas de planning auto"
                      : b.dayOfWeek.map((d) => DAYS[d] ?? `J${d}`).join("/")}
                  </span>
                </p>
                {(b.defaultAssigneeVideasteName ||
                  b.defaultAssigneeMonteurName ||
                  b.defaultAssigneeCmName) && (
                  <p className="inline-flex items-center gap-1.5">
                    <Users size={11} className="text-gray-400" />
                    {[
                      b.defaultAssigneeVideasteName,
                      b.defaultAssigneeMonteurName,
                      b.defaultAssigneeCmName,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {/* Phase 10 V2 — toggle isActive auto-save inline */}
              <div
                className="mt-3 pt-2 border-t border-white/40 flex items-center justify-between gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <span className="text-[10.5px] uppercase tracking-widest font-medium text-gray-500">
                  {b.isActive ? "Active" : "Désactivée"}
                </span>
                <Switch
                  checked={b.isActive}
                  onChange={(next) => void toggleBindingActive(b.id, next)}
                  size="sm"
                  accent="sage"
                  disabled={pendingToggles.has(b.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Phase 10 V2 — peek drawer recette parente */}
      <PatternPeekDrawer
        open={peekTemplateId !== null}
        patternId={peekTemplateId}
        onClose={() => setPeekTemplateId(null)}
      />


      {/* Picker recette */}
      {pickerOpen && (
        <Modal open onClose={() => setPickerOpen(false)} size="md">
          <div className="p-5">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
              Lier une recette
            </p>
            <h3 className="mt-1 text-[18px] font-semibold text-gray-950">
              Choisir dans le catalogue
            </h3>
            <p className="mt-1 text-[12px] text-gray-500">
              Sélectionne une recette globale à appliquer à ce compte.
            </p>
            <div className="mt-4">
              <Combobox
                value={pickedTemplateId}
                onChange={(v) => {
                  if (v === CREATE_NEW_TEMPLATE_VALUE) {
                    startCreateTemplate();
                    return;
                  }
                  setPickedTemplateId(v);
                }}
                options={[
                  { value: "", label: "— Choisir une recette —" },
                  ...catalogTemplates.map((t) => ({
                    value: t.id,
                    label: `${t.label} · ${SOURCE_LABELS_FR[t.source] ?? t.source}`,
                  })),
                  {
                    value: CREATE_NEW_TEMPLATE_VALUE,
                    label: "+ Créer une nouvelle recette",
                  },
                ]}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPickerOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={
                  !pickedTemplateId ||
                  pickedTemplateId === CREATE_NEW_TEMPLATE_VALUE
                }
                onClick={() => startCreateForTemplate(pickedTemplateId)}
              >
                Continuer
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sprint B — Drawer création recette en cascade (déclenchée
          depuis le picker via "Créer une nouvelle recette"). */}
      {creatingTemplate && (
        <Drawer
          open
          onClose={() => setCreatingTemplate(false)}
          side="right"
          size="lg"
        >
          <PatternTemplateForm
            initial={null}
            templateId={null}
            builderTemplates={builderTemplates}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
            saving={saving}
            onSave={handleCreateTemplate}
            onClose={() => setCreatingTemplate(false)}
          />
        </Drawer>
      )}

      {/* Sprint C — modal remplacement bulk assignée par défaut. */}
      {bulkReplaceOpen && (
        <BulkReplaceAssigneeModal
          accountId={accountId}
          monteurs={monteurs}
          cms={cms}
          videastes={videastes}
          onReplaced={() => {
            setBulkReplaceOpen(false);
            router.refresh();
          }}
          onClose={() => setBulkReplaceOpen(false)}
        />
      )}

      {/* Drawer édition / création binding */}
      {drawerOpen && editing && (
        <Drawer open onClose={closeDrawer} side="right" size="lg">
          <PatternBindingForm
            initial={editing}
            isCreating={!editing.id}
            monteurs={monteurs}
            cms={cms}
            videastes={videastes}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
            saving={saving}
            onSave={handleSave}
            onDelete={editing.id ? () => void handleDelete(editing) : undefined}
            onClose={closeDrawer}
          />
        </Drawer>
      )}
    </section>
  );
}

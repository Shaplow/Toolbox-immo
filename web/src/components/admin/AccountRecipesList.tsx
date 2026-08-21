"use client";

/**
 * AccountRecipesList — section "Recettes du compte" sur la fiche compte.
 *
 * G.1 → G.3. Présente chaque recette du compte comme une entité unifiée
 * (template + binding flatten côté server). Le drawer d'édition (RecipeForm)
 * combine contenu (template) + planning/équipe (binding) en tabs ; un seul
 * save passe par POST/PATCH atomique /recipes.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
  Clock,
  UserCheck,
  Eye,
  Layers,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { RecipeForm, type RecipeFormInitial, type RecipeFormValues } from "./RecipeForm";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import { BulkReplaceAssigneeModal } from "./BulkReplaceAssigneeModal";
import { PatternPeekDrawer } from "./PatternPeekDrawer";
import { SOURCE_LABELS_FR, SOURCE_VARIANT } from "@/lib/i18n/glossary";
import { DAY_LABELS } from "@/types/calendar";

export interface RecipeItem {
  /** Clé stable React : bindingId si lié, sinon `tpl-<templateId>`. */
  id: string;
  /** ID du PatternBinding si la recette est liée à ce compte, sinon null. */
  bindingId: string | null;
  patternTemplateId: string;
  label: string;
  // Template
  templateLabel: string;
  source: string;
  templateId: string | null;
  coverMode: string;
  needsCaptionsMode: string;
  needsDescription: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  requiresProperty: boolean;
  /** Phase 5 (métaobjet) — remplace requiresProperty. */
  requiresEntityTypeId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  descriptionSourceFieldKey: string | null;
  descriptionFixedText: string | null;
  descriptionDataLibraryId: string | null;
  descriptionDataSetTag: string | null;
  templateNotes: string | null;
  // Binding
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
  defaultAssigneeMonteurName: string | null;
  defaultAssigneeCmName: string | null;
  defaultAssigneeVideasteName: string | null;
  captionPresetIdOverride: string | null;
  descriptionPromptIdOverride: string | null;
  coverModeOverride: string | null;
  autoSaveToLibraryId: string | null;
  bindingNotes: string | null;
  hasCaptionPresetOverride: boolean;
  hasDescriptionPromptOverride: boolean;
  hasCoverModeOverride: boolean;
  overrideCount: number;
  sharedWithCount: number;
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

interface Props {
  accountId: string;
  accountHandle: string;
  initialRecipes: RecipeItem[];
  catalogTemplates: CatalogTemplate[];
  builderTemplates: { id: string; name: string }[];
  videoLibraries: { id: string; name: string }[];
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
}

interface EditingState {
  bindingId: string | null;
  isCreating: boolean;
  reusedTemplateId?: string;
  initial: RecipeFormInitial;
}

function defaultRecipeFormInitial(): RecipeFormInitial {
  return {
    label: "",
    source: "auto_template",
    templateId: null,
    coverMode: "none",
    needsCaptionsMode: "none",
    needsDescription: "none",
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    requiresProperty: false,
    requiresEntityTypeId: null,
    captionPresetId: null,
    descriptionPromptId: null,
    descriptionSourceFieldKey: null,
    descriptionFixedText: null,
    descriptionDataLibraryId: null,
    descriptionDataSetTag: null,
    autoSaveToLibraryId: null,
    templateNotes: null,
    customLabel: null,
    dayOfWeek: [],
    publishTime: "09:00",
    isActive: true,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    bindingNotes: null,
    sharedWithCount: 1,
  };
}

function recipeItemToFormInitial(r: RecipeItem): RecipeFormInitial {
  return {
    label: r.templateLabel,
    source: r.source,
    templateId: r.templateId,
    coverMode: r.coverMode,
    needsCaptionsMode: r.needsCaptionsMode,
    needsDescription: r.needsDescription,
    needsAdminValidation: r.needsAdminValidation,
    needsClientValidation: r.needsClientValidation,
    allowsClientRevision: r.allowsClientRevision,
    needsBrief: r.needsBrief,
    requiresProperty: r.requiresProperty,
    requiresEntityTypeId: r.requiresEntityTypeId,
    captionPresetId: r.captionPresetId,
    descriptionPromptId: r.descriptionPromptId,
    descriptionSourceFieldKey: r.descriptionSourceFieldKey,
    descriptionFixedText: r.descriptionFixedText,
    descriptionDataLibraryId: r.descriptionDataLibraryId,
    descriptionDataSetTag: r.descriptionDataSetTag,
    autoSaveToLibraryId: r.autoSaveToLibraryId,
    templateNotes: r.templateNotes,
    customLabel: r.customLabel,
    dayOfWeek: r.dayOfWeek,
    publishTime: r.publishTime,
    isActive: r.isActive,
    defaultAssigneeMonteurId: r.defaultAssigneeMonteurId,
    defaultAssigneeCmId: r.defaultAssigneeCmId,
    defaultAssigneeVideasteId: r.defaultAssigneeVideasteId,
    captionPresetIdOverride: r.captionPresetIdOverride,
    descriptionPromptIdOverride: r.descriptionPromptIdOverride,
    coverModeOverride: r.coverModeOverride,
    bindingNotes: r.bindingNotes,
    sharedWithCount: r.sharedWithCount,
  };
}

/**
 * Forme brute renvoyée par POST/PATCH /api/admin/accounts/[id]/recipes[/[bindingId]]
 * — le PatternBinding Prisma tel quel, avec `patternTemplate` imbriqué
 * (`include: { patternTemplate: true }`). PAS le `RecipeItem` flatten que
 * consomme cette liste (celui-ci est construit côté SSR dans page.tsx, avec
 * en plus les noms d'assignés joints et `sharedWithCount` = `_count.bindings`
 * — absents de la réponse API). `bindingResponseToRecipeItem` referme cet
 * écart pour permettre une mise à jour optimiste sans réclamer un
 * `router.refresh()` complet.
 */
interface RecipeBindingApiResponse {
  id: string;
  patternTemplateId: string;
  customLabel: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
  captionPresetIdOverride: string | null;
  descriptionPromptIdOverride: string | null;
  coverModeOverride: string | null;
  notes: string | null;
  patternTemplate: {
    label: string;
    source: string;
    templateId: string | null;
    coverMode: string;
    needsCaptionsMode: string;
    needsDescription: string;
    needsAdminValidation: boolean;
    needsClientValidation: boolean;
    allowsClientRevision: boolean;
    needsBrief: boolean;
    requiresProperty: boolean;
    requiresEntityTypeId: string | null;
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    descriptionSourceFieldKey: string | null;
    descriptionFixedText: string | null;
    descriptionDataLibraryId: string | null;
    descriptionDataSetTag: string | null;
    autoSaveToLibraryId: string | null;
    notes: string | null;
  };
}

function findAssigneeName(options: AssigneeOption[], id: string | null): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.name ?? null;
}

/**
 * Reconstruit un `RecipeItem` à partir de la réponse API POST/PATCH
 * /recipes. `sharedWithCount` n'est pas renvoyé par l'API (pas de `_count`
 * dans le include) — fourni par l'appelant à partir de l'état connu, une
 * imprécision ponctuelle sans conséquence : le prochain `router.refresh()`
 * (resync via useEffect ci-dessous) corrige la valeur exacte.
 */
function bindingResponseToRecipeItem(
  b: RecipeBindingApiResponse,
  opts: {
    monteurs: AssigneeOption[];
    cms: AssigneeOption[];
    videastes: AssigneeOption[];
    sharedWithCount: number;
  },
): RecipeItem {
  const tpl = b.patternTemplate;
  const overrideCount = [
    b.captionPresetIdOverride,
    b.descriptionPromptIdOverride,
    b.coverModeOverride,
  ].filter((v) => v != null && v !== "").length;
  return {
    id: b.id,
    bindingId: b.id,
    patternTemplateId: b.patternTemplateId,
    label: patternLabel({ customLabel: b.customLabel, patternTemplate: { label: tpl.label } }),
    templateLabel: tpl.label,
    source: tpl.source,
    templateId: tpl.templateId,
    coverMode: tpl.coverMode,
    needsCaptionsMode: tpl.needsCaptionsMode,
    needsDescription: tpl.needsDescription,
    needsAdminValidation: tpl.needsAdminValidation,
    needsClientValidation: tpl.needsClientValidation,
    allowsClientRevision: tpl.allowsClientRevision,
    needsBrief: tpl.needsBrief,
    requiresProperty: tpl.requiresProperty,
    requiresEntityTypeId: tpl.requiresEntityTypeId,
    captionPresetId: tpl.captionPresetId,
    descriptionPromptId: tpl.descriptionPromptId,
    descriptionSourceFieldKey: tpl.descriptionSourceFieldKey,
    descriptionFixedText: tpl.descriptionFixedText,
    descriptionDataLibraryId: tpl.descriptionDataLibraryId,
    descriptionDataSetTag: tpl.descriptionDataSetTag,
    autoSaveToLibraryId: tpl.autoSaveToLibraryId,
    templateNotes: tpl.notes,
    customLabel: b.customLabel,
    dayOfWeek: b.dayOfWeek,
    publishTime: b.publishTime,
    isActive: b.isActive,
    defaultAssigneeMonteurId: b.defaultAssigneeMonteurId,
    defaultAssigneeCmId: b.defaultAssigneeCmId,
    defaultAssigneeVideasteId: b.defaultAssigneeVideasteId,
    defaultAssigneeMonteurName: findAssigneeName(opts.monteurs, b.defaultAssigneeMonteurId),
    defaultAssigneeCmName: findAssigneeName(opts.cms, b.defaultAssigneeCmId),
    defaultAssigneeVideasteName: findAssigneeName(opts.videastes, b.defaultAssigneeVideasteId),
    captionPresetIdOverride: b.captionPresetIdOverride,
    descriptionPromptIdOverride: b.descriptionPromptIdOverride,
    coverModeOverride: b.coverModeOverride,
    bindingNotes: b.notes,
    hasCaptionPresetOverride: !!b.captionPresetIdOverride,
    hasDescriptionPromptOverride: !!b.descriptionPromptIdOverride,
    hasCoverModeOverride: !!b.coverModeOverride,
    overrideCount,
    sharedWithCount: opts.sharedWithCount,
  };
}

export function AccountRecipesList({
  accountId,
  accountHandle,
  initialRecipes,
  catalogTemplates,
  builderTemplates,
  videoLibraries,
  monteurs,
  cms,
  videastes,
  captionPresets,
  descriptionPrompts,
}: Props) {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeItem[]>(initialRecipes);
  // P7 fix — `useState(initialRecipes)` ne capture QUE le tout premier
  // rendu : App Router préserve le state d'un Client Component à travers un
  // `router.refresh()` (le Server Component repasse des props fraîches, mais
  // ce state local n'est jamais réinitialisé). Sans ce resync, `recipes`
  // restait figé sur l'état d'avant tout save — rouvrir le drawer d'une
  // recette réaffichait alors ses valeurs périmées (ex. bibliothèque de
  // légendes tournantes montrée « Aucune » juste après l'avoir configurée),
  // et un ré-enregistrement depuis ce drawer périmé écrivait ces valeurs
  // périmées en base (effet destructif — cf. handleSave ci-dessous pour le
  // fix complémentaire côté écriture optimiste).
  useEffect(() => {
    setRecipes(initialRecipes);
  }, [initialRecipes]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [bulkReplaceOpen, setBulkReplaceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [peekTemplateId, setPeekTemplateId] = useState<string | null>(null);
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());

  const sortedRecipes = useMemo(() => {
    // Liées d'abord (triées par heure), puis disponibles (non liées) ensuite.
    return [...recipes].sort((a, b) => {
      const aBound = a.bindingId ? 0 : 1;
      const bBound = b.bindingId ? 0 : 1;
      if (aBound !== bBound) return aBound - bBound;
      return a.publishTime.localeCompare(b.publishTime);
    });
  }, [recipes]);

  function openCreateNew() {
    setEditing({
      bindingId: null,
      isCreating: true,
      initial: defaultRecipeFormInitial(),
    });
  }

  function openReuse(templateId: string) {
    const t = catalogTemplates.find((c) => c.id === templateId);
    if (!t) return;
    setEditing({
      bindingId: null,
      isCreating: true,
      reusedTemplateId: templateId,
      initial: {
        ...defaultRecipeFormInitial(),
        label: t.label,
        source: t.source,
      },
    });
  }

  function openEdit(r: RecipeItem) {
    // Recette non liée à ce compte → on ouvre le formulaire de configuration
    // (réutilisation du template) pour la lier en saisissant le planning.
    if (!r.bindingId) {
      openReuse(r.patternTemplateId);
      return;
    }
    setEditing({
      bindingId: r.bindingId,
      isCreating: false,
      initial: recipeItemToFormInitial(r),
    });
  }

  function closeDrawer() {
    setEditing(null);
  }

  async function handleSave(values: RecipeFormValues) {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.isCreating) {
        const body = editing.reusedTemplateId
          ? { template: { id: editing.reusedTemplateId }, binding: values.binding }
          : { template: values.template, binding: values.binding };
        const res = await fetch(`/api/admin/accounts/${accountId}/recipes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Erreur ${res.status}`);
        }
        let created: RecipeBindingApiResponse;
        try {
          created = (await res.json()) as RecipeBindingApiResponse;
        } catch {
          // res.ok mais corps illisible (proxy coupé après les headers,
          // timeout) — l'écriture a bien eu lieu côté serveur : ne PAS le
          // traiter comme un échec (le catch englobant afficherait "Erreur"
          // alors que la recette existe déjà, et retenter créerait un
          // doublon). Fallback : resync complet plutôt que l'update optimiste.
          toast.success("Recette créée — actualisation de la liste…");
          closeDrawer();
          router.refresh();
          return;
        }
        // Réutilisation d'un template catalogue : l'affiche déjà en carte
        // « disponible » (id = `tpl-<templateId>`) devient la recette liée.
        setRecipes((prev) => {
          const reusedFrom = prev.find((x) => x.patternTemplateId === created.patternTemplateId);
          const sharedWithCount = editing.reusedTemplateId
            ? (reusedFrom?.sharedWithCount ?? 0) + 1
            : 1;
          const item = bindingResponseToRecipeItem(created, {
            monteurs,
            cms,
            videastes,
            sharedWithCount,
          });
          return [
            ...prev.filter((x) => x.id !== `tpl-${created.patternTemplateId}`),
            item,
          ];
        });
        toast.success("Recette créée");
      } else {
        if (!editing.bindingId) throw new Error("ID binding manquant");
        const res = await fetch(
          `/api/admin/accounts/${accountId}/recipes/${editing.bindingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: values.template, binding: values.binding }),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Erreur ${res.status}`);
        }
        let updated: RecipeBindingApiResponse;
        try {
          updated = (await res.json()) as RecipeBindingApiResponse;
        } catch {
          // Même garde que la branche création ci-dessus — res.ok mais corps
          // illisible : l'écriture a réussi, ne pas le traiter comme un échec.
          toast.success("Recette mise à jour — actualisation de la liste…");
          closeDrawer();
          router.refresh();
          return;
        }
        // Mise à jour optimiste depuis la réponse (qui renvoie le template
        // complet) plutôt que d'attendre le round-trip router.refresh() —
        // P7 : sans ça, rouvrir ce même drawer avant la fin du refresh (ou
        // si le useEffect de resync n'avait pas encore tourné) réaffichait
        // l'état d'avant ce save.
        setRecipes((prev) => {
          const prevItem = prev.find((x) => x.id === updated.id);
          const item = bindingResponseToRecipeItem(updated, {
            monteurs,
            cms,
            videastes,
            sharedWithCount: prevItem?.sharedWithCount ?? 1,
          });
          return prev.map((x) => (x.id === updated.id ? item : x));
        });
        toast.success("Recette mise à jour");
      }
      closeDrawer();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: RecipeItem, next: boolean) {
    // Non liée à ce compte : activer = configurer le planning puis créer le
    // binding (via le formulaire). Désactiver est sans objet.
    if (!r.bindingId) {
      if (next) openReuse(r.patternTemplateId);
      return;
    }
    const bindingId = r.bindingId;
    if (pendingToggles.has(bindingId)) return;
    const previous = r;
    setPendingToggles((prev) => {
      const s = new Set(prev);
      s.add(bindingId);
      return s;
    });
    setRecipes((prev) => prev.map((x) => (x.id === r.id ? { ...x, isActive: next } : x)));
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/recipes/${bindingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binding: { isActive: next } }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Erreur ${res.status}`);
      }
      toast.success(next ? "Recette activée" : "Recette désactivée");
      // Fix mineur (post P7) : resynchronise recipes sur la DB après un
      // toggle réussi, comme handleSave. Sans ça, un router.refresh() déclenché
      // ailleurs (ex. handleSave d'une AUTRE recette) pendant que ce PATCH est
      // encore en vol peut écraser l'update optimiste avec des données DB pas
      // encore commitées (le useEffect de resync sur initialValues rejoue
      // alors l'ancien isActive) — ce refresh referme la fenêtre dès que ce
      // PATCH est effectivement résolu.
      router.refresh();
    } catch (err) {
      setRecipes((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, isActive: previous.isActive } : x)),
      );
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPendingToggles((prev) => {
        const s = new Set(prev);
        s.delete(bindingId);
        return s;
      });
    }
  }

  async function handleDelete() {
    if (!editing?.bindingId) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/recipes/${editing.bindingId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Erreur lors de la suppression");
      setRecipes((prev) => prev.filter((r) => r.id !== editing.bindingId));
      toast.success("Recette retirée du compte");
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
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          Recettes du compte
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={UserCheck}
            onClick={() => setBulkReplaceOpen(true)}
            title="Remplacer une assignée par défaut sur toutes les recettes"
            disabled={sortedRecipes.length === 0}
          >
            Remplacer assignée
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreateNew}>
            Nouvelle recette
          </Button>
        </div>
      </header>

      {sortedRecipes.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aucune recette"
          description={`Crée une recette pour @${accountHandle}.`}
          cta={{ label: "Nouvelle recette", onClick: openCreateNew }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortedRecipes.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              pendingToggle={r.bindingId ? pendingToggles.has(r.bindingId) : false}
              onClick={() => openEdit(r)}
              onPeek={() => setPeekTemplateId(r.patternTemplateId)}
              onToggle={(next) => void toggleActive(r, next)}
            />
          ))}
        </div>
      )}

      <PatternPeekDrawer
        open={peekTemplateId !== null}
        patternTemplateId={peekTemplateId}
        onClose={() => setPeekTemplateId(null)}
      />

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

      {editing && (
        <Drawer open onClose={closeDrawer} side="right" size="lg">
          <RecipeForm
            isCreating={editing.isCreating}
            reusedTemplateId={editing.reusedTemplateId}
            initial={editing.initial}
            monteurs={monteurs}
            cms={cms}
            videastes={videastes}
            builderTemplates={builderTemplates}
            videoLibraries={videoLibraries}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
            saving={saving}
            onSave={handleSave}
            onDelete={editing.bindingId ? handleDelete : undefined}
            onClose={closeDrawer}
          />
        </Drawer>
      )}
    </section>
  );
}

interface RecipeCardProps {
  recipe: RecipeItem;
  pendingToggle: boolean;
  onClick: () => void;
  onPeek: () => void;
  onToggle: (next: boolean) => void;
}

function RecipeCard({ recipe: r, pendingToggle, onClick, onPeek, onToggle }: RecipeCardProps) {
  const assignees = [
    r.defaultAssigneeVideasteName,
    r.defaultAssigneeMonteurName,
    r.defaultAssigneeCmName,
  ].filter(Boolean);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={[
        "group relative text-left rounded-md p-4 bg-card border border-border",
        "cursor-pointer transition-colors hover:bg-muted/30 hover:border-zinc-300",
        "focus:outline-none focus:ring-2 focus:ring-ring/40",
        !r.isActive ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ButtonIcon
          icon={Eye}
          label="Aperçu de la recette globale"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onPeek();
          }}
        />
      </div>

      <div className="flex items-start justify-between gap-2 pr-7">
        <h3 className="text-[14px] font-semibold text-foreground truncate">
          {r.label}
        </h3>
        <Chip variant={SOURCE_VARIANT[r.source] ?? "default"} size="sm">
          {SOURCE_LABELS_FR[r.source] ?? r.source}
        </Chip>
      </div>

      <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
        {r.bindingId ? (
          <p className="inline-flex items-center gap-1.5">
            <Clock size={11} />
            <span className="font-mono tabular-nums text-foreground">{r.publishTime}</span>
            <span className="text-muted-foreground">·</span>
            <span>
              {r.dayOfWeek.length === 0
                ? "Pas de planning auto"
                : r.dayOfWeek.map((d) => DAY_LABELS[d - 1] ?? `J${d}`).join(" · ")}
            </span>
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 italic">
            <Clock size={11} />
            Disponible — activer pour planifier sur ce compte
          </p>
        )}
        {assignees.length > 0 && (
          <p className="truncate">{assignees.join(" · ")}</p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-0"
          title={
            r.sharedWithCount > 1
              ? `Cette recette est aussi appliquée à ${r.sharedWithCount - 1} autre(s) compte(s).`
              : undefined
          }
        >
          <Sparkles size={11} className="shrink-0" />
          <span className="truncate">{r.templateLabel}</span>
          {r.sharedWithCount > 1 && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border">
              <Layers size={9} />
              {r.sharedWithCount}
            </span>
          )}
          {r.overrideCount > 0 && (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-info-50 border border-info-200 text-info-700"
              title="Cette recette a des paramètres spécifiques à ce compte (overrides du template global)."
            >
              <AlertCircle size={9} />
              {r.overrideCount} override{r.overrideCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Switch
            checked={r.isActive}
            onChange={(next) => onToggle(next)}
            size="sm"
            disabled={pendingToggle}
          />
        </div>
      </div>
    </div>
  );
}

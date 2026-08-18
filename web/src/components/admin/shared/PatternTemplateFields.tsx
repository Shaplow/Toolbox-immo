"use client";

/**
 * PatternTemplateFields — les 18 champs « contenu » de PatternTemplate,
 * partagés entre RecipeForm (onglet Contenu, fiche compte) et
 * PatternTemplateForm (catalogue + page /edit).
 *
 * Avant cette extraction, les deux formulaires dupliquaient ces champs avec
 * des encodages UI différents (Source en boutons vs Combobox, captions en 2
 * champs séparés vs 1 Combobox fusionné mode+preset), des libellés FR
 * différents, et surtout des validations différentes : seul
 * PatternTemplateForm portait les 4 gardes métier (cf. validateRecipeTemplate
 * ci-dessous). Un seul composant + un seul encode/decode/validate garantit
 * que les deux surfaces éditent et envoient exactement la même forme.
 *
 * Ergonomie retenue (appliquée aux deux surfaces) : captions et description
 * fusionnent mode + preset/prompt dans un seul Combobox (valeur encodée
 * "auto:<presetId>" / "autoGenerate:<promptId>") — c'est la version la plus
 * lisible des deux qui coexistaient.
 */

import { useEffect, useMemo, useState } from "react";
import { useRecipeEntityBinding } from "@/components/admin/shared/useRecipeEntityBinding";
import { requiredEntityTypeId } from "@/lib/publications/entityRequirement";
import {
  computeTemplateEntityCoverage,
  type TemplateFieldCoverage,
} from "@/lib/publications/templateEntityCoverage";
import type { SchemaField } from "@/types/template";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  CAPTIONS_MODE_LABELS_FR,
  NEEDS_DESCRIPTION_LABELS_FR,
  SOURCE_HELP,
  coverModeOptions,
  sourceOptions,
} from "@/lib/i18n/glossary";

// ── Valeurs formulaire (état local contrôlé) ────────────────────────────────
//
// Les champs id-optionnels utilisent "" comme sentinelle "aucun" (idiome
// Combobox du projet) — la conversion "" ↔ null se fait uniquement aux deux
// frontières : decode (source API → valeurs) et encode (valeurs → payload API).

export interface PatternTemplateFieldValues {
  label: string;
  source: string;
  templateId: string;
  coverMode: string;
  needsCaptionsMode: string;
  captionPresetId: string;
  needsDescription: string;
  descriptionPromptId: string;
  descriptionSourceFieldKey: string;
  descriptionFixedText: string;
  requiresEntityTypeId: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  autoSaveToLibraryId: string;
  notes: string;
}

/** Forme source acceptée par `decodePatternTemplateFields` (projection PatternTemplate). */
export interface PatternTemplateFieldsSource {
  label: string;
  source: string;
  templateId?: string | null;
  coverMode: string;
  needsCaptionsMode: string;
  captionPresetId?: string | null;
  needsDescription: string;
  descriptionPromptId?: string | null;
  descriptionSourceFieldKey?: string | null;
  descriptionFixedText?: string | null;
  requiresEntityTypeId?: string | null;
  /** @deprecated Legacy — dérivé vers le type « Bien » via requiredEntityTypeId(). */
  requiresProperty?: boolean | null;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  autoSaveToLibraryId?: string | null;
  notes: string | null;
}

/** Payload API — forme envoyée aux routes POST/PATCH (recipes + patterns). */
export interface PatternTemplateFieldsPayload {
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
  autoSaveToLibraryId: string | null;
  notes: string | null;
}

export function decodePatternTemplateFields(
  source: PatternTemplateFieldsSource | null,
): PatternTemplateFieldValues {
  // "fixed" est un alias legacy de "preFilled" côté résolution — les deux
  // modes convergent vers `resolvePrefilledCaption` (lib/publications/
  // preFilledDescription.ts). L'éditeur ne présente plus qu'UN mode
  // « Pré-remplie (modèle) » : une recette encore en "fixed" est normalisée
  // ici pour l'édition, le prochain enregistrement la réécrit en "preFilled".
  const rawNeedsDescription = source?.needsDescription ?? "none";
  const needsDescription = rawNeedsDescription === "fixed" ? "preFilled" : rawNeedsDescription;
  // Idem pour le texte : une recette legacy en mode "preFilled" par clé de
  // champ (`descriptionSourceFieldKey`, sans `descriptionFixedText`) est
  // affichée sous forme de template équivalent `{{clé}}` — sans ce seed, un
  // simple renommage de la recette écraserait silencieusement le
  // pré-remplissage (l'encode n'écrit plus jamais `descriptionSourceFieldKey`).
  const descriptionFixedText =
    source?.descriptionFixedText?.trim()
      ? source.descriptionFixedText
      : source?.descriptionSourceFieldKey
        ? `{{${source.descriptionSourceFieldKey}}}`
        : "";
  return {
    label: source?.label ?? "",
    source: source?.source ?? "manual_rushes",
    templateId: source?.templateId ?? "",
    coverMode: source?.coverMode ?? "none",
    needsCaptionsMode: source?.needsCaptionsMode ?? "none",
    captionPresetId: source?.captionPresetId ?? "",
    needsDescription,
    descriptionPromptId: source?.descriptionPromptId ?? "",
    descriptionSourceFieldKey: source?.descriptionSourceFieldKey ?? "",
    descriptionFixedText,
    requiresEntityTypeId: requiredEntityTypeId(source) ?? "",
    needsAdminValidation: source?.needsAdminValidation ?? false,
    needsClientValidation: source?.needsClientValidation ?? false,
    allowsClientRevision: source?.allowsClientRevision ?? false,
    needsBrief: source?.needsBrief ?? false,
    autoSaveToLibraryId: source?.autoSaveToLibraryId ?? "",
    notes: source?.notes ?? "",
  };
}

/**
 * Encode les valeurs formulaire vers le payload API. Dérive `requiresProperty`
 * (colonne legacy toujours écrite — le backfill + drop se font dans un lot
 * ultérieur) et n'écrit `captionPresetId`/`descriptionPromptId`/les champs
 * description conditionnels que si leur mode respectif les rend pertinents,
 * pour éviter de persister des ids orphelins d'un mode désactivé.
 *
 * `descriptionSourceFieldKey` n'a plus de surface d'écriture : le mode
 * « Pré-remplie (modèle) » écrit uniquement `descriptionFixedText` (modèle
 * `{{clé}}`) — cf. `resolvePrefilledCaption`.
 */
export function encodePatternTemplateFieldsPayload(
  values: PatternTemplateFieldValues,
): PatternTemplateFieldsPayload {
  return {
    label: values.label.trim(),
    source: values.source,
    templateId: values.templateId || null,
    coverMode: values.coverMode,
    needsCaptionsMode: values.needsCaptionsMode,
    needsDescription: values.needsDescription,
    needsAdminValidation: values.needsAdminValidation,
    needsClientValidation: values.needsClientValidation,
    allowsClientRevision: values.needsClientValidation && values.allowsClientRevision,
    needsBrief: values.needsBrief,
    requiresProperty: !!values.requiresEntityTypeId,
    requiresEntityTypeId: values.requiresEntityTypeId || null,
    captionPresetId: values.needsCaptionsMode === "auto" ? values.captionPresetId || null : null,
    descriptionPromptId:
      values.needsDescription === "autoGenerate" ? values.descriptionPromptId || null : null,
    descriptionSourceFieldKey: null,
    descriptionFixedText:
      values.needsDescription === "preFilled" ? values.descriptionFixedText.trim() || null : null,
    autoSaveToLibraryId: values.autoSaveToLibraryId || null,
    notes: values.notes.trim() || null,
  };
}

/**
 * Les 4 gardes métier + le nom requis. Retourne le premier message d'erreur
 * rencontré, ou null si tout est valide. Avant cette extraction, seul
 * PatternTemplateForm portait ces gardes — RecipeForm laissait créer des
 * recettes structurellement invalides depuis la fiche compte (ex. source
 * `auto_template` sans template builder, captions `auto` sans preset).
 */
export function validateRecipeTemplate(values: PatternTemplateFieldValues): string | null {
  if (!values.label.trim()) {
    return "Le nom de la recette est requis.";
  }
  if (values.source === "auto_template" && !values.templateId) {
    return "La source « Template auto » nécessite un template builder.";
  }
  if (values.needsCaptionsMode === "auto" && !values.captionPresetId) {
    return "Le mode captions auto nécessite un preset.";
  }
  if (values.needsDescription === "autoGenerate" && !values.descriptionPromptId) {
    return "La description auto nécessite un prompt IA.";
  }
  if (values.allowsClientRevision && !values.needsClientValidation) {
    return "« Autoriser révisions client » nécessite « Validation client » activée.";
  }
  return null;
}

// ── Encodage combobox fusionné (mode + preset/prompt dans une seule valeur) ─

function encodeCaptionsValue(mode: string, presetId: string): string {
  if (mode === "auto") return presetId ? `auto:${presetId}` : "auto:";
  return mode || "none";
}
function decodeCaptionsValue(v: string): { mode: string; presetId: string } {
  if (v.startsWith("auto:")) return { mode: "auto", presetId: v.slice(5) };
  return { mode: v || "none", presetId: "" };
}
function encodeDescriptionValue(mode: string, promptId: string): string {
  if (mode === "autoGenerate") return promptId ? `autoGenerate:${promptId}` : "autoGenerate:";
  return mode || "none";
}
function decodeDescriptionValue(v: string): { mode: string; promptId: string } {
  if (v.startsWith("autoGenerate:")) return { mode: "autoGenerate", promptId: v.slice(13) };
  return { mode: v || "none", promptId: "" };
}

// ── Composant ────────────────────────────────────────────────────────────

interface PatternTemplateFieldsProps {
  values: PatternTemplateFieldValues;
  onChange: (patch: Partial<PatternTemplateFieldValues>) => void;
  builderTemplates: { id: string; name: string }[];
  captionPresets: { id: string; name: string }[];
  descriptionPrompts: { id: string; name: string }[];
  videoLibraries: { id: string; name: string }[];
}

export function PatternTemplateFields({
  values: v,
  onChange,
  builderTemplates,
  captionPresets,
  descriptionPrompts,
  videoLibraries,
}: PatternTemplateFieldsProps) {
  const { entityTypes, propertyFieldKeys } = useRecipeEntityBinding({
    requiresEntityTypeId: v.requiresEntityTypeId,
    needsDescription: v.needsDescription,
  });

  return (
    <div className="space-y-5">
      {/* Identité */}
      <div className="space-y-4">
        <FormField label="Nom de la recette" required>
          <Input
            value={v.label}
            onChange={(val) => onChange({ label: val })}
            placeholder="Ex : Reels marché immo"
          />
        </FormField>

        <FormField label="Source" help={SOURCE_HELP[v.source]}>
          <Combobox
            value={v.source}
            onChange={(val) => onChange({ source: val })}
            options={sourceOptions()}
          />
        </FormField>

        {v.source === "auto_template" && (
          <FormField
            label="Template builder"
            required
            help="Le rendu vidéo utilise ce template."
          >
            <Combobox
              value={v.templateId}
              onChange={(val) => onChange({ templateId: val })}
              options={[
                { value: "", label: "— Choisir —" },
                ...builderTemplates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </FormField>
        )}
      </div>

      {/* Production */}
      <div className="space-y-4 pt-4 border-t border-border">
        <FormField label="Cover Instagram">
          <Combobox
            value={v.coverMode}
            onChange={(val) => onChange({ coverMode: val })}
            options={coverModeOptions()}
          />
        </FormField>

        <FormField label="Sous-titres">
          <Combobox
            value={encodeCaptionsValue(v.needsCaptionsMode, v.captionPresetId)}
            onChange={(val) => {
              const { mode, presetId } = decodeCaptionsValue(val);
              onChange({ needsCaptionsMode: mode, captionPresetId: presetId });
            }}
            options={[
              { value: "none", label: CAPTIONS_MODE_LABELS_FR.none },
              ...captionPresets.map((p) => ({
                value: `auto:${p.id}`,
                label: `Auto · ${p.name}`,
              })),
              { value: "manual", label: CAPTIONS_MODE_LABELS_FR.manual },
            ]}
          />
        </FormField>

        <FormField label="Description Instagram">
          <Combobox
            value={encodeDescriptionValue(v.needsDescription, v.descriptionPromptId)}
            onChange={(val) => {
              const { mode, promptId } = decodeDescriptionValue(val);
              onChange({ needsDescription: mode, descriptionPromptId: promptId });
            }}
            options={[
              { value: "none", label: NEEDS_DESCRIPTION_LABELS_FR.none },
              { value: "preFilled", label: "Pré-remplie (modèle)" },
              ...descriptionPrompts.map((p) => ({
                value: `autoGenerate:${p.id}`,
                label: `Auto IA · ${p.name}`,
              })),
              { value: "manualWrite", label: NEEDS_DESCRIPTION_LABELS_FR.manualWrite },
            ]}
          />
        </FormField>

        {v.needsDescription === "preFilled" && (
          <FormField
            label="Modèle de légende"
            help={
              "Copié dans la légende au rattachement de la fiche (création ou changement de fiche liée) — pas de resynchronisation automatique ensuite. Insère des clés de la fiche avec {{clé}} — non résolues, elles s'affichent vides. Depuis la publication, \"Recalculer\" resynchronise la légende sur les valeurs actuelles de la fiche."
            }
          >
            <Textarea
              value={v.descriptionFixedText}
              onChange={(val) => onChange({ descriptionFixedText: val })}
              rows={5}
              placeholder={"🏡 Nouveau bien à {{adresse}} — {{prix}}, tourné le {{date_tournage}}"}
            />
            {propertyFieldKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {propertyFieldKeys.map((f) => (
                  <Chip
                    key={f.key}
                    size="sm"
                    onClick={() =>
                      onChange({
                        descriptionFixedText: v.descriptionFixedText
                          ? `${v.descriptionFixedText} {{${f.key}}}`
                          : `{{${f.key}}}`,
                      })
                    }
                  >
                    {f.label === f.key ? f.key : `${f.label} · ${f.key}`}
                  </Chip>
                ))}
              </div>
            )}
          </FormField>
        )}

        <FormField
          label="Exige une fiche"
          help="Une fiche de ce type doit être rattachée pour créer un slot ou une mission depuis cette recette."
        >
          <Combobox
            value={v.requiresEntityTypeId}
            onChange={(val) => onChange({ requiresEntityTypeId: val })}
            options={[
              { value: "", label: "Aucune" },
              ...entityTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </FormField>

        {/* Diagnostic de couverture — visible uniquement quand la recette a
            à la fois un template builder ET un type de fiche exigé, seul cas
            où « quel champ vient de la fiche ? » a un sens à vérifier. */}
        {v.source === "auto_template" && v.templateId && v.requiresEntityTypeId && (
          <TemplateEntityCoverageDiagnostic
            templateId={v.templateId}
            entityTypeId={v.requiresEntityTypeId}
            entityTypeName={entityTypes.find((t) => t.id === v.requiresEntityTypeId)?.name ?? null}
          />
        )}
      </div>

      {/* Workflow */}
      <div className="space-y-1.5 pt-4 border-t border-border">
        <h3 className="text-[10px] uppercase tracking-widest font-semibold text-foreground mb-1">
          Workflow
        </h3>
        <WorkflowToggle
          label="Brief éditorial"
          description="Champ Brief à remplir avant production."
          checked={v.needsBrief}
          onChange={(val) => onChange({ needsBrief: val })}
        />
        <WorkflowToggle
          label="Validation admin du montage"
          description="Le montage passe par « À valider » avant publication."
          checked={v.needsAdminValidation}
          onChange={(val) => onChange({ needsAdminValidation: val })}
        />
        <WorkflowToggle
          label="Validation client (magic link)"
          description="Lien de validation envoyé au client avant publication."
          checked={v.needsClientValidation}
          onChange={(val) =>
            onChange(
              // Désactiver needsClientValidation cascade aussi allowsClientRevision —
              // évite un état incohérent (révision autorisée sans validation active).
              !val && v.allowsClientRevision
                ? { needsClientValidation: val, allowsClientRevision: false }
                : { needsClientValidation: val },
            )
          }
        />
        {v.needsClientValidation && (
          <div className="ml-3 pl-3 border-l-2 border-danger-200/60">
            <WorkflowToggle
              label="Autoriser révisions client"
              description="Le client peut refuser avec un commentaire."
              checked={v.allowsClientRevision}
              onChange={(val) => onChange({ allowsClientRevision: val })}
            />
          </div>
        )}
      </div>

      {/* Sortie */}
      <div className="space-y-4 pt-4 border-t border-border">
        <FormField
          label="Auto-save sortie vers bibliothèque"
          help="La sortie de génération est copiée automatiquement en tant que média vidéo."
        >
          <Combobox
            value={v.autoSaveToLibraryId}
            onChange={(val) => onChange({ autoSaveToLibraryId: val })}
            options={[
              { value: "", label: "Aucune (désactivé)" },
              ...videoLibraries.map((lib) => ({ value: lib.id, label: lib.name })),
            ]}
          />
        </FormField>

        <FormField label="Notes internes">
          <Textarea
            value={v.notes}
            onChange={(val) => onChange({ notes: val })}
            rows={3}
            placeholder="Contexte, conventions de naming, instructions équipe…"
          />
        </FormField>
      </div>
    </div>
  );
}

function WorkflowToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border text-info-600 focus:ring-info-600"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  );
}

// ── Diagnostic de couverture template ↔ fiche ──────────────────────────────
//
// Croise le schéma du template builder (`templateId`) avec les clés du
// fieldSchema du type de fiche exigé (`requiresEntityTypeId`) et affiche
// honnêtement ce qui matchera réellement à la génération — cf.
// `lib/publications/templateEntityCoverage.ts` pour la règle de matching
// (même règle que `buildSlotPrefill`/`enrichListingWithEntityFields`, pas une
// approximation). Fetch direct (pas de prop serveur) : ce composant partagé
// n'a pas de canal de props dédié pour ça, et les deux routes consommées
// (`/api/templates/[id]`, `/api/entity-types/[id]/field-keys`) existent déjà
// — pas de doublon créé.

interface EntityFieldKeyOption {
  key: string;
  label: string;
}

function coverageBadgeVariant(status: TemplateFieldCoverage["status"]): "success" | "info" | "warning" {
  if (status === "uncovered") return "warning";
  if (status === "shootEntitySource") return "info";
  return "success";
}

function coverageTitle(f: TemplateFieldCoverage, entityTypeName: string | null): string {
  switch (f.status) {
    case "entitySource":
      return `${f.key} — source explicite déclarée dans le builder`;
    case "keyMatch":
      return `${f.key} — correspondance de nom avec un champ de la fiche`;
    case "shootEntitySource":
      return `${f.key} — alimenté par la fiche tournage, pas par « ${entityTypeName ?? "ce type"} »`;
    case "uncovered":
      return `${f.key} — aucune fiche ne l'alimente, restera vide sans saisie manuelle`;
  }
}

function TemplateEntityCoverageDiagnostic({
  templateId,
  entityTypeId,
  entityTypeName,
}: {
  templateId: string;
  entityTypeId: string;
  entityTypeName: string | null;
}) {
  const [templateSchema, setTemplateSchema] = useState<SchemaField[] | null>(null);
  const [entityFieldKeys, setEntityFieldKeys] = useState<EntityFieldKeyOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [templateRes, keysRes] = await Promise.all([
          fetch(`/api/templates/${templateId}`),
          fetch(`/api/entity-types/${entityTypeId}/field-keys`),
        ]);
        if (!templateRes.ok || !keysRes.ok) {
          if (!cancelled) setError("Diagnostic indisponible — impossible de charger le template ou la fiche.");
          return;
        }
        const templateData = (await templateRes.json()) as { jsonData?: { schema?: SchemaField[] } };
        const keysData = (await keysRes.json()) as EntityFieldKeyOption[];
        if (cancelled) return;
        setTemplateSchema(templateData.jsonData?.schema ?? []);
        setEntityFieldKeys(keysData);
      } catch {
        if (!cancelled) setError("Diagnostic indisponible — erreur réseau.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, entityTypeId]);

  const coverage = useMemo(
    () => (templateSchema && entityFieldKeys ? computeTemplateEntityCoverage(templateSchema, entityFieldKeys) : null),
    [templateSchema, entityFieldKeys],
  );

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Analyse de la couverture template ↔ fiche…</p>;
  }
  if (error) {
    return <p className="text-[11px] text-danger-700">{error}</p>;
  }
  if (!coverage || coverage.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Ce template n&apos;a aucun champ de schéma à croiser avec la fiche.
      </p>
    );
  }

  // Le compte du titre ne retient QUE ce qui est réellement alimenté par le
  // type de fiche EXIGÉ — un champ alimenté par la fiche tournage n'est pas
  // couvert par « entityTypeName », le mélanger au compte mentirait sur ce
  // que la recette garantit. Il reste affiché, dans son propre groupe.
  const coveredByRequired = coverage.filter((f) => f.status === "entitySource" || f.status === "keyMatch");
  const coveredByShoot = coverage.filter((f) => f.status === "shootEntitySource");
  const uncovered = coverage.filter((f) => f.status === "uncovered");

  return (
    <Alert
      variant={uncovered.length > 0 ? "warning" : "success"}
      title={`${coveredByRequired.length} / ${coverage.length} champs du template alimentés par « ${entityTypeName ?? "la fiche"} »`}
    >
      <div className="space-y-2">
        {coveredByRequired.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {coveredByRequired.map((f) => (
              <span key={f.key} title={coverageTitle(f, entityTypeName)}>
                <Badge variant={coverageBadgeVariant(f.status)} size="sm">
                  {f.label}
                </Badge>
              </span>
            ))}
          </div>
        )}
        {coveredByShoot.length > 0 && (
          <div>
            <p className="text-[11px] font-medium mb-1">
              Alimentés par la fiche tournage (pas par « {entityTypeName ?? "ce type"} ») :
            </p>
            <div className="flex flex-wrap gap-1.5">
              {coveredByShoot.map((f) => (
                <span key={f.key} title={coverageTitle(f, entityTypeName)}>
                  <Badge variant="info" size="sm">
                    {f.label}
                  </Badge>
                </span>
              ))}
            </div>
          </div>
        )}
        {uncovered.length > 0 && (
          <div>
            <p className="text-[11px] font-medium mb-1">
              Non couverts — resteront vides sans saisie manuelle :
            </p>
            <div className="flex flex-wrap gap-1.5">
              {uncovered.map((f) => (
                <span key={f.key} title={coverageTitle(f, entityTypeName)}>
                  <Badge variant="warning" size="sm">
                    {f.label}
                  </Badge>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Alert>
  );
}

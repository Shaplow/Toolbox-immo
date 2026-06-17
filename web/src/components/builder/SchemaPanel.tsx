"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, GripVertical, Maximize2, Pencil, Plus, Trash2 } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { SchemaOrganizerModal } from "./SchemaOrganizerModal";
import {
  EMPTY_SCHEMA_FIELD,
  SCHEMA_FIELD_TYPES,
  createFormSectionId,
  createDuplicateSchemaFieldKey,
  getConditionSourceFields,
  getConditionValueOptions,
  parseSelectOptions,
  validateSchemaFieldKey,
} from "@/lib/schemaFields";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";
import type { DecimalSeparator } from "@/lib/numberFormatting";
import type { SchemaField, SchemaFieldType, TemplateFormSection, VideoBlock } from "@/types/template";

type SchemaFieldDraft = Omit<SchemaField, "key"> & { key: string };

type SchemaBucket = {
  id: string;
  title: string;
  description?: string;
  sectionId?: string;
  isUnsectioned: boolean;
  fields: Array<{ field: SchemaField; index: number; isAutoDpe: boolean }>;
};

const UNSECTIONED_BUCKET_ID = "__unsectioned__";
const SCHEMA_PANEL_COLLAPSE_KEY_PREFIX = "toolbox-schema-panel-collapsed";

export function SchemaPanel() {
  const pathname = usePathname();
  const collapseStorageKey = useMemo(
    () => `${SCHEMA_PANEL_COLLAPSE_KEY_PREFIX}:${pathname}`,
    [pathname]
  );
  const { template, setSchema, setFormSections } = useBuilderStore();
  const schema = template.schema;
  const formSections = template.formSections;
  const existingKeys = useMemo(() => schema.map((field) => field.key), [schema]);
  const autoSchemaFields = useMemo(() => {
    const existing = new Set(schema.map((field) => field.key));
    const hasDpe = template.blocks.some((block) => block.type === "dpe");
    if (!hasDpe) return [] as SchemaField[];
    return DPE_AUTO_FIELDS.filter((field) => !existing.has(field.key));
  }, [schema, template.blocks]);
  const effectiveSchema = useMemo(() => [...schema, ...autoSchemaFields], [autoSchemaFields, schema]);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);
  const [dropBucketId, setDropBucketId] = useState<string | null>(null);
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [collapsedBucketIds, setCollapsedBucketIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(`${SCHEMA_PANEL_COLLAPSE_KEY_PREFIX}:${pathname}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  });
  const [hasLoadedCollapsedState, setHasLoadedCollapsedState] = useState(false);

  // Video libraries for metadata source picker
  const [videoLibraries, setVideoLibraries] = useState<{ id: string; name: string; metadataSchema: string }[]>([]);
  const [videoLibrariesLoading, setVideoLibrariesLoading] = useState(false);
  const videoSequenceLibraryIds = useMemo(
    () => [
      ...template.blocks
        .filter((b) => b.type === "video" && !!(b as { libraryId?: string }).libraryId)
        .map((b) => (b as { libraryId?: string }).libraryId!),
      ...(template.videoSequence ?? []).filter((s) => !!s.libraryId).map((s) => s.libraryId!),
    ].filter((id, idx, arr) => arr.indexOf(id) === idx),
    [template.blocks, template.videoSequence]
  );
  useEffect(() => {
    setVideoLibrariesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/admin/libraries/media?type=video");
        if (!res.ok) { setVideoLibrariesLoading(false); return; }
        const libs = await res.json() as { id: string; name: string; metadataSchema: string }[];
        setVideoLibraries(libs.filter((l) => videoSequenceLibraryIds.includes(l.id)));
      } catch { /* non-critical */ }
      finally { setVideoLibrariesLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSequenceLibraryIds.join(",")]);

  const videoBlockOptions = useMemo(
    () => template.blocks
      .filter((b): b is VideoBlock => b.type === "video")
      .map((b) => ({ id: b.id, name: b.name, libraryId: b.libraryId })),
    [template.blocks]
  );

  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState<SchemaFieldDraft>({ key: "", ...EMPTY_SCHEMA_FIELD });
  const [newOptionsDraft, setNewOptionsDraft] = useState("");
  const [keyError, setKeyError] = useState("");

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<SchemaFieldDraft | null>(null);
  const [editingOptionsDraft, setEditingOptionsDraft] = useState("");

  function startAdding() {
    setAdding(true);
    setKeyError("");
    setNewField({ key: "", ...EMPTY_SCHEMA_FIELD });
    setNewOptionsDraft("");
  }

  function cancelAdding() {
    setAdding(false);
    setKeyError("");
    setNewField({ key: "", ...EMPTY_SCHEMA_FIELD });
    setNewOptionsDraft("");
  }

  function getEditableSchemaField(fieldKey: string): { field: SchemaField; workingSchema: SchemaField[]; isAutoDpe: boolean } | null {
    const persisted = schema.find((field) => field.key === fieldKey);
    if (persisted) return { field: persisted, workingSchema: schema, isAutoDpe: false };

    const autoField = autoSchemaFields.find((field) => field.key === fieldKey);
    if (!autoField) return null;
    return { field: autoField, workingSchema: [...schema, autoField], isAutoDpe: true };
  }

  function startEditing(fieldKey: string) {
    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;
    if (editable.isAutoDpe) setSchema(editable.workingSchema);
    const field = editable.field;
    setEditingKey(field.key);
    setEditingDraft({ ...field, key: field.key });
    setEditingOptionsDraft(field.options?.join("\n") ?? "");
  }

  function stopEditing() {
    setEditingKey(null);
    setEditingDraft(null);
    setEditingOptionsDraft("");
  }

  function updateField(fieldKey: string, changes: Partial<SchemaField>) {
    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;
    setSchema(editable.workingSchema.map((field) => (
      field.key === fieldKey ? { ...field, ...changes } : field
    )));
  }

  function removeField(fieldKey: string) {
    setSchema(schema.filter((field) => field.key !== fieldKey));
  }

  function duplicateField(fieldKey: string) {
    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;

    const sourceField = editable.field;
    const nextKey = createDuplicateSchemaFieldKey(sourceField.key, editable.workingSchema.map((field) => field.key));
    const nextField: SchemaFieldDraft = {
      ...sourceField,
      key: nextKey,
      label: `${sourceField.label || sourceField.key} (copie)`,
    };

    setAdding(true);
    setKeyError("");
    setNewField(nextField);
    setNewOptionsDraft(sourceField.options?.join("\n") ?? "");
  }

  function adaptDraftForType(field: SchemaFieldDraft, nextType: SchemaFieldType): SchemaFieldDraft {
    const next: SchemaFieldDraft = {
      ...field,
      type: nextType,
      options: nextType === "select" ? field.options ?? [] : undefined,
      formatThousands: nextType === "number" ? field.formatThousands ?? false : false,
      decimalSeparator: nextType === "number" ? (field.decimalSeparator ?? ",") : undefined,
    };

    if (nextType === "boolean") {
      next.default = field.default === true || field.default === false ? field.default : undefined;
      next.placeholder = undefined;
    } else if (nextType === "select") {
      next.default = typeof field.default === "string" ? field.default : undefined;
    } else if (nextType === "number") {
      next.default = typeof field.default === "number" ? field.default : undefined;
    } else {
      next.default = typeof field.default === "string" ? field.default : undefined;
    }

    return next;
  }

  function persistNewField() {
    const error = validateSchemaFieldKey(newField.key, existingKeys);
    if (error) {
      setKeyError(error);
      return;
    }
    const nextField: SchemaField = {
      ...newField,
      key: newField.key.trim(),
      label: newField.label.trim() || newField.key.trim(),
      description: newField.description || undefined,
      optionsSource: newField.type === "select" ? newField.optionsSource : undefined,
      options: newField.type === "select" && !newField.optionsSource ? parseSelectOptions(newOptionsDraft) : undefined,
    };
    setSchema([...schema, nextField]);
    setKeyError("");
  }

  function persistEditing() {
    if (!editingKey || !editingDraft) return;
    const nextField: SchemaField = {
      ...editingDraft,
      key: editingDraft.key,
      label: editingDraft.label.trim() || editingDraft.key,
      description: editingDraft.description || undefined,
      optionsSource: editingDraft.type === "select" ? editingDraft.optionsSource : undefined,
      options: editingDraft.type === "select" && !editingDraft.optionsSource ? parseSelectOptions(editingOptionsDraft) : undefined,
    };
    updateField(editingKey, nextField);
    stopEditing();
  }

  function addSection() {
    const title = newSectionTitle.trim();
    if (!title) return;

    let id = createFormSectionId(title);
    let suffix = 2;
    while (formSections.some((section) => section.id === id)) {
      id = `${createFormSectionId(title)}-${suffix}`;
      suffix += 1;
    }

    setFormSections([...formSections, { id, title }]);
    setNewSectionTitle("");
  }

  function updateSection(sectionId: string, changes: Partial<TemplateFormSection>) {
    setFormSections(formSections.map((section) => (
      section.id === sectionId
        ? {
            ...section,
            ...changes,
            title: changes.title !== undefined ? changes.title : section.title,
            description: changes.description !== undefined ? changes.description || undefined : section.description,
          }
        : section
    )));
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    const index = formSections.findIndex((section) => section.id === sectionId);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= formSections.length) return;
    const next = [...formSections];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setFormSections(next);
  }

  function removeSection(sectionId: string) {
    setFormSections(formSections.filter((section) => section.id !== sectionId));
  }

  function moveFieldToSection(fieldKey: string, nextSectionId?: string) {
    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;

    const field = editable.field;
    if ((field.sectionId ?? undefined) === nextSectionId) return;

    const nextField: SchemaField = {
      ...field,
      sectionId: nextSectionId,
    };

    const nextSchema = editable.workingSchema.filter((item) => item.key !== fieldKey);
    nextSchema.push(nextField);
    setSchema(nextSchema);
  }

  const buckets = useMemo<SchemaBucket[]>(() => {
    const sectionMap = new Map<string, Array<{ field: SchemaField; index: number; isAutoDpe: boolean }>>();
    const unsectionedFields: Array<{ field: SchemaField; index: number; isAutoDpe: boolean }> = [];
    const autoDpeKeys = new Set(autoSchemaFields.map((field) => field.key));

    effectiveSchema.forEach((field, index) => {
      const entry = { field, index, isAutoDpe: autoDpeKeys.has(field.key) };
      if (field.sectionId && formSections.some((section) => section.id === field.sectionId)) {
        if (!sectionMap.has(field.sectionId)) sectionMap.set(field.sectionId, []);
        sectionMap.get(field.sectionId)?.push(entry);
        return;
      }
      unsectionedFields.push(entry);
    });

    return [
      ...formSections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        sectionId: section.id,
        isUnsectioned: false,
        fields: sectionMap.get(section.id) ?? [],
      })),
      {
        id: UNSECTIONED_BUCKET_ID,
        title: "Hors section",
        description: "Champs laissés hors section",
        isUnsectioned: true,
        fields: unsectionedFields,
      },
    ];
  }, [autoSchemaFields, effectiveSchema, formSections]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setCollapsedBucketIds(parsed.filter((value): value is string => typeof value === "string"));
    } catch {
      // Ignore malformed persisted UI state.
    } finally {
      setHasLoadedCollapsedState(true);
    }
  }, [collapseStorageKey]);

  useEffect(() => {
    const validBucketIds = new Set(buckets.map((bucket) => bucket.id));
    setCollapsedBucketIds((current) => {
      const next = current.filter((id) => validBucketIds.has(id));
      if (next.length === current.length) return current;
      return next;
    });
  }, [buckets]);

  useEffect(() => {
    if (!hasLoadedCollapsedState) return;
    localStorage.setItem(collapseStorageKey, JSON.stringify(collapsedBucketIds));
  }, [collapsedBucketIds, collapseStorageKey, hasLoadedCollapsedState]);

  function toggleBucket(bucketId: string) {
    setCollapsedBucketIds((current) => (
      current.includes(bucketId)
        ? current.filter((id) => id !== bucketId)
        : [...current, bucketId]
    ));
  }

  return (
    <div className="w-full bg-slate-50 flex flex-col h-full overflow-hidden">
      <div className="px-3 py-3 border-b border-border bg-white space-y-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Variables</p>
          <p className="text-[13px] text-muted-foreground mt-0.5">{effectiveSchema.length} champ{effectiveSchema.length > 1 ? "s" : ""}{autoSchemaFields.length > 0 ? ` · ${autoSchemaFields.length} auto DPE` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOrganizerOpen(true)}
            title="Ouvrir l'organizer grand format"
            className="flex-1 shrink-0 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border bg-white text-muted-foreground hover:border-indigo-300 hover:text-indigo-700"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Studio
          </button>
          <button
            onClick={startAdding}
            title="Ajouter une variable"
            className="flex-1 shrink-0 inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </button>
        </div>
      </div>

      <SchemaOrganizerModal open={isOrganizerOpen} onClose={() => setIsOrganizerOpen(false)} />

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        <div className="rounded-[20px] border border-border bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-slate-50 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sections</p>
          </div>
          <div className="p-2.5 space-y-2">
            {formSections.length > 0 ? (
              formSections.map((section, index) => (
                <div key={section.id} className="rounded-xl border border-border bg-slate-50 px-2.5 py-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(section.id, { title: e.target.value })}
                      className="min-w-0 flex-1 border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 text-[11px]"
                    />
                    <button type="button" onClick={() => moveSection(section.id, -1)} disabled={index === 0} className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border hover:text-muted-foreground disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" onClick={() => moveSection(section.id, 1)} disabled={index === formSections.length - 1} className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border hover:text-muted-foreground disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                    <button type="button" onClick={() => removeSection(section.id)} className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground/60 hover:border-red-200 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-1 text-[11px] text-muted-foreground">Aucune section créée.</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                placeholder="Nouvelle section"
                className="min-w-0 flex-1 border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-[11px]"
              />
              <button
                type="button"
                onClick={addSection}
                className="shrink-0 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Section
              </button>
            </div>
          </div>
        </div>

        {adding && (
          <div className="rounded-2xl border border-indigo-200 bg-white p-3 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wide">Nouveau champ</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Définis la structure du formulaire.</p>
              </div>
            </div>
            <SchemaFieldEditor
              mode="create"
              field={newField}
              schema={schema}
              sections={formSections}
              optionsDraft={newOptionsDraft}
              keyError={keyError}
              onFieldChange={(changes) => {
                setNewField((current) => ({ ...current, ...changes }));
                if (changes.key !== undefined) setKeyError("");
              }}
              onTypeChange={(nextType) => setNewField((current) => adaptDraftForType(current, nextType))}
              onOptionsDraftChange={setNewOptionsDraft}
              videoLibraries={videoLibraries}
              videoLibrariesLoading={videoLibrariesLoading}
              videoBlockOptions={videoBlockOptions}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={persistNewField}
                className="flex-1 text-center py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs font-medium"
              >
                Ajouter au schéma
              </button>
              <button
                type="button"
                onClick={cancelAdding}
                className="flex-1 text-center py-1.5 bg-white text-muted-foreground rounded-lg border border-border hover:bg-muted transition-colors text-xs"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {effectiveSchema.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground text-center mt-8 px-4">
            Aucune variable. Ajoute un premier champ pour construire le formulaire de génération.
          </p>
        )}

        {buckets.map((bucket) => (
          <div
            key={bucket.id}
            onDragOver={(event) => {
              if (!draggedFieldKey) return;
              event.preventDefault();
              if (dropBucketId !== bucket.id) setDropBucketId(bucket.id);
            }}
            onDragLeave={() => {
              if (dropBucketId === bucket.id) setDropBucketId(null);
            }}
            onDrop={(event) => {
              if (!draggedFieldKey) return;
              event.preventDefault();
              moveFieldToSection(draggedFieldKey, bucket.isUnsectioned ? undefined : bucket.sectionId);
              setDraggedFieldKey(null);
              setDropBucketId(null);
            }}
            className={`rounded-[20px] border shadow-sm overflow-hidden transition-colors ${dropBucketId === bucket.id ? "border-indigo-300 bg-indigo-50/70" : "border-border bg-white"}`}
          >
            <div className="px-3 py-2 border-b border-border bg-slate-50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => toggleBucket(bucket.id)}
                className="min-w-0 flex flex-1 items-center gap-2 text-left"
              >
                {collapsedBucketIds.includes(bucket.id) ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[11px] font-semibold text-slate-700 truncate">{bucket.title}</p>
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-muted-foreground border border-border">{bucket.fields.length}</span>
                  {bucket.isUnsectioned ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">hors sec.</span> : null}
                </div>
              </button>
              {dropBucketId === bucket.id ? <span className="text-[10px] text-indigo-600">Lacher ici</span> : null}
            </div>

            {!collapsedBucketIds.includes(bucket.id) ? <div className="p-2 space-y-1.5 min-h-10">
              {bucket.fields.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-slate-50 px-2.5 py-2 text-[10px] text-muted-foreground text-center">
                  Glisser un champ ici
                </div>
              ) : bucket.fields.map(({ field, isAutoDpe }) => {
                const isEditing = editingKey === field.key && editingDraft;
                return (
                  <div key={field.key} className="rounded-xl border border-border bg-white overflow-hidden">
                    <div
                      draggable={!isEditing}
                      onDragStart={() => setDraggedFieldKey(field.key)}
                      onDragEnd={() => {
                        setDraggedFieldKey(null);
                        setDropBucketId(null);
                      }}
                      className={`px-2.5 py-2 ${!isEditing ? "cursor-grab active:cursor-grabbing" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="pt-0.5 text-muted-foreground/60 shrink-0">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-[12px] font-medium text-slate-800 truncate">{field.label || field.key}</p>
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                              {SCHEMA_FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type}
                            </span>
                            {isAutoDpe ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-700">auto DPE</span> : null}
                            {field.showIf ? <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-600">cond</span> : null}
                            {field.metadataSource?.metadataKey ? <span className="rounded-full bg-teal-50 border border-teal-100 px-1.5 py-0.5 text-[9px] text-teal-700">auto</span> : null}
                          </div>
                          <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">{field.key}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateField(field.key, { required: !field.required })}
                          className={`flex-1 h-7 px-2 rounded-lg border text-[10px] ${field.required ? "border-red-200 bg-red-50 text-red-500" : "border-border text-muted-foreground hover:border-border hover:text-muted-foreground"}`}
                          title={field.required ? "Optionnel" : "Requis"}
                        >
                          {field.required ? "Req" : "Opt"}
                        </button>
                        <button type="button" onClick={() => duplicateField(field.key)} className="flex-1 h-7 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-border hover:text-foreground" title="Dupliquer"><Copy className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => startEditing(field.key)} className="flex-1 h-7 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-border hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" disabled={isAutoDpe} onClick={() => removeField(field.key)} title={isAutoDpe ? "Champ auto lie au bloc DPE" : "Supprimer"} className="flex-1 h-7 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground/60 hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground/60"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="border-t border-border p-3 bg-slate-50/80 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Edition</p>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={persistEditing}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={stopEditing}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
                            >
                              Fermer
                            </button>
                          </div>
                        </div>
                        <SchemaFieldEditor
                          mode="edit"
                          field={editingDraft}
                          schema={effectiveSchema}
                          sections={formSections}
                          optionsDraft={editingOptionsDraft}
                          onFieldChange={(changes) => setEditingDraft((current) => current ? { ...current, ...changes } : current)}
                          onTypeChange={(nextType) => setEditingDraft((current) => current ? adaptDraftForType(current, nextType) : current)}
                          onOptionsDraftChange={setEditingOptionsDraft}
                          videoLibraries={videoLibraries}
                          videoLibrariesLoading={videoLibrariesLoading}
                          videoBlockOptions={videoBlockOptions}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sous-composant pour la section "Options" d'un champ select. */
function SelectOptionsEditor({
  field,
  optionsDraft,
  onOptionsDraftChange,
  onFieldChange,
  videoBlockOptions = [],
}: {
  field: SchemaFieldDraft;
  optionsDraft: string;
  onOptionsDraftChange: (v: string) => void;
  onFieldChange: (changes: Partial<SchemaFieldDraft>) => void;
  videoBlockOptions?: { id: string; name?: string; libraryId?: string }[];
}) {
  const isIgAccounts = field.optionsSource?.type === "ig-accounts-from-library";
  const isMetaValues = field.optionsSource?.type === "metadata-values-from-library";
  const isDynamic = isIgAccounts || isMetaValues;
  const [videoLibraries, setVideoLibraries] = useState<{ id: string; name: string; metadataSchema?: string }[]>([]);

  useEffect(() => {
    if (!isDynamic && field.optionsSource === undefined) return;
    fetch("/api/admin/libraries/media?type=video")
      .then((r) => r.ok ? r.json() : [])
      .then((data: { id: string; name: string; metadataSchema?: string }[]) => setVideoLibraries(data))
      .catch(() => {});
  }, [isDynamic, field.optionsSource]);

  /** Metadata fields for the currently selected library (metadata-values mode). */
  const metaLibrary = isMetaValues ? videoLibraries.find((l) => l.id === field.optionsSource?.libraryId) : undefined;
  const metaFields: { key: string; label: string }[] = (() => {
    if (!metaLibrary?.metadataSchema) return [];
    try { return JSON.parse(metaLibrary.metadataSchema) as { key: string; label: string }[]; }
    catch { return []; }
  })();

  /** All video blocks in the template — the link is explicit via blockId, library comes from optionsSource. */
  const eligibleBlocks = videoBlockOptions;

  function fetchLibraries() {
    setVideoLibraries([]);
    fetch("/api/admin/libraries/media?type=video")
      .then((r) => r.ok ? r.json() : [])
      .then((data: { id: string; name: string; metadataSchema?: string }[]) => setVideoLibraries(data))
      .catch(() => {});
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Mode toggle */}
      <span className="text-muted-foreground">Options</span>
      <div className="flex rounded-lg overflow-hidden border border-border text-[11px]">
        <button
          type="button"
          onClick={() => onFieldChange({ optionsSource: undefined })}
          className={`flex-1 px-2 py-1.5 transition-colors ${
            !isDynamic ? "bg-indigo-600 text-white font-medium" : "bg-white text-muted-foreground hover:bg-muted"
          }`}
        >
          Manuelle
        </button>
        <button
          type="button"
          onClick={() => {
            fetchLibraries();
            onFieldChange({ optionsSource: { type: "ig-accounts-from-library", libraryId: "" }, options: undefined });
          }}
          className={`flex-1 px-2 py-1.5 transition-colors border-l border-border ${
            isIgAccounts ? "bg-indigo-600 text-white font-medium" : "bg-white text-muted-foreground hover:bg-muted"
          }`}
        >
          Comptes IG d&apos;une lib
        </button>
        <button
          type="button"
          onClick={() => {
            fetchLibraries();
            onFieldChange({ optionsSource: { type: "metadata-values-from-library", libraryId: "", metadataKey: "", blockId: "" }, options: undefined });
          }}
          className={`flex-1 px-2 py-1.5 transition-colors border-l border-border ${
            isMetaValues ? "bg-indigo-600 text-white font-medium" : "bg-white text-muted-foreground hover:bg-muted"
          }`}
        >
          Valeurs métadonnées
        </button>
      </div>

      {!isDynamic ? (
        <label className="flex flex-col gap-1">
          <textarea
            rows={4}
            value={optionsDraft}
            onChange={(e) => {
              onOptionsDraftChange(e.target.value);
              const options = parseSelectOptions(e.target.value);
              onFieldChange({
                options,
                default: typeof field.default === "string" && options.includes(field.default) ? field.default : options[0] ?? undefined,
              });
            }}
            placeholder={"vendeur\nacquéreur"}
            className="border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono text-[11px]"
          />
          <span className="text-[10px] text-muted-foreground">Une option par ligne.</span>
        </label>
      ) : isIgAccounts ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Bibliothèque vidéo</span>
            <select
              value={field.optionsSource?.libraryId ?? ""}
              onChange={(e) => onFieldChange({ optionsSource: { type: "ig-accounts-from-library", libraryId: e.target.value } })}
              className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">Choisir une bibliothèque…</option>
              {videoLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-indigo-600 bg-indigo-50 rounded px-2 py-1 leading-relaxed">
            Les options du select seront auto-remplies avec les comptes Instagram qui ont du contenu dans cette bibliothèque.
          </p>
        </div>
      ) : (
        /* metadata-values-from-library */
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Bibliothèque</span>
            <select
              value={field.optionsSource?.libraryId ?? ""}
              onChange={(e) => onFieldChange({
                optionsSource: { type: "metadata-values-from-library", libraryId: e.target.value, metadataKey: "", blockId: "" },
              })}
              className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">Choisir une bibliothèque…</option>
              {videoLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>{lib.name}</option>
              ))}
            </select>
          </label>

          {field.optionsSource?.libraryId && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Champ métadonnée</span>
              {metaFields.length === 0 ? (
                <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">
                  Cette bibliothèque n&apos;a pas de champs de métadonnées définis.
                </p>
              ) : (
                <select
                  value={field.optionsSource?.metadataKey ?? ""}
                  onChange={(e) => onFieldChange({
                    optionsSource: { ...field.optionsSource!, metadataKey: e.target.value },
                  })}
                  className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">Choisir un champ…</option>
                  {metaFields.map((f) => (
                    <option key={f.key} value={f.key}>{f.label} ({f.key})</option>
                  ))}
                </select>
              )}
            </label>
          )}

          {field.optionsSource?.libraryId && field.optionsSource?.metadataKey && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Bloc vidéo piloté</span>
              {eligibleBlocks.length === 0 ? (
                <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">
                  Aucun bloc vidéo dans ce template.
                </p>
              ) : (
                <select
                  value={field.optionsSource?.blockId ?? ""}
                  onChange={(e) => onFieldChange({
                    optionsSource: { ...field.optionsSource!, blockId: e.target.value },
                  })}
                  className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">Choisir un bloc…</option>
                  {eligibleBlocks.map((b) => (
                    <option key={b.id} value={b.id}>{b.name ?? `Bloc vidéo (${b.id.slice(0, 6)})`}</option>
                  ))}
                </select>
              )}
            </label>
          )}

          {field.optionsSource?.blockId && field.optionsSource?.metadataKey && (
            <p className="text-[10px] text-emerald-700 bg-emerald-50 rounded px-2 py-1 leading-relaxed">
              Les options seront les valeurs distinctes du champ <span className="font-mono">{field.optionsSource.metadataKey}</span> dans la bibliothèque.
              La valeur choisie sélectionnera automatiquement l&apos;asset correspondant au rendu.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SchemaFieldEditor({
  mode,
  field,
  schema,
  sections,
  optionsDraft,
  keyError,
  onFieldChange,
  onTypeChange,
  onOptionsDraftChange,
  videoLibraries = [],
  videoLibrariesLoading = false,
  videoBlockOptions = [],
}: {
  mode: "create" | "edit";
  field: SchemaFieldDraft;
  schema: SchemaField[];
  sections: TemplateFormSection[];
  optionsDraft: string;
  keyError?: string;
  onFieldChange: (changes: Partial<SchemaFieldDraft>) => void;
  onTypeChange: (nextType: SchemaFieldType) => void;
  onOptionsDraftChange: (value: string) => void;
  videoLibraries?: { id: string; name: string; metadataSchema: string }[];
  videoLibrariesLoading?: boolean;
  videoBlockOptions?: { id: string; name?: string; libraryId?: string }[];
}) {
  // Parsed metadata schemas per library
  const parsedLibrarySchemas = useMemo(
    () => videoLibraries.map((lib) => ({
      ...lib,
      fields: (() => { try { return JSON.parse(lib.metadataSchema ?? "[]") as { key: string; label: string; type: string }[]; } catch { return []; } })()
    })),
    [videoLibraries]
  );
  const conditionFields = getConditionSourceFields(schema, mode === "edit" ? field.key : field.key || undefined);
  const selectedConditionField = schema.find((item) => item.key === field.showIf?.field);
  const conditionValueOptions = getConditionValueOptions(selectedConditionField);
  const supportsPlaceholder = field.type !== "boolean";

  return (
    <div className="space-y-2.5 text-[11px]">
      <FieldGroup label="Identité">
        {mode === "create" ? (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Clé</span>
            <input
              type="text"
              value={field.key}
              onChange={(e) => onFieldChange({ key: e.target.value })}
              placeholder="ma_variable"
              className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            {keyError ? <span className="text-[11px] text-red-500">{keyError}</span> : null}
            {!keyError ? <span className="text-[10px] text-muted-foreground">Tu peux utiliser des majuscules. Caractères autorisés : lettres, chiffres et _.</span> : null}
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Clé</span>
            <p className="font-mono rounded-lg border border-border bg-muted px-2.5 py-2 text-muted-foreground">{`{{${field.key}}}`}</p>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Nom affiché</span>
          <input
            type="text"
            value={field.label}
            onChange={(e) => onFieldChange({ label: e.target.value })}
            placeholder="Ex: Prix du bien"
            className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Description</span>
          <input
            type="text"
            value={field.description ?? ""}
            onChange={(e) => onFieldChange({ description: e.target.value || undefined })}
            placeholder={mode === "edit" ? "Aide affichée sous le champ" : ""}
            className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Section</span>
          <select
            value={field.sectionId ?? ""}
            onChange={(e) => onFieldChange({ sectionId: e.target.value || undefined })}
            className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">Hors section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>{section.title}</option>
            ))}
          </select>
        </label>
      </FieldGroup>

      <FieldGroup label="Type et saisie">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Type</span>
          <select
            value={field.type}
            onChange={(e) => onTypeChange(e.target.value as SchemaFieldType)}
            className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            {SCHEMA_FIELD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>

        {field.type === "select" && (
          <SelectOptionsEditor
            field={field}
            optionsDraft={optionsDraft}
            onOptionsDraftChange={onOptionsDraftChange}
            onFieldChange={onFieldChange}
            videoBlockOptions={videoBlockOptions}
          />
        )}

        {field.type === "number" && (
          <div className="space-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Séparateur décimal</span>
              <select
                value={field.decimalSeparator ?? ","}
                onChange={(e) => onFieldChange({ decimalSeparator: e.target.value as DecimalSeparator })}
                className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value=",">Virgule (31,4)</option>
                <option value=".">Point (31.4)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.formatThousands ?? false}
                onChange={(e) => onFieldChange({ formatThousands: e.target.checked })}
                className="rounded"
              />
              <span className="text-muted-foreground">Espaces milliers</span>
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onFieldChange({ required: e.target.checked })}
            className="rounded"
          />
          <span className="text-muted-foreground">Champ requis si visible</span>
        </label>
      </FieldGroup>

      {(field.type === "text" || field.type === "number") && (
        <FieldGroup label="Source automatique (asset)">
          {videoLibrariesLoading ? (
            <p className="text-[10px] text-muted-foreground">Chargement des bibliothèques…</p>
          ) : parsedLibrarySchemas.length === 0 ? (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Liez un bloc vidéo à une bibliothèque avec un schéma de métadonnées pour activer la source automatique.
            </p>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Remplit automatiquement ce champ depuis les métadonnées de l&apos;asset vidéo résolu à la génération.
                Utilisez {`{{${field.key || "…"}}}`} dans vos blocs texte pour afficher cette valeur.
              </p>
              {field.metadataSource ? (
                <div className="space-y-1.5">
                  <select
                    value={field.metadataSource.libraryId}
                    onChange={(e) => {
                      const libId = e.target.value;
                      if (!libId) {
                        onFieldChange({ metadataSource: undefined });
                      } else {
                        onFieldChange({ metadataSource: { libraryId: libId, metadataKey: "" } });
                      }
                    }}
                    className="w-full border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="">— Aucune source —</option>
                    {parsedLibrarySchemas.map((lib) => (
                      <option key={lib.id} value={lib.id}>{lib.name}</option>
                    ))}
                  </select>
                  {field.metadataSource.libraryId && (() => {
                    const lib = parsedLibrarySchemas.find((l) => l.id === field.metadataSource!.libraryId);
                    if (!lib || lib.fields.length === 0) return (
                      <p className="text-[10px] text-amber-600">Cette bibliothèque n&apos;a pas de champs de métadonnées définis.</p>
                    );
                    return (
                      <select
                        value={field.metadataSource.metadataKey}
                        onChange={(e) => onFieldChange({ metadataSource: { ...field.metadataSource!, metadataKey: e.target.value } })}
                        className="w-full border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        <option value="">— Choisir un champ —</option>
                        {lib.fields.map((f) => (
                          <option key={f.key} value={f.key}>{f.label} ({f.key})</option>
                        ))}
                      </select>
                    );
                  })()}
                  {field.metadataSource.metadataKey && (() => {
                    const lib = parsedLibrarySchemas.find((l) => l.id === field.metadataSource!.libraryId);
                    const metaFieldDef = lib?.fields.find((f) => f.key === field.metadataSource!.metadataKey);
                    return (
                      <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-700">
                        <span className="font-medium">Lié : </span>
                        {lib?.name ?? field.metadataSource!.libraryId}
                        {" · "}{metaFieldDef?.label ?? <code className="font-mono">{field.metadataSource!.metadataKey}</code>}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onFieldChange({ metadataSource: { libraryId: "", metadataKey: "" } })}
                  className="w-full text-left px-2.5 py-2 rounded-lg border border-dashed border-indigo-300 text-indigo-600 text-[10px] hover:bg-indigo-50 transition-colors"
                >
                  + Lier à une métadonnée d&apos;asset
                </button>
              )}
            </>
          )}
        </FieldGroup>
      )}

      <FieldGroup label="Valeur initiale">
        <DefaultValueInput field={field} onChange={(value) => onFieldChange({ default: value })} />
        {supportsPlaceholder && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Placeholder</span>
              <input
                type="text"
                value={field.placeholder ?? ""}
                onChange={(e) => onFieldChange({ placeholder: e.target.value || undefined })}
                placeholder="Texte indicatif"
                className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
          </>
        )}
      </FieldGroup>

      <FieldGroup label="Affichage conditionnel">
        <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(field.showIf)}
            onChange={(e) => onFieldChange({ showIf: e.target.checked ? { field: "", equals: "" } : undefined })}
            className="rounded"
          />
          <span className="text-muted-foreground">Afficher ce champ seulement dans certains cas</span>
        </label>
        {field.showIf && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Champ source</span>
              <select
                value={field.showIf.field}
                onChange={(e) => {
                  const nextField = schema.find((item) => item.key === e.target.value);
                  onFieldChange({
                    showIf: {
                      field: e.target.value,
                      equals: getConditionValueOptions(nextField)[0]?.value ?? "",
                    },
                  });
                }}
                className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">— choisir —</option>
                {conditionFields.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>{candidate.label || candidate.key}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Valeur attendue</span>
              {conditionValueOptions.length > 0 ? (
                <select
                  value={field.showIf.equals}
                  onChange={(e) => onFieldChange({ showIf: { ...field.showIf!, equals: e.target.value } })}
                  className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">— choisir —</option>
                  {conditionValueOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={field.showIf.equals}
                  onChange={(e) => onFieldChange({ showIf: { ...field.showIf!, equals: e.target.value } })}
                  placeholder="valeur"
                  className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              )}
            </label>
          </div>
        )}
      </FieldGroup>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-slate-50 p-2.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      {children}
    </div>
  );
}

function DefaultValueInput({
  field,
  onChange,
}: {
  field: SchemaFieldDraft;
  onChange: (value: unknown) => void;
}) {
  if (field.type === "boolean") {
    const value = field.default === true ? "true" : field.default === false ? "false" : "";
    return (
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Valeur par défaut</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
          className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">Aucune</option>
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Valeur par défaut</span>
        <select
          value={typeof field.default === "string" ? field.default : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">Aucune</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Valeur par défaut</span>
        <input
          type="number"
          value={typeof field.default === "number" ? field.default : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          placeholder="Ex: 980000"
          className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">Valeur par défaut</span>
      <input
        type="text"
        value={typeof field.default === "string" ? field.default : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="Valeur initiale"
        className="border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </label>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, LayoutPanelTop, Minus, Monitor, Plus, Smartphone, SquareSplitHorizontal, Tablet, Trash2, X } from "lucide-react";
import { MAX_SECTION_LAYOUT_ROWS, UNSECTIONED_FORM_SECTION_ID, buildVisibleFormSections, getFieldPlacementClass, getFieldSpanClass, getFieldStaticPlacementStyle, getFormSectionGridClass, getFormSectionSpanClass, getSectionFieldsInVisualOrder, type ResolvedFormSection } from "@/lib/formSections";
import {
  SCHEMA_FIELD_TYPES,
  buildSchemaPreviewData,
  createFormSectionId,
  getConditionDriverFields,
  getConditionSourceFields,
  getConditionValueOptions,
} from "@/lib/schemaFields";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { ConditionMatch, SchemaField, TemplateFormSection, TemplateSectionColumnCount } from "@/types/template";

type SchemaBucket = {
  id: string;
  title: string;
  description?: string;
  sectionId?: string;
  isUnsectioned: boolean;
  section?: TemplateFormSection;
  fields: Array<{ field: SchemaField; index: number }>;
};

type DropTarget = {
  bucketId: string;
  beforeFieldKey: string | null;
};

type GridDropTarget =
  | {
      sectionId: string;
      kind: "auto";
    }
  | {
      sectionId: string;
      kind: "cell";
      column: TemplateSectionColumnCount;
      row: number;
    };

type SectionDropTarget = {
  beforeSectionId: string | null;
};

type PreviewViewport = "mobile" | "tablet" | "desktop";

const UNSECTIONED_BUCKET_ID = UNSECTIONED_FORM_SECTION_ID;

export function SchemaOrganizerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { template, setSchema, setFormSections } = useBuilderStore();
  const schema = template.schema;
  const formSections = template.formSections;
  const autoSchemaFields = useMemo(() => {
    const existingKeys = new Set(schema.map((field) => field.key));
    const hasDpe = template.blocks.some((block) => block.type === "dpe");
    if (!hasDpe) return [] as SchemaField[];
    return DPE_AUTO_FIELDS.filter((field) => !existingKeys.has(field.key));
  }, [schema, template.blocks]);
  const effectiveSchema = useMemo(() => [...schema, ...autoSchemaFields], [autoSchemaFields, schema]);
  const validSectionIds = useMemo(() => new Set(formSections.map((section) => section.id)), [formSections]);

  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>(UNSECTIONED_BUCKET_ID);
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [gridDropTarget, setGridDropTarget] = useState<GridDropTarget | null>(null);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<SectionDropTarget | null>(null);
  const [viewMode, setViewMode] = useState<"organize" | "preview">("organize");
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("desktop");
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(() => buildSchemaPreviewData(effectiveSchema));

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    if (selectedSectionId === UNSECTIONED_BUCKET_ID) return;
    if (formSections.some((section) => section.id === selectedSectionId)) return;
    setSelectedSectionId(formSections[0]?.id ?? UNSECTIONED_BUCKET_ID);
  }, [formSections, open, selectedSectionId]);

  useEffect(() => {
    const basePreview = buildSchemaPreviewData(effectiveSchema);
    setPreviewValues((current) => {
      const next: Record<string, unknown> = { ...basePreview };
      for (const key of Object.keys(basePreview)) {
        if (key in current) next[key] = current[key];
      }
      return next;
    });
  }, [effectiveSchema]);

  const buckets = useMemo<SchemaBucket[]>(() => {
    const sectionMap = new Map<string, Array<{ field: SchemaField; index: number }>>();
    const unsectionedFields: Array<{ field: SchemaField; index: number }> = [];

    effectiveSchema.forEach((field, index) => {
      if (field.sectionId && validSectionIds.has(field.sectionId)) {
        if (!sectionMap.has(field.sectionId)) sectionMap.set(field.sectionId, []);
        sectionMap.get(field.sectionId)?.push({ field, index });
        return;
      }
      unsectionedFields.push({ field, index });
    });

    return [
      ...formSections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        sectionId: section.id,
        isUnsectioned: false,
        section,
        fields: sectionMap.get(section.id) ?? [],
      })),
      {
        id: UNSECTIONED_BUCKET_ID,
        title: "Hors section",
        description: "Champs laissés hors section. Ils s'affichent simplement dans un bloc standard.",
        isUnsectioned: true,
        fields: unsectionedFields,
      },
    ];
  }, [effectiveSchema, formSections, validSectionIds]);

  const selectedBucket = buckets.find((bucket) => bucket.id === selectedSectionId) ?? buckets[buckets.length - 1];
  const selectedSection = selectedBucket?.isUnsectioned ? undefined : selectedBucket?.section;
  const selectedConditions = selectedSection?.conditions ?? (selectedSection?.showIf ? [selectedSection.showIf] : []);
  const conditionFields = getConditionSourceFields(effectiveSchema);
  const previewConditionFields = useMemo(
    () => getConditionDriverFields(effectiveSchema, formSections),
    [effectiveSchema, formSections]
  );
  const previewSections = useMemo(
    () => buildVisibleFormSections(effectiveSchema, formSections, previewValues),
    [effectiveSchema, formSections, previewValues]
  );
  const visibleExplicitSectionIds = new Set(previewSections.map((section) => section.id).filter((id) => validSectionIds.has(id)));
  const hiddenExplicitSections = formSections.filter((section) => !visibleExplicitSectionIds.has(section.id)).length;
  const workflowStartIndex = formSections.findIndex((section) => section.revealWhenPreviousComplete === true);
  const workflowStartSectionId = workflowStartIndex >= 0 ? formSections[workflowStartIndex]?.id ?? null : null;
  const workflowSectionIds = workflowStartIndex >= 0 ? formSections.slice(workflowStartIndex).map((section) => section.id) : [];
  const workflowPreviewLabel = workflowStartIndex >= 0
    ? formSections.slice(workflowStartIndex).map((section) => section.title).join(" -> ")
    : "";

  function addSection() {
    const title = newSectionTitle.trim();
    if (!title) return;

    let id = createFormSectionId(title);
    let suffix = 2;
    while (formSections.some((section) => section.id === id)) {
      id = `${createFormSectionId(title)}-${suffix}`;
      suffix += 1;
    }

    setFormSections([
      ...formSections,
      {
        id,
        title,
        layout: {
          desktopSpan: "full",
          fieldColumns: 2,
          rowCount: 3,
        },
      },
    ]);
    setNewSectionTitle("");
    setSelectedSectionId(id);
  }

  function updateSection(sectionId: string, changes: Partial<TemplateFormSection>) {
    setFormSections(formSections.map((section) => {
      if (section.id !== sectionId) return section;

      const nextConditions = changes.conditions !== undefined
        ? (changes.conditions.length > 0 ? changes.conditions : undefined)
        : section.conditions;

      return {
        ...section,
        ...changes,
        title: changes.title !== undefined ? changes.title : section.title,
        description: changes.description !== undefined ? changes.description || undefined : section.description,
        conditions: nextConditions,
        showIf: undefined,
        layout: changes.layout !== undefined
          ? {
              desktopSpan: changes.layout?.desktopSpan ?? section.layout?.desktopSpan ?? "full",
              fieldColumns: changes.layout?.fieldColumns ?? section.layout?.fieldColumns ?? 2,
              rowCount: changes.layout?.rowCount ?? section.layout?.rowCount,
            }
          : section.layout,
      };
    }));
  }

  function updateSectionRowCount(sectionId: string, nextRowCount: number) {
    const rowCount = Math.max(1, Math.min(MAX_SECTION_LAYOUT_ROWS, Math.round(nextRowCount)));
    setFormSections(formSections.map((section) => {
      if (section.id !== sectionId) return section;
      return {
        ...section,
        layout: {
          desktopSpan: section.layout?.desktopSpan ?? "full",
          fieldColumns: section.layout?.fieldColumns ?? 2,
          rowCount,
        },
      };
    }));

    setSchema(schema.map((field) => {
      if (field.sectionId !== sectionId) return field;
      if (!field.sectionLayout?.row || field.sectionLayout.row <= rowCount) return field;
      return {
        ...field,
        sectionLayout: {
          ...(field.sectionLayout.column ? { column: field.sectionLayout.column } : {}),
          row: rowCount,
        },
      };
    }));
  }

  function resetSectionFieldPlacement(sectionId: string) {
    setSchema(schema.map((field) => (
      field.sectionId === sectionId
        ? {
            ...field,
            sectionLayout: undefined,
          }
        : field
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
    if (selectedSectionId === sectionId) {
      setSelectedSectionId(formSections.find((section) => section.id !== sectionId)?.id ?? UNSECTIONED_BUCKET_ID);
    }
  }

  function moveSectionBefore(sectionId: string, beforeSectionId: string | null) {
    const fromIndex = formSections.findIndex((section) => section.id === sectionId);
    if (fromIndex === -1) return;

    const next = [...formSections];
    const [movedSection] = next.splice(fromIndex, 1);
    const insertIndex = beforeSectionId
      ? next.findIndex((section) => section.id === beforeSectionId)
      : next.length;
    next.splice(insertIndex === -1 ? next.length : insertIndex, 0, movedSection);
    setFormSections(next);
  }

  function handleSectionDrop(beforeSectionId: string | null) {
    if (!draggedSectionId) return;
    if (draggedSectionId === beforeSectionId) return;
    moveSectionBefore(draggedSectionId, beforeSectionId);
    setDraggedSectionId(null);
    setSectionDropTarget(null);
  }

  function belongsToBucket(field: SchemaField, sectionId: string | undefined): boolean {
    if (sectionId) return field.sectionId === sectionId;
    return !field.sectionId || !validSectionIds.has(field.sectionId);
  }

  function getBucketAppendIndex(remainingSchema: SchemaField[], sectionId: string | undefined): number {
    let lastIndex = -1;
    remainingSchema.forEach((field, index) => {
      if (belongsToBucket(field, sectionId)) lastIndex = index;
    });
    return lastIndex === -1 ? remainingSchema.length : lastIndex + 1;
  }

  function mergeSectionLayout(
    currentLayout: SchemaField["sectionLayout"],
    changes: {
      column?: TemplateSectionColumnCount | null;
      row?: number | null;
    }
  ): SchemaField["sectionLayout"] {
    const nextColumn = changes.column === undefined ? currentLayout?.column : changes.column ?? undefined;
    const nextRowRaw = changes.row === undefined ? currentLayout?.row : changes.row ?? undefined;
    const nextRow = nextRowRaw ? Math.max(1, Math.min(nextRowRaw, MAX_SECTION_LAYOUT_ROWS)) : undefined;

    if (!nextColumn && !nextRow) return undefined;

    return {
      ...(nextColumn ? { column: nextColumn } : {}),
      ...(nextRow ? { row: nextRow } : {}),
    };
  }

  function getEditableSchemaField(fieldKey: string): { field: SchemaField; workingSchema: SchemaField[] } | null {
    const persisted = schema.find((field) => field.key === fieldKey);
    if (persisted) return { field: persisted, workingSchema: schema };

    const autoField = autoSchemaFields.find((field) => field.key === fieldKey);
    if (!autoField) return null;

    return {
      field: autoField,
      workingSchema: [...schema, autoField],
    };
  }

  function moveField(
    fieldKey: string,
    nextSectionId?: string,
    beforeFieldKey: string | null = null,
    placement?: {
      column?: TemplateSectionColumnCount | null;
      row?: number | null;
    }
  ) {
    if (beforeFieldKey === fieldKey) return;

    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;

    const field = editable.field;
    const remainingSchema = editable.workingSchema.filter((item) => item.key !== fieldKey);
    let insertIndex = beforeFieldKey ? remainingSchema.findIndex((item) => item.key === beforeFieldKey) : -1;
    if (insertIndex === -1) insertIndex = getBucketAppendIndex(remainingSchema, nextSectionId);

    const nextField: SchemaField = {
      ...field,
      sectionId: nextSectionId,
      sectionLayout: nextSectionId ? mergeSectionLayout(field.sectionLayout, placement ?? {}) : undefined,
    };

    remainingSchema.splice(insertIndex, 0, nextField);
    setSchema(remainingSchema);
  }

  function updateFieldPlacement(
    fieldKey: string,
    changes: {
      column?: TemplateSectionColumnCount | null;
      row?: number | null;
    }
  ) {
    const editable = getEditableSchemaField(fieldKey);
    if (!editable) return;

    setSchema(editable.workingSchema.map((field) => (
      field.key === fieldKey
        ? {
            ...field,
            sectionLayout: mergeSectionLayout(field.sectionLayout, changes),
          }
        : field
    )));
  }

  function placeFieldInSection(
    fieldKey: string,
    sectionId: string,
    placement: {
      column?: TemplateSectionColumnCount | null;
      row?: number | null;
    }
  ) {
    const field = effectiveSchema.find((item) => item.key === fieldKey);
    if (!field) return;

    if (field.sectionId === sectionId) {
      updateFieldPlacement(fieldKey, placement);
      return;
    }

    moveField(fieldKey, sectionId, null, placement);
  }

  function handleDrop(bucketId: string, beforeFieldKey: string | null) {
    if (!draggedFieldKey) return;

    const nextSectionId = bucketId === UNSECTIONED_BUCKET_ID ? undefined : bucketId;
    moveField(draggedFieldKey, nextSectionId, beforeFieldKey);
    setDraggedFieldKey(null);
    setDropTarget(null);
    setGridDropTarget(null);
  }

  function updateSectionConditions(nextConditions: ConditionMatch[]) {
    if (!selectedSection) return;
    updateSection(selectedSection.id, { conditions: nextConditions });
  }

  function updateFieldColumn(fieldKey: string, column?: TemplateSectionColumnCount) {
    updateFieldPlacement(fieldKey, { column: column ?? null });
  }

  function updateFieldRow(fieldKey: string, row?: number) {
    updateFieldPlacement(fieldKey, { row: row ?? null });
  }

  function addCondition() {
    if (!selectedSection || conditionFields.length === 0) return;
    const sourceField = conditionFields[0];
    const firstValue = getConditionValueOptions(sourceField)[0]?.value;
    if (!firstValue) return;
    updateSectionConditions([...selectedConditions, { field: sourceField.key, equals: firstValue }]);
  }

  function updateCondition(index: number, changes: Partial<ConditionMatch>) {
    const nextConditions = [...selectedConditions];
    const current = nextConditions[index];
    if (!current) return;

    nextConditions[index] = {
      ...current,
      ...changes,
    };
    updateSectionConditions(nextConditions);
  }

  function removeCondition(index: number) {
    updateSectionConditions(selectedConditions.filter((_, conditionIndex) => conditionIndex !== index));
  }

  function getPreviewShellClass(viewport: PreviewViewport): string {
    switch (viewport) {
      case "mobile":
        return "mx-auto w-full max-w-[420px]";
      case "tablet":
        return "mx-auto w-full max-w-[860px]";
      default:
        return "w-full";
    }
  }

  function getPreviewSectionsWrapperClass(viewport: PreviewViewport): string {
    return viewport === "desktop" ? "grid grid-cols-1 gap-4 2xl:grid-cols-2" : "grid grid-cols-1 gap-4";
  }

  function getPreviewSectionSpanClass(section: ResolvedFormSection, viewport: PreviewViewport): string {
    return viewport === "desktop" ? getFormSectionSpanClass(section) : "col-span-1";
  }

  function getPreviewSectionGridClass(section: ResolvedFormSection, viewport: PreviewViewport): string {
    if (viewport === "desktop") return getFormSectionGridClass(section);
    if (viewport === "tablet") {
      return section.fieldColumns > 1 ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4";
    }
    return "grid grid-cols-1 gap-4";
  }

  function getPreviewFieldSpanClass(field: SchemaField, section: ResolvedFormSection, viewport: PreviewViewport): string {
    if (viewport === "desktop") return `${getFieldSpanClass(field, section.fieldColumns)} ${getFieldPlacementClass(field, section.fieldColumns)}`.trim();
    if (viewport === "tablet") return (field.type === "image" || field.type === "video") && section.fieldColumns > 1 ? "md:col-span-2" : "md:col-span-1";
    return "col-span-1";
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-slate-950/45 backdrop-blur-sm p-3 md:p-6">
      <div className="mx-auto flex h-full w-full max-w-[1760px] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-[#f6f7fb] shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 md:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Schema studio</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 md:text-xl">Organisation grand format du formulaire</h2>
            <p className="mt-1 text-sm text-slate-500">Trie les variables, empile plusieurs conditions par section et visualise le rendu final sans quitter le builder.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900"
            title="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-slate-200 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="min-h-0 overflow-y-auto bg-white p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Sections</p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={newSectionTitle}
                  onChange={(event) => setNewSectionTitle(event.target.value)}
                  placeholder="Nouvelle section"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-0 focus:border-indigo-300"
                />
                <button
                  type="button"
                  onClick={addSection}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {formSections.map((section, index) => {
                const bucket = buckets.find((item) => item.id === section.id);
                if (!bucket) return null;
                const isSelected = selectedBucket?.id === bucket.id;
                const columnCount = section?.layout?.fieldColumns ?? 2;
                const conditionCount = section?.conditions?.length ?? (section?.showIf ? 1 : 0);
                const hasProgressiveReveal = section.revealWhenPreviousComplete === true;
                const isWorkflowStart = workflowStartSectionId === section.id;
                const isWorkflowStep = workflowSectionIds.includes(section.id) && !isWorkflowStart;

                return (
                  <Fragment key={bucket.id}>
                    <DropZone
                      compact
                      active={sectionDropTarget?.beforeSectionId === section.id}
                      onDragOver={(event) => {
                        if (!draggedSectionId) return;
                        event.preventDefault();
                        setSectionDropTarget({ beforeSectionId: section.id });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleSectionDrop(section.id);
                      }}
                    />
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDraggedSectionId(bucket.id)}
                      onDragEnd={() => {
                        setDraggedSectionId(null);
                        setSectionDropTarget(null);
                      }}
                      onClick={() => setSelectedSectionId(bucket.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${isSelected ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"} ${draggedSectionId === bucket.id ? "opacity-70" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{bucket.title}</p>
                            <p className="mt-1 text-xs text-slate-500">{bucket.fields.length} champ{bucket.fields.length > 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">section</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{section?.layout?.desktopSpan === "half" ? "1/2" : "plein"}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{columnCount} col{columnCount > 1 ? "s" : ""}</span>
                        {conditionCount > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200">{conditionCount} cond.</span> : null}
                        {hasProgressiveReveal ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">workflow</span> : null}
                        {isWorkflowStart ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700 ring-1 ring-teal-200">workflow start</span> : null}
                        {isWorkflowStep ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700 ring-1 ring-cyan-200">workflow step</span> : null}
                      </div>
                    </button>
                    {isWorkflowStep ? <p className="px-3 text-[10px] text-cyan-500">↑ debloquee par la section precedente</p> : null}
                    {index === formSections.length - 1 ? (
                      <DropZone
                        compact
                        active={sectionDropTarget?.beforeSectionId === null}
                        onDragOver={(event) => {
                          if (!draggedSectionId) return;
                          event.preventDefault();
                          setSectionDropTarget({ beforeSectionId: null });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleSectionDrop(null);
                        }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
              {buckets.find((bucket) => bucket.id === UNSECTIONED_BUCKET_ID) ? (
                <button
                  type="button"
                  onClick={() => setSelectedSectionId(UNSECTIONED_BUCKET_ID)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${selectedSectionId === UNSECTIONED_BUCKET_ID ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">Hors section</p>
                      <p className="mt-1 text-xs text-slate-500">{buckets.find((bucket) => bucket.id === UNSECTIONED_BUCKET_ID)?.fields.length ?? 0} champ{(buckets.find((bucket) => bucket.id === UNSECTIONED_BUCKET_ID)?.fields.length ?? 0) > 1 ? "s" : ""}</p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">hors sec.</span>
                  </div>
                </button>
              ) : null}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto bg-[#f6f7fb] p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Studio</p>
                <p className="mt-1 text-sm text-slate-500">
                  {viewMode === "organize"
                    ? "Glisse les variables précisément avec des zones de drop avant chaque carte ou en fin de colonne."
                    : "Aperçu direct du formulaire avec les mêmes règles de visibilité et de layout que la page de génération."}
                </p>
              </div>
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewMode("organize")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "organize" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Organisation
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("preview")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "preview" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Aperçu
                </button>
              </div>
            </div>

            {viewMode === "organize" ? (
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                {buckets.map((bucket) => {
                  const spanClass = bucket.section?.layout?.desktopSpan === "half" ? "2xl:col-span-1" : "2xl:col-span-2";
                  const isWorkflowStart = workflowStartSectionId === bucket.section?.id;
                  const isWorkflowStep = bucket.section ? workflowSectionIds.includes(bucket.section.id) && !isWorkflowStart : false;
                  return (
                    <section
                      key={bucket.id}
                      onClick={() => setSelectedSectionId(bucket.id)}
                      className={`rounded-[26px] border p-4 shadow-sm transition-colors ${spanClass} ${selectedBucket?.id === bucket.id ? "border-indigo-300 bg-white" : "border-slate-200 bg-white/90"}`}
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-base font-semibold text-slate-900">{bucket.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{bucket.fields.length}</span>
                            {(bucket.section?.conditions?.length ?? 0) > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">conditionnelle</span> : null}
                            {bucket.section?.revealWhenPreviousComplete ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">workflow</span> : null}
                            {isWorkflowStart ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700">workflow start</span> : null}
                            {isWorkflowStep ? <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">workflow step</span> : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-500">{bucket.description || (bucket.isUnsectioned ? "Champs laissés hors section." : "Section personnalisée du formulaire.")}</p>
                        </div>
                        {!bucket.isUnsectioned ? (
                          <div className="flex flex-wrap justify-end gap-1.5 text-[10px] text-slate-500">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{bucket.section?.layout?.desktopSpan === "half" ? "1/2 largeur" : "pleine largeur"}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{bucket.section?.layout?.fieldColumns ?? 2} colonne{(bucket.section?.layout?.fieldColumns ?? 2) > 1 ? "s" : ""}</span>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-4 min-h-20">
                        {bucket.fields.length === 0 ? (
                          <DropZone
                            active={dropTarget?.bucketId === bucket.id && dropTarget.beforeFieldKey === null}
                            label="Dépose une variable ici"
                            onDragOver={(event) => {
                              if (!draggedFieldKey) return;
                              event.preventDefault();
                              setDropTarget({ bucketId: bucket.id, beforeFieldKey: null });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDrop(bucket.id, null);
                            }}
                          />
                        ) : (
                          <div className="space-y-2">
                            {!bucket.isUnsectioned && bucket.section ? (() => {
                              const section = bucket.section;
                              return (
                              <SectionMiniGridPreview
                                section={section}
                                fields={bucket.fields.map(({ field }) => field)}
                                draggedFieldKey={draggedFieldKey}
                                dropTarget={gridDropTarget}
                                onRowCountChange={(nextRowCount) => updateSectionRowCount(section.id, nextRowCount)}
                                onAutoFlowDragOver={(event) => {
                                  if (!draggedFieldKey) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setGridDropTarget({ sectionId: section.id, kind: "auto" });
                                  setDropTarget(null);
                                }}
                                onAutoFlowDrop={(event) => {
                                  if (!draggedFieldKey) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  placeFieldInSection(draggedFieldKey, section.id, { column: null, row: null });
                                  setDraggedFieldKey(null);
                                  setGridDropTarget(null);
                                }}
                                onCellDragOver={(column, row, event) => {
                                  if (!draggedFieldKey) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setGridDropTarget({ sectionId: section.id, kind: "cell", column, row });
                                  setDropTarget(null);
                                }}
                                onCellDrop={(column, row, event) => {
                                  if (!draggedFieldKey) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  placeFieldInSection(draggedFieldKey, section.id, { column, row });
                                  setDraggedFieldKey(null);
                                  setGridDropTarget(null);
                                }}
                                onFieldDragStart={(fieldKey) => {
                                  setDraggedFieldKey(fieldKey);
                                  setDropTarget(null);
                                }}
                                onFieldDragEnd={() => {
                                  setDraggedFieldKey(null);
                                  setGridDropTarget(null);
                                }}
                              />
                              );
                            })() : null}
                            <DropZone
                              active={dropTarget?.bucketId === bucket.id && dropTarget.beforeFieldKey === bucket.fields[0]?.field.key}
                              compact
                              onDragOver={(event) => {
                                if (!draggedFieldKey || !bucket.fields[0]) return;
                                event.preventDefault();
                                setDropTarget({ bucketId: bucket.id, beforeFieldKey: bucket.fields[0].field.key });
                              }}
                              onDrop={(event) => {
                                if (!bucket.fields[0]) return;
                                event.preventDefault();
                                handleDrop(bucket.id, bucket.fields[0].field.key);
                              }}
                            />
                            {bucket.fields.map(({ field }, index) => {
                              const nextFieldKey = bucket.fields[index + 1]?.field.key ?? null;
                              return (
                                <Fragment key={field.key}>
                                  <div
                                    draggable
                                    onDragStart={() => setDraggedFieldKey(field.key)}
                                    onDragEnd={() => {
                                      setDraggedFieldKey(null);
                                      setDropTarget(null);
                                      setGridDropTarget(null);
                                    }}
                                    className={`flex cursor-grab items-start gap-3 rounded-2xl border px-3 py-3 active:cursor-grabbing ${draggedFieldKey === field.key ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
                                  >
                                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="truncate text-sm font-medium text-slate-800">{field.label || field.key}</p>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                                          {SCHEMA_FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type}
                                        </span>
                                        {field.required ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200">requis</span> : null}
                                        {field.showIf ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 ring-1 ring-blue-200">condition</span> : null}
                                      </div>
                                      <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{field.key}</p>
                                      {field.description ? <p className="mt-1 text-xs text-slate-500">{field.description}</p> : null}
                                      {!bucket.isUnsectioned && bucket.section ? (
                                        <div className="mt-2 space-y-2">
                                          <div className="text-[10px] text-slate-400">Plan actif: {bucket.section?.layout?.fieldColumns ?? 2} colonne{(bucket.section?.layout?.fieldColumns ?? 2) > 1 ? "s" : ""} · {bucket.section?.layout?.rowCount ?? 3} ligne{(bucket.section?.layout?.rowCount ?? 3) > 1 ? "s" : ""}</div>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-[10px] text-slate-400">Colonne</span>
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              updateFieldColumn(field.key, undefined);
                                            }}
                                            className={`rounded-full px-2 py-1 text-[10px] transition-colors ${!field.sectionLayout?.column ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                                          >
                                            Auto
                                          </button>
                                          {Array.from({ length: bucket.section?.layout?.fieldColumns ?? 2 }, (_, columnIndex) => {
                                            const column = (columnIndex + 1) as TemplateSectionColumnCount;
                                            return (
                                              <button
                                                key={`${field.key}-column-${column}`}
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  updateFieldColumn(field.key, column);
                                                }}
                                                className={`rounded-full px-2 py-1 text-[10px] transition-colors ${field.sectionLayout?.column === column ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                                              >
                                                C{column}
                                              </button>
                                            );
                                          })}
                                          </div>
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-[10px] text-slate-400">Ligne</span>
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                updateFieldRow(field.key, undefined);
                                              }}
                                              className={`rounded-full px-2 py-1 text-[10px] transition-colors ${!field.sectionLayout?.row ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                                            >
                                              Auto
                                            </button>
                                            {Array.from({ length: bucket.section?.layout?.rowCount ?? 3 }, (_, rowIndex) => {
                                              const row = rowIndex + 1;
                                              return (
                                                <button
                                                  key={`${field.key}-row-${row}`}
                                                  type="button"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    updateFieldRow(field.key, row);
                                                  }}
                                                  className={`rounded-full px-2 py-1 text-[10px] transition-colors ${field.sectionLayout?.row === row ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                                                >
                                                  L{row}
                                                </button>
                                              );
                                            })}
                                            <label className="ml-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                                              <span>+</span>
                                              <input
                                                type="number"
                                                min={1}
                                                max={bucket.section?.layout?.rowCount ?? 3}
                                                value={field.sectionLayout?.row ?? ""}
                                                placeholder={String(bucket.section?.layout?.rowCount ?? 3)}
                                                onClick={(event) => event.stopPropagation()}
                                                onChange={(event) => {
                                                  const nextValue = event.target.value;
                                                  const rowLimit = bucket.section?.layout?.rowCount ?? 3;
                                                  updateFieldRow(field.key, nextValue ? Math.min(Number(nextValue), rowLimit) : undefined);
                                                }}
                                                className="w-10 border-0 bg-transparent p-0 text-[10px] text-slate-700 outline-none"
                                              />
                                            </label>
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <DropZone
                                    active={dropTarget?.bucketId === bucket.id && dropTarget.beforeFieldKey === nextFieldKey}
                                    compact
                                    onDragOver={(event) => {
                                      if (!draggedFieldKey) return;
                                      event.preventDefault();
                                      setDropTarget({ bucketId: bucket.id, beforeFieldKey: nextFieldKey });
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      handleDrop(bucket.id, nextFieldKey);
                                    }}
                                  />
                                </Fragment>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Simulation</p>
                      <p className="mt-1 text-sm text-slate-500">Fais varier les champs pilotes pour tester les sections conditionnelles et les champs déjà conditionnels.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                        <button
                          type="button"
                          onClick={() => setPreviewViewport("mobile")}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${previewViewport === "mobile" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                        >
                          <Smartphone className="h-3.5 w-3.5" />
                          Mobile
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewViewport("tablet")}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${previewViewport === "tablet" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                        >
                          <Tablet className="h-3.5 w-3.5" />
                          Tablette
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewViewport("desktop")}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${previewViewport === "desktop" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                        >
                          <Monitor className="h-3.5 w-3.5" />
                          Desktop
                        </button>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                        {hiddenExplicitSections} section{hiddenExplicitSections > 1 ? "s" : ""} masquée{hiddenExplicitSections > 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  {previewConditionFields.length === 0 ? (
                    <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Aucun champ n'est actuellement utilisé comme pilote de condition.</p>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {previewConditionFields.map((field) => (
                        <PreviewControl
                          key={field.key}
                          field={field}
                          value={previewValues[field.key]}
                          onChange={(value) => setPreviewValues((current) => ({ ...current, [field.key]: value }))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className={getPreviewShellClass(previewViewport)}>
                  <div className={getPreviewSectionsWrapperClass(previewViewport)}>
                  {previewSections.length === 0 ? (
                    <div className="rounded-[26px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 col-span-1 2xl:col-span-2">
                      Aucun bloc de formulaire visible avec les valeurs de simulation actuelles.
                    </div>
                  ) : previewSections.map((section) => (
                    <section
                      key={section.id}
                      className={`rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm ${getPreviewSectionSpanClass(section, previewViewport)}`}
                    >
                      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 md:flex-row md:items-end md:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Section</p>
                          <h3 className="mt-1 text-lg font-semibold text-slate-900">{section.title}</h3>
                          {section.description ? <p className="mt-2 text-sm text-slate-500">{section.description}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{section.fieldColumns} colonne{section.fieldColumns > 1 ? "s" : ""}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{section.desktopSpan === "half" ? "1/2 largeur" : "pleine largeur"}</span>
                        </div>
                      </div>

                      <div className={`mt-4 ${getPreviewSectionGridClass(section, previewViewport)}`}>
                        {getSectionFieldsInVisualOrder(section.fields, section.fieldColumns).map((field) => (
                          <div
                            key={field.key}
                            className={getPreviewFieldSpanClass(field, section, previewViewport)}
                            style={getFieldStaticPlacementStyle(
                              field,
                              previewViewport === "desktop" ? section.fieldColumns : previewViewport === "tablet" ? Math.min(section.fieldColumns, 2) : 1,
                              previewViewport !== "mobile"
                            )}
                          >
                            <PreviewFieldCard field={field} value={previewValues[field.key]} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                  </div>
                </div>
              </div>
            )}
          </main>

          <aside className="min-h-0 overflow-y-auto bg-white p-4">
            {!selectedSection ? (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-800">
                  <LayoutPanelTop className="h-4 w-4 text-slate-400" />
                  <p className="text-sm font-semibold">Hors section</p>
                </div>
                <p className="mt-2 text-sm text-slate-500">Les champs ici ne sont rattachés à aucune section dédiée. Ils restent affichés dans un bloc standard, dans l’ordre du schéma.</p>
                <p className="mt-4 text-xs text-slate-400">Crée une section puis glisse les champs dedans si tu veux reprendre la main sur l’ordre, la largeur et les conditions.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Inspecteur</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">{selectedSection.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">Réglages de rendu et d’affichage pour la section sélectionnée.</p>
                </div>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Titre</span>
                    <input
                      type="text"
                      value={selectedSection.title}
                      onChange={(event) => updateSection(selectedSection.id, { title: event.target.value })}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Description</span>
                    <textarea
                      rows={3}
                      value={selectedSection.description ?? ""}
                      onChange={(event) => updateSection(selectedSection.id, { description: event.target.value || undefined })}
                      className="resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                      placeholder="Texte d’aide affiché sous le titre de section"
                    />
                  </label>
                </div>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-500">Layout</p>
                  <p className="text-xs text-slate-500">
                    `Pleine largeur` / `Demi largeur` place les sections entre elles. `Colonnes internes` répartit automatiquement les champs a l'intérieur de cette section.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateSection(selectedSection.id, { layout: { ...selectedSection.layout, desktopSpan: "full" } })}
                      className={`rounded-2xl border px-3 py-3 text-left ${selectedSection.layout?.desktopSpan !== "half" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                    >
                      <SquareSplitHorizontal className="h-4 w-4" />
                      <p className="mt-2 text-sm font-semibold">Pleine largeur</p>
                      <p className="mt-1 text-xs">Section mise en avant sur toute la ligne.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSection(selectedSection.id, { layout: { ...selectedSection.layout, desktopSpan: "half" } })}
                      className={`rounded-2xl border px-3 py-3 text-left ${selectedSection.layout?.desktopSpan === "half" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                    >
                      <LayoutPanelTop className="h-4 w-4" />
                      <p className="mt-2 text-sm font-semibold">Demi largeur</p>
                      <p className="mt-1 text-xs">Permet de mettre deux sections côte à côte.</p>
                    </button>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Colonnes internes</span>
                    <select
                      value={selectedSection.layout?.fieldColumns ?? 2}
                      onChange={(event) => updateSection(selectedSection.id, {
                        layout: {
                          ...selectedSection.layout,
                          fieldColumns: Number(event.target.value) as TemplateSectionColumnCount,
                        },
                      })}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                    >
                      {[1, 2, 3, 4, 5].map((count) => (
                        <option key={count} value={count}>{count} colonne{count > 1 ? "s" : ""}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Lignes du plan</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateSectionRowCount(selectedSection.id, (selectedSection.layout?.rowCount ?? 3) - 1)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:border-slate-300"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={MAX_SECTION_LAYOUT_ROWS}
                        value={selectedSection.layout?.rowCount ?? 3}
                        onChange={(event) => updateSectionRowCount(selectedSection.id, Number(event.target.value) || 1)}
                        className="h-10 w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                      />
                      <button
                        type="button"
                        onClick={() => updateSectionRowCount(selectedSection.id, (selectedSection.layout?.rowCount ?? 3) + 1)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:border-slate-300"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <p className="text-[11px] text-slate-400">Ajoute ou retire des lignes visibles dans la mini-grille.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetSectionFieldPlacement(selectedSection.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                    Reinitialiser le plan
                  </button>
                  <p className="text-[11px] text-slate-400">
                    Au-dessus de 2 colonnes, l'effet se voit surtout en aperçu `Desktop`. En `Mobile`, les champs restent empilés, et en `Tablette` ils montent au maximum a 2 colonnes.
                  </p>
                </div>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">Affichage conditionnel</p>
                    <button
                      type="button"
                      onClick={addCondition}
                      disabled={conditionFields.length === 0}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 transition-colors hover:border-slate-300 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Condition
                    </button>
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedSection.revealWhenPreviousComplete)}
                      onChange={(event) => updateSection(selectedSection.id, {
                        revealWhenPreviousComplete: event.target.checked ? true : undefined,
                        revealCompletionMode: event.target.checked
                          ? (selectedSection.revealCompletionMode ?? "all")
                          : undefined,
                      })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">Debloquer apres la section precedente</p>
                      <p className="mt-1 text-xs text-slate-500">La section s'affiche seulement quand la section visible juste avant est completement remplie. Si tu actives ca sur la premiere section, elle lance un workflow progressif pour les sections suivantes.</p>
                    </div>
                  </label>

                  {selectedSection.revealWhenPreviousComplete ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-500">Progression</span>
                      <select
                        value={selectedSection.revealCompletionMode ?? "all"}
                        onChange={(event) => updateSection(selectedSection.id, {
                          revealCompletionMode: event.target.value === "required" ? "required" : undefined,
                        })}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                      >
                        <option value="all">Debloquer quand tous les champs precedents sont remplis</option>
                        <option value="required">Debloquer quand les champs requis precedents sont remplis</option>
                      </select>
                    </label>
                  ) : null}

                  {workflowPreviewLabel ? (
                    <div className="rounded-2xl border border-dashed border-cyan-200 bg-cyan-50 px-3 py-2">
                      <p className="text-[11px] font-medium text-cyan-800">Flux progressif</p>
                      <p className="mt-1 text-xs text-cyan-700">{workflowPreviewLabel}</p>
                    </div>
                  ) : null}

                  {selectedConditions.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Toujours afficher. Active le workflow progressif ou ajoute une ou plusieurs conditions pour masquer la section tant que toutes ne sont pas remplies.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedConditions.map((condition, index) => {
                        const sourceField = schema.find((field) => field.key === condition.field);
                        const sourceOptions = getConditionValueOptions(sourceField);
                        return (
                          <div key={`${condition.field}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="grid grid-cols-1 gap-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-[11px] text-slate-500">Variable pilote</span>
                                <select
                                  value={condition.field}
                                  onChange={(event) => {
                                    const nextFieldKey = event.target.value;
                                    const nextField = schema.find((field) => field.key === nextFieldKey);
                                    const nextValue = getConditionValueOptions(nextField)[0]?.value ?? "";
                                    updateCondition(index, { field: nextFieldKey, equals: nextValue });
                                  }}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                                >
                                  {conditionFields.map((field) => (
                                    <option key={field.key} value={field.key}>{field.label || field.key}</option>
                                  ))}
                                </select>
                              </label>

                              <div className="flex items-end gap-2">
                                <label className="flex min-w-0 flex-1 flex-col gap-1">
                                  <span className="text-[11px] text-slate-500">Valeur attendue</span>
                                  <select
                                    value={condition.equals}
                                    onChange={(event) => updateCondition(index, { equals: event.target.value })}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
                                  >
                                    {sourceOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeCondition(index)}
                                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 transition-colors hover:bg-red-50"
                                  title="Supprimer cette condition"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Toutes les conditions doivent être vraies pour afficher la section. Si le workflow est actif, la section visible juste avant doit aussi être completement remplie. Active-le sur la premiere section si tu veux enchainer les suivantes progressivement.</p>
                </div>

                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-slate-500">Ordre</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => moveSection(selectedSection.id, -1)}
                      disabled={formSections.findIndex((section) => section.id === selectedSection.id) === 0}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-slate-300 disabled:opacity-40"
                    >
                      <ArrowUp className="h-4 w-4" />
                      Monter
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(selectedSection.id, 1)}
                      disabled={formSections.findIndex((section) => section.id === selectedSection.id) === formSections.length - 1}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-slate-300 disabled:opacity-40"
                    >
                      <ArrowDown className="h-4 w-4" />
                      Descendre
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSection(selectedSection.id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer la section
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function SectionMiniGridPreview({
  section,
  fields,
  draggedFieldKey,
  dropTarget,
  onRowCountChange,
  onAutoFlowDragOver,
  onAutoFlowDrop,
  onCellDragOver,
  onCellDrop,
  onFieldDragStart,
  onFieldDragEnd,
}: {
  section: TemplateFormSection;
  fields: SchemaField[];
  draggedFieldKey: string | null;
  dropTarget: GridDropTarget | null;
  onRowCountChange: (nextRowCount: number) => void;
  onAutoFlowDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onAutoFlowDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onCellDragOver: (column: TemplateSectionColumnCount, row: number, event: React.DragEvent<HTMLDivElement>) => void;
  onCellDrop: (column: TemplateSectionColumnCount, row: number, event: React.DragEvent<HTMLDivElement>) => void;
  onFieldDragStart: (fieldKey: string) => void;
  onFieldDragEnd: () => void;
}) {
  const columnCount = section.layout?.fieldColumns ?? 2;

  const autoFields = fields.filter((field) => !field.sectionLayout?.column && !field.sectionLayout?.row);
  const manualFields = fields.filter((field) => field.sectionLayout?.column || field.sectionLayout?.row);
  const maxManualRow = manualFields.reduce((max, field) => Math.max(max, field.sectionLayout?.row ?? 1), 1);
  const autoRowEstimate = Math.max(1, Math.ceil(Math.max(autoFields.length, 1) / columnCount));
  const rowCount = Math.max(
    1,
    Math.min(
      MAX_SECTION_LAYOUT_ROWS,
      section.layout?.rowCount ?? Math.max(3, Math.max(maxManualRow + autoRowEstimate, maxManualRow + 1))
    )
  );
  const manualColumns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const column = (columnIndex + 1) as TemplateSectionColumnCount;
    return {
      column,
      rows: Array.from({ length: rowCount }, (_, rowIndex) => {
        const row = rowIndex + 1;
        return {
          row,
          fields: fields.filter((field) => {
            const effectiveColumn = field.sectionLayout?.column ?? 1;
            const effectiveRow = field.sectionLayout?.row ?? 1;
            const hasManualPlacement = field.sectionLayout?.column || field.sectionLayout?.row;
            return Boolean(hasManualPlacement) && effectiveColumn === column && effectiveRow === row;
          }),
        };
      }),
    };
  });

  return (
    <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Plan</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{columnCount} colonne{columnCount > 1 ? "s" : ""} · {rowCount} ligne{rowCount > 1 ? "s" : ""}</span>
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => onRowCountChange(Math.max(1, rowCount - 1))}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onRowCountChange(Math.min(MAX_SECTION_LAYOUT_ROWS, rowCount + 1))}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <div
        className={`mt-2 rounded-xl border border-dashed p-2 transition-colors ${dropTarget?.sectionId === section.id && dropTarget.kind === "auto" ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white/70"}`}
        onDragOver={onAutoFlowDragOver}
        onDrop={onAutoFlowDrop}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-slate-400">Auto flow</p>
          <span className="text-[9px] uppercase tracking-wide text-slate-300">déposer ici pour repasser en auto</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {autoFields.length > 0 ? autoFields.map((field) => (
            <button
              key={field.key}
              type="button"
              draggable
              onDragStart={() => onFieldDragStart(field.key)}
              onDragEnd={onFieldDragEnd}
              className={`rounded-full border bg-white px-2 py-1 text-[10px] transition-colors ${draggedFieldKey === field.key ? "border-indigo-300 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
            >
              {field.label || field.key}
            </button>
          )) : <div className="text-[10px] text-slate-300">aucun champ en auto</div>}
        </div>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
        {manualColumns.map((item) => (
          <div key={`plan-column-${item.column}`} className="rounded-xl border border-dashed border-slate-300 bg-white p-2">
            <p className="text-[10px] font-semibold text-slate-400">Col {item.column}</p>
            <div className="mt-2 space-y-1.5">
              {item.rows.map((row) => (
                <div
                  key={`plan-column-${item.column}-row-${row.row}`}
                  onDragOver={(event) => onCellDragOver(item.column, row.row, event)}
                  onDrop={(event) => onCellDrop(item.column, row.row, event)}
                  className={`rounded-lg border px-2 py-1.5 transition-colors ${dropTarget?.sectionId === section.id && dropTarget.kind === "cell" && dropTarget.column === item.column && dropTarget.row === row.row ? "border-indigo-300 bg-indigo-50" : "border-slate-100 bg-slate-50"}`}
                >
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-300">L{row.row}</p>
                  <div className="mt-1 space-y-1">
                    {row.fields.length > 0 ? row.fields.map((field) => (
                      <button
                        key={field.key}
                        type="button"
                        draggable
                        onDragStart={() => onFieldDragStart(field.key)}
                        onDragEnd={onFieldDragEnd}
                        className={`block w-full rounded-md px-2 py-1 text-left text-[10px] transition-colors ${draggedFieldKey === field.key ? "bg-indigo-100 text-indigo-800" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"}`}
                      >
                        {field.label || field.key}
                      </button>
                    )) : <div className="text-[10px] text-slate-300">vide</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DropZone({
  active,
  compact,
  label,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  compact?: boolean;
  label?: string;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${compact ? "h-3" : "rounded-2xl border border-dashed px-4 py-6 text-center text-sm"} transition-colors ${active ? "border-indigo-300 bg-indigo-50 text-indigo-600" : compact ? "border-transparent bg-transparent" : "border-slate-200 bg-slate-50 text-slate-400"}`}
    >
      {compact ? <div className={`mx-auto h-1.5 rounded-full ${active ? "w-full bg-indigo-400" : "w-16 bg-slate-200"}`} /> : label}
    </div>
  );
}

function PreviewControl({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (value: string | boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-800">{field.label || field.key}</p>
      <p className="mt-1 text-[11px] font-mono text-slate-400">{field.key}</p>
      {field.type === "boolean" ? (
        <div className="mt-3 inline-flex rounded-full border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => onChange(true)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === true ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            Oui
          </button>
          <button
            type="button"
            onClick={() => onChange(false)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === false ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            Non
          </button>
        </div>
      ) : (
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300"
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function PreviewFieldCard({
  field,
  value,
}: {
  field: SchemaField;
  value: unknown;
}) {
  const previewValue = field.type === "boolean"
    ? (value ? "Oui" : "Non")
    : field.type === "select"
      ? String(value ?? field.options?.[0] ?? "")
      : String(value ?? field.placeholder ?? "");
  const helperText = field.description ?? "";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-slate-800">{field.label || field.key}</p>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {SCHEMA_FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type}
        </span>
        {field.showIf ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 ring-1 ring-blue-200">champ conditionnel</span> : null}
      </div>
      {(field.type === "image" || field.type === "video") ? (
        <div className="mt-3 flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-400">
          {field.type === "image" ? "Aperçu image" : "Aperçu vidéo"}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          {previewValue || "—"}
        </div>
      )}
      <div className="mt-2 min-h-[20px]">
        {helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
      </div>
    </div>
  );
}
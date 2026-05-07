"use client";

import { useEffect, useRef, useState } from "react";
import {
  compileTextTemplate,
  extractTemplateVars,
  parseTextTemplate,
  resolveTextTemplate,
  type TextTemplateSegment,
} from "@/lib/textTemplate";
import { collectBuilderFonts, type BuilderFontEntry } from "@/lib/builderFonts";
import {
  buildSchemaPreviewData,
  getConditionSourceFields,
  getConditionValueOptions,
} from "@/lib/schemaFields";
import { getAutoLayoutMode, getAutoLayoutOrderedBlocks, getGroupBounds } from "@/lib/groupLayout";
import { getTextBackgroundBorderRadius, getTextBackgroundMode, getTextBackgroundPadding, getTextBackgroundSize, getTextContentPadding, isTextBackgroundEnabled, type BoxPadding } from "@/lib/textBackground";
import { useBuilderStore } from "@/lib/store/builderStore";
import type {
  AnyBlock, TextBlock, ImageBlock, VideoBlock, DPEBlock,
  ShapeBlock, ShapeKind, BlockStyle, SchemaField, BlockConditionalRule, LayerGroup, MusicBlock,
} from "@/types/template";
import type { ListingData } from "@/types/listing";

export function PropertiesPanel({
  globalFonts,
  showResolvedTextPreview,
  onShowResolvedTextPreviewChange,
}: {
  globalFonts: BuilderFontEntry[];
  showResolvedTextPreview: boolean;
  onShowResolvedTextPreviewChange: (value: boolean) => void;
}) {
  const { template, selectedBlockId, selectedGroupId, multiSelectedBlockIds, updateBlock, updateBlocks, updateGroup, moveGroupBlocks, setSchema } = useBuilderStore();
  const block = template.blocks.find((b) => b.id === selectedBlockId) ?? null;
  const group = template.groups.find((item) => item.id === selectedGroupId) ?? null;

  const [inlineSelectEditorKey, setInlineSelectEditorKey] = useState<string | null>(null);
  const [inlineSelectDrafts, setInlineSelectDrafts] = useState<Record<string, string>>({});
  const prevBindingRef = useRef<string>("");
  // Track old content on focus for schema cleanup on blur
  const prevContentRef = useRef<string>("");

  function updateSchemaField(fieldKey: string, changes: Partial<SchemaField>) {
    setSchema(template.schema.map((field) => (
      field.key === fieldKey ? { ...field, ...changes } : field
    )));
  }

  function openInlineSelectEditor(field: SchemaField) {
    if (field.type !== "select") return;
    setInlineSelectEditorKey(field.key);
    setInlineSelectDrafts((current) => ({
      ...current,
      [field.key]: current[field.key] ?? field.options?.join("\n") ?? "",
    }));
  }

  function closeInlineSelectEditor() {
    setInlineSelectEditorKey(null);
  }

  function saveInlineSelectOptions(fieldKey: string) {
    const draft = inlineSelectDrafts[fieldKey] ?? "";
    const options = draft.split("\n").map((value) => value.trim()).filter(Boolean);
    updateSchemaField(fieldKey, { options });
    closeInlineSelectEditor();
  }

  function syncTextSchema(oldContent: string, newContent: string) {
    const oldVars = extractTemplateVars(oldContent);
    const newVars = extractTemplateVars(newContent);
    let nextSchema = [...template.schema];

    for (const key of oldVars) {
      if (!newVars.includes(key)) {
        const usedElsewhere = template.blocks.some((b) => {
          if (b.id === block?.id) return false;
          if (b.binding === key) return true;
          return (b as TextBlock).content?.includes(`{{${key}}}`) ?? false;
        });
        if (!usedElsewhere) nextSchema = nextSchema.filter((f) => f.key !== key);
      }
    }

    for (const key of newVars) {
      if (!nextSchema.some((f) => f.key === key)) {
        nextSchema.push({ key, label: key.replace(/_/g, " "), type: "text", required: false });
      }
    }

    setSchema(nextSchema);
  }

  function buildAnchoredSizeChange(target: AnyBlock, field: "w" | "h", rawValue: number): Partial<AnyBlock> {
    const nextValue = Math.max(0, Number.isFinite(rawValue) ? rawValue : 0);
    if (field === "w") {
      const delta = nextValue - target.w;
      return {
        w: nextValue,
        x: Math.round(target.x - delta / 2),
      } as Partial<AnyBlock>;
    }
    const delta = nextValue - target.h;
    return {
      h: nextValue,
      y: Math.round(target.y - delta / 2),
    } as Partial<AnyBlock>;
  }

  if (!block && group) {
    const currentGroup = group;
    const groupId = group.id;
    const members = template.blocks.filter((item) => item.groupId === group.id);
    const memberCount = members.length;
    const groupBounds = getGroupBounds(members);
    const autoLayoutMode = getAutoLayoutMode(group);
    const isAutoLayout = autoLayoutMode !== null;
    const layoutWidth = group.layout?.width ?? groupBounds?.width ?? 0;
    const layoutHeight = group.layout?.height ?? groupBounds?.height ?? 0;
    const effectiveGroupWidth = isAutoLayout ? layoutWidth : (groupBounds?.width ?? 0);
    const effectiveGroupHeight = isAutoLayout ? layoutHeight : (groupBounds?.height ?? 0);
    const justifyLabel = autoLayoutMode === "column" ? "Alignement vertical" : "Alignement horizontal";
    const alignLabel = autoLayoutMode === "column" ? "Alignement horizontal" : "Alignement vertical";
    const layoutWidthLabel = autoLayoutMode === "column" ? "w colonne" : "w ligne";
    const layoutHeightLabel = autoLayoutMode === "column" ? "h colonne" : "h ligne";
    const orderedMembers = isAutoLayout ? getAutoLayoutOrderedBlocks(group, members) : members;

    function updateAutoLayout(changes: Partial<NonNullable<LayerGroup["layout"]>>) {
      if (!autoLayoutMode) return;
      updateGroup(currentGroup.id, { layout: { ...currentGroup.layout, mode: autoLayoutMode, ...changes } });
    }

    function buildAutoLayout(nextMode: "row" | "column") {
      const initialOrder = getAutoLayoutOrderedBlocks(
        { ...currentGroup, layout: { ...currentGroup.layout, mode: nextMode } },
        members,
      ).map((member) => member.id);
      return {
        mode: nextMode,
        width: Math.max(1, Math.round(currentGroup.layout?.width ?? groupBounds?.width ?? template.canvas.width)),
        height: Math.max(1, Math.round(currentGroup.layout?.height ?? groupBounds?.height ?? template.canvas.height)),
        gap: currentGroup.layout?.gap ?? 16,
        justify: currentGroup.layout?.justify ?? "center",
        align: currentGroup.layout?.align ?? "top",
        order: initialOrder,
        anchorBlockId: currentGroup.layout?.anchorBlockId,
      } as const;
    }

    function moveOrderedMember(blockId: string, direction: -1 | 1) {
      if (!autoLayoutMode) return;
      const order = orderedMembers.map((member) => member.id);
      const index = order.indexOf(blockId);
      if (index === -1) return;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= order.length) return;
      const nextOrder = [...order];
      const [moved] = nextOrder.splice(index, 1);
      nextOrder.splice(nextIndex, 0, moved);
      updateAutoLayout({ order: nextOrder });
    }

    function moveGroupTo(nextX?: number, nextY?: number) {
      if (!groupBounds) return;
      const deltaX = nextX === undefined ? 0 : nextX - groupBounds.minX;
      const deltaY = nextY === undefined ? 0 : nextY - groupBounds.minY;
      moveGroupBlocks(groupId, deltaX, deltaY);
    }

    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            groupe <span className="text-gray-300 font-normal">#{group.id.slice(-4)}</span>
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => updateGroup(group.id, { hidden: !group.hidden })}
              title={group.hidden ? "Afficher le groupe" : "Masquer le groupe à la génération"}
              className={`shrink-0 text-sm px-1.5 py-0.5 rounded border transition-colors ${
                group.hidden
                  ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                  : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
              }`}
            >
              👁
            </button>
            <button
              onClick={() => updateGroup(group.id, { locked: !group.locked })}
              title={group.locked ? "Déverrouiller le groupe" : "Verrouiller le groupe"}
              className={`shrink-0 text-sm px-1.5 py-0.5 rounded border transition-colors ${
                group.locked
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                  : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
              }`}
            >
              {group.locked ? "🔒" : "🔓"}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-5 text-xs">
          <Section label="Groupe">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">Nom</span>
              <input
                type="text"
                value={group.name}
                onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="flex items-center gap-2 rounded border border-gray-200 px-2 py-2">
                <input
                  type="checkbox"
                  checked={group.collapsed ?? false}
                  onChange={(e) => updateGroup(group.id, { collapsed: e.target.checked })}
                  className="rounded"
                />
                <span className="text-gray-600">Replié</span>
              </label>
              <div className="rounded border border-gray-200 px-2 py-2 text-gray-500">
                {memberCount} calque{memberCount > 1 ? "s" : ""}
              </div>
            </div>
          </Section>

          <Section label="Déplacement">
            {groupBounds ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">x</span>
                    <input
                      type="number"
                      value={groupBounds.minX}
                      onChange={(e) => moveGroupTo(Number(e.target.value), undefined)}
                      className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">y</span>
                    <input
                      type="number"
                      value={groupBounds.minY}
                      onChange={(e) => moveGroupTo(undefined, Number(e.target.value))}
                      className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">w</span>
                    <input
                      type="number"
                      value={effectiveGroupWidth}
                      readOnly
                      className="border border-gray-200 rounded px-2 py-1 bg-gray-50 text-gray-500"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">h</span>
                    <input
                      type="number"
                      value={effectiveGroupHeight}
                      readOnly
                      className="border border-gray-200 rounded px-2 py-1 bg-gray-50 text-gray-500"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex gap-1">
                    {([
                      { title: "Aligner à gauche", label: "⇤", fn: () => moveGroupTo(0, undefined) },
                      { title: "Centrer horizontalement", label: "↔", fn: () => moveGroupTo(Math.round((template.canvas.width - effectiveGroupWidth) / 2), undefined) },
                      { title: "Aligner à droite", label: "⇥", fn: () => moveGroupTo(template.canvas.width - effectiveGroupWidth, undefined) },
                    ] as const).map(({ title, label, fn }) => (
                      <button key={title} type="button" title={title} onClick={fn} className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {([
                      { title: "Aligner en haut", label: "⇡", fn: () => moveGroupTo(undefined, 0) },
                      { title: "Centrer verticalement", label: "↕", fn: () => moveGroupTo(undefined, Math.round((template.canvas.height - effectiveGroupHeight) / 2)) },
                      { title: "Aligner en bas", label: "⇣", fn: () => moveGroupTo(undefined, template.canvas.height - effectiveGroupHeight) },
                    ] as const).map(({ title, label, fn }) => (
                      <button key={title} type="button" title={title} onClick={fn} className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[11px] text-gray-500 leading-5 mt-2">
                  Vous pouvez aussi sélectionner le groupe dans la pile puis glisser n&apos;importe quel bloc membre sur le canvas pour déplacer tout le groupe.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-gray-500 leading-5">
                Ajoutez d&apos;abord des calques dans ce groupe pour le déplacer ensemble.
              </p>
            )}
          </Section>

          <Section label="Disposition">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  type="button"
                  onClick={() => updateGroup(group.id, { layout: undefined })}
                  className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    !isAutoLayout ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white"
                  }`}
                >
                  Libre
                </button>
                <button
                  type="button"
                  onClick={() => updateGroup(group.id, { layout: buildAutoLayout("row") })}
                  className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    autoLayoutMode === "row" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white"
                  }`}
                >
                  Ligne
                </button>
                <button
                  type="button"
                  onClick={() => updateGroup(group.id, { layout: buildAutoLayout("column") })}
                  className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    autoLayoutMode === "column" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white"
                  }`}
                >
                  Colonne
                </button>
              </div>

              {isAutoLayout ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-400 uppercase">{layoutWidthLabel}</span>
                      <input
                        type="number"
                        min={1}
                        value={layoutWidth}
                        onChange={(e) => updateAutoLayout({ width: Number(e.target.value) })}
                        className="border border-gray-200 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-400 uppercase">{layoutHeightLabel}</span>
                      <input
                        type="number"
                        min={1}
                        value={layoutHeight}
                        onChange={(e) => updateAutoLayout({ height: Number(e.target.value) })}
                        className="border border-gray-200 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 col-span-2">
                      <span className="text-gray-400 uppercase">écart</span>
                      <input
                        type="number"
                        min={0}
                        value={group.layout?.gap ?? 16}
                        onChange={(e) => updateAutoLayout({ gap: Number(e.target.value) })}
                        className="border border-gray-200 rounded px-2 py-1"
                      />
                    </label>
                  </div>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">{justifyLabel}</span>
                    <select
                      value={group.layout?.justify ?? "center"}
                      onChange={(e) => updateAutoLayout({ justify: e.target.value as "start" | "center" | "end" })}
                      className="border border-gray-200 rounded px-2 py-1"
                    >
                      <option value="start">{autoLayoutMode === "column" ? "Haut" : "Gauche"}</option>
                      <option value="center">Centre</option>
                      <option value="end">{autoLayoutMode === "column" ? "Bas" : "Droite"}</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">{alignLabel}</span>
                    <select
                      value={group.layout?.align ?? "top"}
                      onChange={(e) => updateAutoLayout({ align: e.target.value as "top" | "middle" | "bottom" })}
                      className="border border-gray-200 rounded px-2 py-1"
                    >
                      <option value="top">{autoLayoutMode === "column" ? "Gauche" : "Haut"}</option>
                      <option value="middle">Milieu</option>
                      <option value="bottom">{autoLayoutMode === "column" ? "Droite" : "Bas"}</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 uppercase">Bloc centré</span>
                    <select
                      value={group.layout?.anchorBlockId ?? ""}
                      onChange={(e) => updateAutoLayout({ anchorBlockId: e.target.value || undefined })}
                      className="border border-gray-200 rounded px-2 py-1"
                    >
                      <option value="">Centre du groupe</option>
                      {orderedMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name?.trim() || `${member.type}-${member.id.slice(-4)}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  {orderedMembers.length > 0 ? (
                    <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Ordre auto-layout</p>
                      {orderedMembers.map((member, index) => {
                        const isAnchor = group.layout?.anchorBlockId === member.id;
                        const label = member.name?.trim() || `${member.type}-${member.id.slice(-4)}`;
                        return (
                          <div key={member.id} className="flex items-center gap-1 rounded-md bg-white px-2 py-1.5 border border-gray-200">
                            <span className={`min-w-0 flex-1 truncate ${isAnchor ? "text-indigo-700 font-medium" : "text-gray-700"}`}>{label}</span>
                            <button
                              type="button"
                              onClick={() => moveOrderedMember(member.id, -1)}
                              disabled={index === 0}
                              className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed"
                              title="Monter dans l'ordre"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveOrderedMember(member.id, 1)}
                              disabled={index === orderedMembers.length - 1}
                              className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed"
                              title="Descendre dans l'ordre"
                            >
                              ↓
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <p className="text-[11px] text-gray-500 leading-5">
                    {autoLayoutMode === "column"
                      ? "En mode colonne, les blocs du groupe restent éditables, leur ordre peut etre forcé, et vous pouvez centrer exactement un bloc sur l'axe vertical."
                      : "En mode ligne, les blocs du groupe restent éditables, leur ordre peut etre forcé, et vous pouvez centrer exactement un bloc sur l'axe horizontal."}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-gray-500 leading-5">
                  Le groupe fonctionne comme aujourd&apos;hui : organisation, conditionnels et déplacement commun, sans relayout automatique.
                </p>
              )}
            </div>
          </Section>

          <GroupConditionalRulesSection
            group={group}
            schema={template.schema}
            onChange={(changes) => updateGroup(group.id, changes)}
          />
        </div>
      </aside>
    );
  }

  // Multi-selection panel (≥2 blocks, no single block or group selected)
  if (!block && !group && multiSelectedBlockIds.length >= 2) {
    const selectedBlocks = template.blocks.filter((b) => multiSelectedBlockIds.includes(b.id));
    const count = selectedBlocks.length;

    // Bounding box of current selection
    const minX = Math.min(...selectedBlocks.map((b) => b.x));
    const minY = Math.min(...selectedBlocks.map((b) => b.y));
    const maxX = Math.max(...selectedBlocks.map((b) => b.x + b.w));
    const maxY = Math.max(...selectedBlocks.map((b) => b.y + b.h));
    const bboxCenterX = (minX + maxX) / 2;
    const bboxCenterY = (minY + maxY) / 2;

    function applyAlign(changes: (b: AnyBlock) => Partial<AnyBlock>) {
      updateBlocks(selectedBlocks.map((b) => ({ id: b.id, changes: changes(b) })));
    }

    // Distribute evenly — requires ≥3 blocks
    function distributeH() {
      if (selectedBlocks.length < 3) return;
      const sorted = [...selectedBlocks].sort((a, b) => a.x - b.x);
      const totalW = sorted.reduce((s, b) => s + b.w, 0);
      const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w - sorted[0].x;
      const gap = (span - totalW) / (sorted.length - 1);
      let cursor = sorted[0].x + sorted[0].w;
      const updates = sorted.slice(1).map((b) => {
        const x = Math.round(cursor + gap);
        cursor = x + b.w;
        return { id: b.id, changes: { x } as Partial<AnyBlock> };
      });
      updateBlocks(updates);
    }

    function distributeV() {
      if (selectedBlocks.length < 3) return;
      const sorted = [...selectedBlocks].sort((a, b) => a.y - b.y);
      const totalH = sorted.reduce((s, b) => s + b.h, 0);
      const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h - sorted[0].y;
      const gap = (span - totalH) / (sorted.length - 1);
      let cursor = sorted[0].y + sorted[0].h;
      const updates = sorted.slice(1).map((b) => {
        const y = Math.round(cursor + gap);
        cursor = y + b.h;
        return { id: b.id, changes: { y } as Partial<AnyBlock> };
      });
      updateBlocks(updates);
    }

    const canDistribute = count >= 3;

    const alignActions: { title: string; label: string; fn: () => void }[] = [
      { title: "Aligner les bords gauches",        label: "⇤",  fn: () => applyAlign(() => ({ x: minX })) },
      { title: "Centrer horizontalement",           label: "↔",  fn: () => applyAlign((b) => ({ x: Math.round(bboxCenterX - b.w / 2) })) },
      { title: "Aligner les bords droits",          label: "⇥",  fn: () => applyAlign((b) => ({ x: maxX - b.w })) },
      { title: "Aligner les bords hauts",           label: "⇡",  fn: () => applyAlign(() => ({ y: minY })) },
      { title: "Centrer verticalement",             label: "↕",  fn: () => applyAlign((b) => ({ y: Math.round(bboxCenterY - b.h / 2) })) },
      { title: "Aligner les bords bas",             label: "⇣",  fn: () => applyAlign((b) => ({ y: maxY - b.h })) },
    ];

    const distributeActions: { title: string; label: string; fn: () => void; disabled: boolean }[] = [
      { title: canDistribute ? "Distribuer horizontalement" : "Nécessite ≥ 3 éléments", label: "⇹ H", fn: distributeH, disabled: !canDistribute },
      { title: canDistribute ? "Distribuer verticalement"   : "Nécessite ≥ 3 éléments", label: "⇹ V", fn: distributeV, disabled: !canDistribute },
    ];

    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Sélection multiple
          </p>
          <span className="text-xs text-gray-400">{count} éléments</span>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <Section label="Aligner">
            <div className="grid grid-cols-3 gap-1">
              {alignActions.map(({ title, label, fn }) => (
                <button
                  key={title}
                  type="button"
                  title={title}
                  onClick={fn}
                  className="py-2 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 leading-4 mt-1">
              Les bords gauche, centre, droite — puis haut, milieu, bas — par rapport à la sélection.
            </p>
          </Section>

          <Section label="Distribuer">
            <div className="grid grid-cols-2 gap-1">
              {distributeActions.map(({ title, label, fn, disabled }) => (
                <button
                  key={title}
                  type="button"
                  title={title}
                  onClick={fn}
                  disabled={disabled}
                  className="py-2 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 leading-4 mt-1">
              Espace égal entre les éléments (nécessite ≥ 3).
            </p>
          </Section>
        </div>
      </aside>
    );
  }

  if (!block) {
    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-800">Aucune sélection</p>
            <p className="text-xs text-gray-500 leading-5">
              Sélectionnez un bloc ou un groupe pour éditer ses propriétés. Vous pouvez aussi naviguer plus vite dans le canvas avec les raccourcis ci-dessous.
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Navigation</p>
            <div className="space-y-1.5 text-[11px] text-gray-600">
              <p><span className="font-medium text-gray-800">+</span> / <span className="font-medium text-gray-800">-</span> pour zoomer</p>
              <p><span className="font-medium text-gray-800">0</span> ou <span className="font-medium text-gray-800">F</span> pour recentrer et ajuster</p>
              <p><span className="font-medium text-gray-800">Cmd/Ctrl + molette</span> pour zoomer a la souris</p>
              <p><span className="font-medium text-gray-800">Shift + molette</span> pour le deplacement horizontal</p>
              <p><span className="font-medium text-gray-800">Fleches</span> pour scroller</p>
              <p><span className="font-medium text-gray-800">Espace + glisser</span> pour deplacer la vue</p>
            </div>
          </div>

        </div>
      </aside>
    );
  }

  if (block.type === "music") {
    const mb = block as MusicBlock;
    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            🎵 musique <span className="text-gray-300 font-normal">#{block.id.slice(-4)}</span>
          </p>
        </div>
        <div className="p-4 space-y-5 text-xs">
          <Section label="Calque">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">Nom</span>
              <input
                type="text"
                value={mb.name ?? ""}
                onChange={(e) => updateBlock(mb.id, { name: e.target.value } as Partial<AnyBlock>)}
                placeholder={`musique-${mb.id.slice(-4)}`}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
          </Section>

          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 flex items-start gap-2">
            <span className="shrink-0 text-indigo-400 mt-0.5">🎬</span>
            <p className="text-[10px] text-indigo-700 leading-relaxed">
              Source, volume, fondu et bibliothèque audio → onglet <strong>Vidéo & Musique</strong> (panneau gauche).
            </p>
          </div>

          <Section label="Variable (upload formulaire)">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 uppercase">Binding</span>
              <input
                type="text"
                value={mb.binding ?? ""}
                placeholder="ex: music"
                onChange={(e) => updateBlock(mb.id, { binding: e.target.value || undefined } as Partial<AnyBlock>)}
                onFocus={() => { prevBindingRef.current = mb.binding ?? ""; }}
                onBlur={(e) => {
                  const newKey = e.target.value.trim();
                  const oldKey = prevBindingRef.current.trim();
                  if (newKey === oldKey) return;
                  let nextSchema = [...template.schema];
                  if (oldKey) {
                    const stillUsed = template.blocks.some(
                      (b) => b.id !== mb.id && b.binding === oldKey
                    );
                    if (!stillUsed) nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                  }
                  if (newKey && !nextSchema.some((f) => f.key === newKey)) {
                    nextSchema.push({
                      key: newKey,
                      label: newKey.replace(/_/g, " "),
                      type: "audio",
                      required: false,
                      description: "Musique de fond (MP3 · WAV · AAC · M4A · OGG)",
                    });
                  }
                  setSchema(nextSchema);
                }}
                className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono"
              />
            </label>
            <p className="text-[10px] text-gray-400 mt-1">Nom de la variable qui contiendra le fichier audio.</p>
          </Section>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {block.type} <span className="text-gray-300 font-normal">#{block.id.slice(-4)}</span>
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => updateBlock(block.id, { hidden: !block.hidden } as Partial<AnyBlock>)}
            title={block.hidden ? "Afficher le bloc" : "Masquer le bloc à la génération"}
            className={`shrink-0 text-sm px-1.5 py-0.5 rounded border transition-colors ${
              block.hidden
                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
            }`}
          >
            👁
          </button>
          <button
            onClick={() => updateBlock(block.id, { locked: !block.locked } as Partial<AnyBlock>)}
            title={block.locked ? "Déverrouiller le bloc" : "Verrouiller le bloc"}
            className={`shrink-0 text-sm px-1.5 py-0.5 rounded border transition-colors ${
              block.locked
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
            }`}
          >
            {block.locked ? "🔒" : "🔓"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 text-xs">
        <Section label="Calque">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400 uppercase">Nom</span>
            <input
              type="text"
              value={block.name ?? ""}
              onChange={(e) => updateBlock(block.id, { name: e.target.value } as Partial<AnyBlock>)}
              placeholder={`${block.type}-${block.id.slice(-4)}`}
              className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <label className="flex flex-col gap-0.5 mt-2">
            <span className="text-gray-400 uppercase">Groupe</span>
            <select
              value={block.groupId ?? ""}
              onChange={(e) => updateBlock(block.id, { groupId: e.target.value || undefined } as Partial<AnyBlock>)}
              className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">Aucun groupe</option>
              {template.groups.map((groupOption) => (
                <option key={groupOption.id} value={groupOption.id}>{groupOption.name}</option>
              ))}
            </select>
          </label>
        </Section>

        {/* Position & taille */}
        <Section label="Position / Taille">
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y", "w", "h", "z"] as const).map((field) => (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-gray-400 uppercase">{field}</span>
                <input
                  type="number"
                  value={(block as unknown as Record<string, number>)[field]}
                  min={field === "w" || field === "h" ? 0 : undefined}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (field === "w" || field === "h") {
                      updateBlock(block.id, buildAnchoredSizeChange(block, field, value));
                      return;
                    }
                    updateBlock(block.id, { [field]: value } as Partial<AnyBlock>);
                  }}
                  className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </label>
            ))}
            {/* Rotation */}
            <label className="flex flex-col gap-0.5 col-span-2">
              <span className="text-gray-400 uppercase">Rotation (°)</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={block.rotation ?? 0}
                  onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={block.rotation ?? 0}
                  onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                  className="w-16 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </label>
          </div>
        </Section>

        {/* Timing vidéo — visible si le template a un bloc vidéo OU une séquence */}
        {((template.blocks.some((b) => b.type === "video") || (template.videoSequence?.length ?? 0) > 0)) && block.type !== "video" ? (
          <Section label="Timing vidéo">
            {/* Global fallback (non-sequence or per-slot not set) */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400 uppercase text-[10px]">Apparaît à (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="0"
                  value={block.appearAt ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateBlock(block.id, {
                      appearAt: raw === "" ? undefined : Math.max(0, Number(raw)),
                    } as Partial<AnyBlock>);
                  }}
                  className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400 uppercase text-[10px]">Disparaît à (s)</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="fin"
                  value={block.hideAt ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateBlock(block.id, {
                      hideAt: raw === "" ? undefined : Math.max(0, Number(raw)),
                    } as Partial<AnyBlock>);
                  }}
                  className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-sm"
                />
              </label>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Vide = valeur par défaut (0 s / fin de vidéo). Pas d&apos;effet sur les renders image.
            </p>

            {/* Per-slot overrides: renvoi vers la timeline */}
            {(template.videoSequence?.length ?? 0) > 0 && (
              <p className="text-[10px] text-indigo-500 mt-1">
                Pour ajuster par clip : sélectionnez ce bloc + un clip dans la timeline ci-dessous.
              </p>
            )}
          </Section>
        ) : null}

        <Section label="Aligner sur le canvas">
          <div className="flex flex-col gap-1.5">
            {/* Horizontal */}
            <div className="flex gap-1">
              {([
                { title: "Aligner à gauche",        label: "⇤",  fn: () => ({ x: 0 }) },
                { title: "Centrer horizontalement", label: "↔",  fn: () => ({ x: Math.round((template.canvas.width  - block.w) / 2) }) },
                { title: "Aligner à droite",        label: "⇥",  fn: () => ({ x: template.canvas.width  - block.w }) },
              ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
                <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                  className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                  {label}
                </button>
              ))}
            </div>
            {/* Vertical */}
            <div className="flex gap-1">
              {([
                { title: "Aligner en haut",        label: "⇡",  fn: () => ({ y: 0 }) },
                { title: "Centrer verticalement",  label: "↕",  fn: () => ({ y: Math.round((template.canvas.height - block.h) / 2) }) },
                { title: "Aligner en bas",         label: "⇣",  fn: () => ({ y: template.canvas.height - block.h }) },
              ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
                <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                  className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Content (text blocks) — template string with {{variable}} interpolation */}
        {block.type === "text" && (() => {
          const tb = block as TextBlock;
          const currentContent = tb.content
            ?? (tb.contentSegments ? compileTextTemplate(tb.contentSegments) : undefined)
            ?? (tb.binding ? `{{${tb.binding}}}` : tb.staticText ?? "");
          const currentSegments = tb.contentSegments ?? parseTextTemplate(currentContent);
          const schemaKeyListId = `schema-keys-${tb.id}`;
          const schemaFieldOptions = [...template.schema].sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
          const previewData = buildSchemaPreviewData(template.schema);
          const previewText = resolveTextTemplate(currentContent, previewData as ListingData, template.schema);

          function applySegments(nextSegments: TextTemplateSegment[]) {
            const nextContent = compileTextTemplate(nextSegments);
            updateBlock(tb.id, { content: nextContent, contentSegments: nextSegments } as never);
            syncTextSchema(currentContent, nextContent);
          }

          function updateSegment(index: number, nextSegment: TextTemplateSegment) {
            const nextSegments = [...currentSegments];
            nextSegments[index] = nextSegment;
            applySegments(nextSegments);
          }

          function removeSegment(index: number) {
            applySegments(currentSegments.filter((_, currentIndex) => currentIndex !== index));
          }

          function moveSegment(index: number, direction: -1 | 1) {
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= currentSegments.length) return;
            const nextSegments = [...currentSegments];
            const [segment] = nextSegments.splice(index, 1);
            nextSegments.splice(nextIndex, 0, segment);
            applySegments(nextSegments);
          }

          function addSegment(type: TextTemplateSegment["type"]) {
            const baseSegment: TextTemplateSegment =
              type === "text"
                ? { type: "text", value: "" }
                : type === "variable"
                  ? { type: "variable", key: "nouvelle_variable" }
                  : { type: "if", field: "", equals: "", thenContent: "", elseContent: "" };
            applySegments([...currentSegments, baseSegment]);
          }

          function renderFieldMeta(field: SchemaField | undefined, kind: "variable" | "condition", rawKey: string) {
            if (kind === "condition" && !rawKey.trim()) {
              return (
                <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-500">
                  Choisissez une variable existante pour definir la condition.
                </div>
              );
            }

            if (!field) {
              return (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                  <span className="font-medium">Champ non defini</span>
                  {rawKey ? `: ${rawKey}` : ""}. Ajoutez-le dans le schema ou corrigez la cle.
                </div>
              );
            }

            return (
              <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-600 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-gray-700">{field.key}</span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">{field.type}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${field.required ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-500"}`}>
                    {field.required ? "requis" : "optionnel"}
                  </span>
                  {kind === "condition" && field.showIf && (
                    <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
                      visible si {field.showIf.field} = {field.showIf.equals}
                    </span>
                  )}
                </div>
                <div className="text-gray-500">
                  {field.label || field.key}
                  {field.description ? ` · ${field.description}` : ""}
                </div>
                {field.type === "select" && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {(field.options ?? []).length > 0 ? (field.options ?? []).map((option) => (
                        <span key={option} className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                          {option}
                        </span>
                      )) : (
                        <span className="text-[10px] text-gray-400">Aucune option definie.</span>
                      )}
                    </div>
                    {kind === "condition" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => inlineSelectEditorKey === field.key ? closeInlineSelectEditor() : openInlineSelectEditor(field)}
                            className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            {inlineSelectEditorKey === field.key ? "Fermer l'edition" : "Modifier les options ici"}
                          </button>
                        </div>
                        {inlineSelectEditorKey === field.key && (
                          <div className="rounded-md border border-indigo-100 bg-indigo-50 p-2 space-y-2">
                            <textarea
                              rows={4}
                              value={inlineSelectDrafts[field.key] ?? field.options?.join("\n") ?? ""}
                              onChange={(e) => setInlineSelectDrafts((current) => ({
                                ...current,
                                [field.key]: e.target.value,
                              }))}
                              onKeyDown={(e) => e.stopPropagation()}
                              placeholder="Une option par ligne"
                              className="w-full resize-none rounded border border-indigo-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={closeInlineSelectEditor}
                                className="px-2 py-1 text-[10px] border border-gray-200 rounded hover:bg-white"
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={() => saveInlineSelectOptions(field.key)}
                                className="px-2 py-1 text-[10px] rounded bg-indigo-600 text-white hover:bg-indigo-700"
                              >
                                Enregistrer
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Section label="Contenu">
              <div className="space-y-2">
                {currentSegments.length === 0 && (
                  <div className="border border-dashed border-gray-200 rounded-lg px-3 py-3 text-[11px] text-gray-400">
                    Aucun segment. Ajoutez du texte, une variable ou une condition.
                  </div>
                )}
                {currentSegments.map((segment, index) => (
                  <div key={`${segment.type}-${index}`} className="border border-gray-200 rounded-lg p-2 space-y-2 bg-gray-50">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 min-w-16">
                        {segment.type === "text" ? "Texte" : segment.type === "variable" ? "Variable" : "Condition"}
                      </span>
                      <button type="button" onClick={() => moveSegment(index, -1)} disabled={index === 0} className="px-1.5 py-0.5 text-[10px] border rounded disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveSegment(index, 1)} disabled={index === currentSegments.length - 1} className="px-1.5 py-0.5 text-[10px] border rounded disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removeSegment(index)} className="ml-auto px-1.5 py-0.5 text-[10px] border border-red-200 text-red-500 rounded">Suppr.</button>
                    </div>

                    {segment.type === "text" && (
                      <textarea
                        rows={2}
                        value={segment.value}
                        onChange={(e) => updateSegment(index, { ...segment, value: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Texte libre"
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    )}

                    {segment.type === "variable" && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          list={schemaKeyListId}
                          value={segment.key}
                          onChange={(e) => updateSegment(index, { ...segment, key: e.target.value.replace(/\s+/g, "_") })}
                          placeholder="nom_variable"
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                        {renderFieldMeta(template.schema.find((field) => field.key === segment.key), "variable", segment.key)}
                      </div>
                    )}

                    {segment.type === "if" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={segment.field}
                            onChange={(e) => updateSegment(index, { ...segment, field: e.target.value })}
                            className="border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          >
                            <option value="">Choisir une variable</option>
                            {schemaFieldOptions.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label} ({field.key})
                              </option>
                            ))}
                            {segment.field && !schemaFieldOptions.some((field) => field.key === segment.field) ? (
                              <option value={segment.field}>{segment.field}</option>
                            ) : null}
                          </select>
                          <input
                            type="text"
                            value={segment.equals}
                            onChange={(e) => updateSegment(index, { ...segment, equals: e.target.value })}
                            placeholder="valeur attendue"
                            className="border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                        {(() => {
                          const conditionField = template.schema.find((field) => field.key === segment.field);
                          return (
                            <div className="space-y-2">
                              {renderFieldMeta(conditionField, "condition", segment.field)}
                              {conditionField?.type === "select" && (conditionField.options?.length ?? 0) > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {(conditionField.options ?? []).map((option) => {
                                    const isActive = segment.equals === option;
                                    return (
                                      <button
                                        key={option}
                                        type="button"
                                        onClick={() => updateSegment(index, { ...segment, equals: option })}
                                        className={`rounded-full px-2 py-0.5 text-[10px] border ${isActive ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                                      >
                                        {option}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-gray-400">Si vrai</span>
                          <textarea
                            rows={2}
                            value={segment.thenContent}
                            onChange={(e) => updateSegment(index, { ...segment, thenContent: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Contenu affiché si la condition est vraie"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-gray-400">Sinon</span>
                          <textarea
                            rows={2}
                            value={segment.elseContent ?? ""}
                            onChange={(e) => updateSegment(index, { ...segment, elseContent: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Contenu affiché sinon (optionnel)"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                <button type="button" onClick={() => addSegment("text")} className="px-2 py-1 text-[11px] border rounded hover:bg-gray-50">+ Texte</button>
                <button type="button" onClick={() => addSegment("variable")} className="px-2 py-1 text-[11px] border rounded hover:bg-gray-50">+ Variable</button>
                <button type="button" onClick={() => addSegment("if")} className="px-2 py-1 text-[11px] border rounded hover:bg-gray-50">+ Condition</button>
              </div>

              <datalist id={schemaKeyListId}>
                {template.schema.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </datalist>

              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-gray-500">Mode avancé</summary>
                <textarea
                  rows={4}
                  value={currentContent}
                  onChange={(e) => {
                    updateBlock(block.id, { content: e.target.value, contentSegments: parseTextTemplate(e.target.value) } as never);
                    syncTextSchema(currentContent, e.target.value);
                  }}
                  onFocus={() => { prevContentRef.current = currentContent; }}
                  onBlur={(e) => syncTextSchema(prevContentRef.current, e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={`Texte libre avec variables :\n{{prix}} € · Surface : {{surface}} m²\n\nConditionnel :\n{{#if is_copro == oui}} - Nbre lots : {{nbre_lots}}{{/if}}`}
                  className="mt-2 w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </details>

              <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                <code className="bg-gray-100 px-0.5 rounded">{`{{variable}}`}</code> pour insérer une valeur.{" "}
                <code className="bg-gray-100 px-0.5 rounded">{`{{#if champ == val}}...{{else}}...{{/if}}`}</code> pour un segment conditionnel.{" "}
                Les espaces, tirets et retours à la ligne sont conservés tels qu&apos;ils sont écrits.
              </p>

              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Aperçu</p>
                  <input
                    type="checkbox"
                    checked={showResolvedTextPreview}
                    onChange={(e) => onShowResolvedTextPreviewChange(e.target.checked)}
                    title="Afficher le texte d'aperçu dans le builder"
                    className="rounded"
                  />
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-700 font-sans">{previewText || "Aucun contenu affiché avec les valeurs actuelles."}</pre>
              </div>

              {extractTemplateVars(currentContent).map((key) => {
                const sf = template.schema.find((f) => f.key === key);
                if (!sf) return null;
                return (
                  <label key={key} className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sf.required}
                      onChange={(e) => setSchema(template.schema.map((f) =>
                        f.key === key ? { ...f, required: e.target.checked } : f
                      ))}
                      className="rounded"
                    />
                    <code className="text-[11px] text-indigo-700 bg-indigo-50 px-1 rounded">{`{{${key}}}`}</code>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                      sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                    }`}>{sf.required ? "*" : "opt"}</span>
                  </label>
                );
              })}
            </Section>
          );
        })()}

        {/* Binding — only for image / dpe / shape blocks */}
        {block.type !== "text" && (
          <Section label="Binding (variable)">
            <input
              type="text"
              value={block.binding ?? ""}
              onChange={(e) => updateBlock(block.id, { binding: e.target.value || undefined })}
              onFocus={() => { prevBindingRef.current = block.binding ?? ""; }}
              onBlur={(e) => {
                const newKey = e.target.value.trim();
                const oldKey = prevBindingRef.current.trim();

                // Nothing changed
                if (newKey === oldKey) return;

                let nextSchema = [...template.schema];

                // Remove the old key if no OTHER block still uses it
                if (oldKey) {
                  const stillUsed = template.blocks.some(
                    (b) => b.id !== block.id && b.binding === oldKey
                  );
                  if (!stillUsed) {
                    nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                  }
                }

                // Add new key if non-empty and not already in schema
                if (newKey && !nextSchema.some((f) => f.key === newKey)) {
                  const inferredType: SchemaField["type"] =
                    block.type === "image" ? "image" :
                    block.type === "video" ? "video" : "text";
                  nextSchema.push({
                    key: newKey,
                    label: newKey.replace(/_/g, " "),
                    type: inferredType,
                    required: false,
                  });
                }

                setSchema(nextSchema);
              }}
              placeholder="ex: price_eur"
              className="w-full border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            {/* Inline required toggle for this binding */}
            {block.binding && (() => {
              const sf = template.schema.find((f) => f.key === block.binding);
              if (!sf) return (
                <p className="text-[10px] text-indigo-600 mt-1">
                  Sauvegardez le champ pour l’ajouter au schéma.
                </p>
              );
              return (
                <label className="flex items-center gap-1.5 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sf.required}
                    onChange={(e) => {
                      const next = template.schema.map((f) =>
                        f.key === block.binding ? { ...f, required: e.target.checked } : f
                      );
                      setSchema(next);
                    }}
                    className="rounded"
                  />
                  <span className="text-gray-600 text-[11px]">Obligatoire dans le formulaire</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                    sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                  }`}>
                    {sf.required ? "*" : "optionnel"}
                  </span>
                </label>
              );
            })()}
          </Section>
        )}

        {/* Text specific */}
        {block.type === "text" && (
          <TextProps block={block as TextBlock} globalFonts={globalFonts} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Shape specific */}
        {block.type === "shape" && (
          <ShapeProps block={block as ShapeBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Image specific */}
        {block.type === "image" && (
          <ImageProps block={block as ImageBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Vidéo specific */}
        {block.type === "video" && (
          <VideoProps block={block as VideoBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* DPE specific */}
        {block.type === "dpe" && (
          <DPEProps block={block as DPEBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        <ConditionalRulesSection
          block={block}
          schema={template.schema}
          onChange={(c) => updateBlock(block.id, c as Partial<AnyBlock>)}
        />
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      {children}
    </div>
  );
}

function toUniformPaddingValue(values: BoxPadding): number {
  if (values.top === values.right && values.top === values.bottom && values.top === values.left) {
    return values.top;
  }

  return Math.round((values.top + values.right + values.bottom + values.left) / 4);
}

function BoxPaddingEditor({
  label,
  values,
  split,
  onToggleSplit,
  onChangeUniform,
  onChangeSide,
}: {
  label: string;
  values: BoxPadding;
  split: boolean;
  onToggleSplit: (nextSplit: boolean) => void;
  onChangeUniform: (value: number) => void;
  onChangeSide: (side: keyof BoxPadding, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400">{label}</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => onToggleSplit(false)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              !split ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Uniforme
          </button>
          <button
            type="button"
            onClick={() => onToggleSplit(true)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              split ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Côtés
          </button>
        </div>
      </div>

      {split ? (
        <div className="grid grid-cols-2 gap-2">
          {([
            ["top", "Haut"],
            ["right", "Droite"],
            ["bottom", "Bas"],
            ["left", "Gauche"],
          ] as const).map(([side, sideLabel]) => (
            <label key={side} className="flex flex-col gap-0.5">
              <span className="text-gray-400">{sideLabel}</span>
              <input
                type="number"
                min={0}
                value={values[side]}
                onChange={(e) => onChangeSide(side, Number(e.target.value))}
                className="border border-gray-200 rounded px-2 py-1"
              />
            </label>
          ))}
        </div>
      ) : (
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Padding</span>
          <input
            type="number"
            min={0}
            value={toUniformPaddingValue(values)}
            onChange={(e) => onChangeUniform(Number(e.target.value))}
            className="border border-gray-200 rounded px-2 py-1"
          />
        </label>
      )}
    </div>
  );
}

function FontFamilyPicker({
  value,
  fonts,
  onChange,
}: {
  value?: string;
  fonts: BuilderFontEntry[];
  onChange: (fontFamily: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(value ?? "");
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(value ?? "");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [value]);

  const filteredFonts = fonts.filter((font) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return font.family.toLowerCase().includes(normalizedQuery);
  });

  const selectedFont = fonts.find((font) => font.family === value);

  return (
    <div ref={rootRef} className="relative">
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="w-full rounded border border-gray-200 bg-white px-2 py-2 text-left transition hover:border-indigo-300"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm text-gray-900"
                style={value ? { fontFamily: value } : undefined}
              >
                {value || "Choisir une typographie"}
              </p>
              <p className="truncate text-[10px] uppercase tracking-wide text-gray-400">
                {selectedFont ? sourceLabel(selectedFont.source) : "Toutes les typographies disponibles"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-gray-400">{open ? "▲" : "▼"}</span>
          </div>
        </button>

        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] text-gray-500 hover:text-gray-700"
          >
            Retirer la police du bloc
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une typographie"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {filteredFonts.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-gray-400">Aucune typographie correspondante.</p>
            ) : (
              <div className="space-y-1">
                {filteredFonts.map((font) => {
                  const isSelected = font.family === value;
                  return (
                    <button
                      key={font.family}
                      type="button"
                      onClick={() => {
                        onChange(font.family);
                        setQuery(font.family);
                        setOpen(false);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-indigo-200 bg-indigo-50"
                          : "border-transparent hover:border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-base text-gray-900"
                            style={{ fontFamily: font.family }}
                          >
                            {font.family}
                          </p>
                          <p
                            className="truncate text-[11px] text-gray-500"
                            style={{ fontFamily: font.family }}
                          >
                            Apercu Aa Bb Cc 123
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500">
                          {sourceLabel(font.source)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sourceLabel(source: BuilderFontEntry["source"]) {
  if (source === "global") return "Globale";
  if (source === "template") return "Template";
  return "Detectee";
}

function StyleEditor({
  style,
  globalFonts,
  backgroundDefaults,
  onChange,
}: {
  style: BlockStyle;
  globalFonts: BuilderFontEntry[];
  backgroundDefaults?: { width: number; height: number };
  onChange: (s: Partial<BlockStyle>) => void;
}) {
  const { template } = useBuilderStore();
  const availableFonts = collectBuilderFonts(template, globalFonts);
  const backgroundEnabled = isTextBackgroundEnabled(style);
  const backgroundMode = getTextBackgroundMode(style);
  const backgroundSize = getTextBackgroundSize(
    style,
    backgroundDefaults?.width ?? 200,
    backgroundDefaults?.height ?? 60
  );
  const textPadding = getTextContentPadding(style);
  const backgroundPadding = getTextBackgroundPadding(style);
  const textPaddingSplit = style.padding === undefined && (
    style.paddingTop !== undefined ||
    style.paddingRight !== undefined ||
    style.paddingBottom !== undefined ||
    style.paddingLeft !== undefined
  );
  const backgroundPaddingSplit = style.textBackgroundPadding === undefined && (
    style.textBackgroundPaddingTop !== undefined ||
    style.textBackgroundPaddingRight !== undefined ||
    style.textBackgroundPaddingBottom !== undefined ||
    style.textBackgroundPaddingLeft !== undefined
  );
  const backgroundRadius = getTextBackgroundBorderRadius(style);

  function updateTextPaddingUniform(value: number) {
    onChange({
      padding: value,
      paddingTop: undefined,
      paddingRight: undefined,
      paddingBottom: undefined,
      paddingLeft: undefined,
    });
  }

  function updateTextPaddingSide(side: keyof BoxPadding, value: number) {
    onChange({
      padding: undefined,
      ...(side === "top" ? { paddingTop: value } : {}),
      ...(side === "right" ? { paddingRight: value } : {}),
      ...(side === "bottom" ? { paddingBottom: value } : {}),
      ...(side === "left" ? { paddingLeft: value } : {}),
    });
  }

  function updateBackgroundPaddingUniform(value: number) {
    onChange({
      textBackgroundPadding: value,
      textBackgroundPaddingTop: undefined,
      textBackgroundPaddingRight: undefined,
      textBackgroundPaddingBottom: undefined,
      textBackgroundPaddingLeft: undefined,
    });
  }

  function updateBackgroundPaddingSide(side: keyof BoxPadding, value: number) {
    onChange({
      textBackgroundPadding: undefined,
      ...(side === "top" ? { textBackgroundPaddingTop: value } : {}),
      ...(side === "right" ? { textBackgroundPaddingRight: value } : {}),
      ...(side === "bottom" ? { textBackgroundPaddingBottom: value } : {}),
      ...(side === "left" ? { textBackgroundPaddingLeft: value } : {}),
    });
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Police</span>
        <FontFamilyPicker
          value={style.fontFamily}
          fonts={availableFonts}
          onChange={(fontFamily) => onChange({ fontFamily })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Taille (pt)</span>
          <input type="number" value={style.fontSize ?? 14}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="border border-gray-200 rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Font weight</span>
          <select value={style.fontWeight ?? 400}
            onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
            className="border border-gray-200 rounded px-2 py-1"
          >
            {[300,400,500,600,700].map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Espacement lettres</span>
        <input
          type="number"
          step={0.1}
          value={style.letterSpacing ?? 0}
          onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2 rounded border border-gray-200 px-2 py-2">
        <input
          type="checkbox"
          checked={style.textShadowEnabled ?? false}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({
                textShadowEnabled: true,
                textShadowColor: style.textShadowColor ?? "#000000",
                textShadowOpacity: style.textShadowOpacity ?? 0.35,
                textShadowBlur: style.textShadowBlur ?? 6,
                textShadowDistance: style.textShadowDistance ?? 4,
                textShadowAngle: style.textShadowAngle ?? 90,
              });
              return;
            }

            onChange({
              textShadowEnabled: false,
              textShadowColor: undefined,
              textShadowOpacity: undefined,
              textShadowBlur: undefined,
              textShadowDistance: undefined,
              textShadowAngle: undefined,
            });
          }}
          className="rounded"
        />
        <span className="text-gray-600">Ombre du texte</span>
      </label>
      {style.textShadowEnabled ? (
        <div className="grid grid-cols-2 gap-2 rounded border border-gray-100 bg-gray-50 p-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Couleur ombre</span>
            <input
              type="color"
              value={style.textShadowColor ?? "#000000"}
              onChange={(e) => onChange({ textShadowColor: e.target.value })}
              className="w-full h-7 cursor-pointer rounded border border-gray-200"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Opacité</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={style.textShadowOpacity ?? 0.35}
              onChange={(e) => onChange({ textShadowOpacity: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Distance</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={style.textShadowDistance ?? 4}
              onChange={(e) => onChange({ textShadowDistance: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Angle</span>
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              value={style.textShadowAngle ?? 90}
              onChange={(e) => onChange({ textShadowAngle: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5 col-span-2">
            <span className="text-gray-400">Flou</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={style.textShadowBlur ?? 6}
              onChange={(e) => onChange({ textShadowBlur: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Couleur texte</span>
          <input type="color" value={style.color ?? "#000000"}
            onChange={(e) => onChange({ color: e.target.value })}
            className="w-full h-7 cursor-pointer rounded border border-gray-200"
          />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-200 px-2 py-2">
          <input
            type="checkbox"
            checked={backgroundEnabled}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({
                  textBackgroundEnabled: true,
                  textBackgroundMode: style.textBackgroundMode ?? "fit",
                  backgroundColor: style.backgroundColor ?? "#FFFFFF",
                  textBackgroundBorderRadius: style.textBackgroundBorderRadius ?? style.borderRadius,
                });
                return;
              }

              onChange({ textBackgroundEnabled: false });
            }}
            className="rounded"
          />
          <span className="text-gray-600">Fond texte</span>
        </label>
      </div>
      {backgroundEnabled ? (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-gray-700">Fond texte</p>
              <p className="text-[10px] text-gray-400">
                {backgroundMode === "fit"
                  ? "Le cartouche suit le texte et respecte son alignement."
                  : backgroundMode === "per-line"
                    ? "Chaque ligne a son propre cartouche ajusté à sa largeur."
                    : "Le cartouche conserve une largeur et une hauteur fixes."}
              </p>
            </div>
            <input type="color" value={style.backgroundColor ?? "#FFFFFF"}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-white p-1">
            <button
              type="button"
              onClick={() => onChange({ textBackgroundMode: "fit" })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "fit"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Adaptatif
            </button>
            <button
              type="button"
              onClick={() => onChange({ textBackgroundMode: "per-line" })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "per-line"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Par ligne
            </button>
            <button
              type="button"
              onClick={() => onChange({
                textBackgroundMode: "fixed",
                textBackgroundWidth: style.textBackgroundWidth ?? (backgroundDefaults?.width ?? 200),
                textBackgroundHeight: style.textBackgroundHeight ?? (backgroundDefaults?.height ?? 60),
              })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "fixed"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Fixe
            </button>
          </div>
          {backgroundMode === "fixed" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400">Largeur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.width}
                  onChange={(e) => onChange({ textBackgroundWidth: Number(e.target.value) })}
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400">Hauteur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.height}
                  onChange={(e) => onChange({ textBackgroundHeight: Number(e.target.value) })}
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-400 leading-4">
              {backgroundMode === "per-line"
                ? "Chaque ligne obtient son propre fond ajusté. Le padding vertical agit comme espacement entre les lignes."
                : "Le fond suit automatiquement la largeur du texte et s'ancre selon l'alignement horizontal du bloc."}
            </p>
          )}

          <BoxPaddingEditor
            label="Padding du fond"
            values={backgroundPadding}
            split={backgroundPaddingSplit}
            onToggleSplit={(nextSplit) => {
              if (nextSplit) {
                onChange({
                  textBackgroundPadding: undefined,
                  textBackgroundPaddingTop: backgroundPadding.top,
                  textBackgroundPaddingRight: backgroundPadding.right,
                  textBackgroundPaddingBottom: backgroundPadding.bottom,
                  textBackgroundPaddingLeft: backgroundPadding.left,
                });
                return;
              }

              updateBackgroundPaddingUniform(toUniformPaddingValue(backgroundPadding));
            }}
            onChangeUniform={updateBackgroundPaddingUniform}
            onChangeSide={updateBackgroundPaddingSide}
          />

          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Arrondi du fond</span>
            <input
              type="number"
              min={0}
              value={backgroundRadius}
              onChange={(e) => onChange({ textBackgroundBorderRadius: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
        </div>
      ) : null}
      <BoxPaddingEditor
        label={backgroundEnabled ? "Padding texte" : "Padding texte"}
        values={textPadding}
        split={textPaddingSplit}
        onToggleSplit={(nextSplit) => {
          if (nextSplit) {
            onChange({
              padding: undefined,
              paddingTop: textPadding.top,
              paddingRight: textPadding.right,
              paddingBottom: textPadding.bottom,
              paddingLeft: textPadding.left,
            });
            return;
          }

          updateTextPaddingUniform(toUniformPaddingValue(textPadding));
        }}
        onChangeUniform={updateTextPaddingUniform}
        onChangeSide={updateTextPaddingSide}
      />
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Alignement vertical</span>
        <div className="flex gap-1">
          {(["top", "middle", "bottom"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange({ verticalAlign: v })}
              title={v === "top" ? "Haut" : v === "middle" ? "Milieu" : "Bas"}
              className={`flex-1 py-1 rounded border text-xs transition-colors ${
                (style.verticalAlign ?? "top") === v
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-gray-200 text-gray-500 hover:border-indigo-300"
              }`}
            >
              {v === "top" ? "↑" : v === "middle" ? "↕" : "↓"}
            </button>
          ))}
        </div>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Alignement horizontal</span>
        <select value={style.textAlign ?? "left"}
          onChange={(e) => onChange({ textAlign: e.target.value as BlockStyle["textAlign"] })}
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="left">Gauche</option>
          <option value="center">Centre</option>
          <option value="right">Droite</option>
        </select>
      </label>
    </div>
  );
}

function TextProps({
  block,
  globalFonts,
  onChange,
}: {
  block: TextBlock;
  globalFonts: BuilderFontEntry[];
  onChange: (c: Partial<TextBlock>) => void;
}) {
  return (
    <>
      <Section label="Style">
        <StyleEditor style={block.style}
          globalFonts={globalFonts}
          backgroundDefaults={{ width: block.w, height: block.h }}
          onChange={(s) => onChange({ style: { ...block.style, ...s } })} />
      </Section>
      <Section label="Règles texte">
        <div className="space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Max lignes</span>
            <input type="number" min={1} placeholder="Illimite" value={block.rules.maxLines ?? ""}
              onChange={(e) => onChange({ rules: { ...block.rules, maxLines: e.target.value ? Number(e.target.value) : undefined } })}
              className="border border-gray-200 rounded px-2 py-1"
            />
            <span className="text-[10px] text-gray-400">Laisser vide pour autoriser autant de lignes que possible.</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.shrinkToFit}
              onChange={(e) => onChange({ rules: {
                ...block.rules,
                shrinkToFit: e.target.checked,
                minFontSize: e.target.checked ? (block.rules.minFontSize ?? Math.max(6, Math.round((block.style.fontSize ?? 14) * 0.6))) : undefined,
              } })} />
            <span className="text-gray-600">Shrink to fit</span>
          </label>
          {block.rules.shrinkToFit && (
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400">Taille min (pt)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={block.rules.minFontSize ?? ""}
                onChange={(e) => onChange({ rules: { ...block.rules, minFontSize: e.target.value ? Number(e.target.value) : undefined } })}
                className="border border-gray-200 rounded px-2 py-1"
              />
              <span className="text-[10px] text-gray-400">Le texte réduit jusqu&apos;à cette taille minimale s&apos;il ne rentre pas dans la box.</span>
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.uppercase}
              onChange={(e) => onChange({ rules: { ...block.rules, uppercase: e.target.checked } })} />
            <span className="text-gray-600">Majuscules</span>
          </label>
        </div>
      </Section>
    </>
  );
}

function ShapeProps({ block, onChange }: { block: ShapeBlock; onChange: (c: Partial<ShapeBlock>) => void }) {
  return (
    <>
      <Section label="Forme">
        <select
          value={block.shape}
          onChange={(e) => onChange({ shape: e.target.value as ShapeKind })}
          className="w-full border border-gray-200 rounded px-2 py-1"
        >
          <option value="rectangle">▬ Rectangle</option>
          <option value="circle">● Cercle / Ovale</option>
          <option value="triangle">▲ Triangle</option>
          <option value="diamond">◆ Diamant</option>
        </select>
      </Section>
      <Section label="Couleurs">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-gray-400">Remplissage</label>
            <input
              type="color"
              value={block.fillColor}
              onChange={(e) => onChange({ fillColor: e.target.value })}
              className="w-8 h-6 cursor-pointer rounded border border-gray-200"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-gray-400">Contour</label>
            <input
              type="color"
              value={block.borderColor ?? "#000000"}
              onChange={(e) => onChange({ borderColor: e.target.value })}
              className="w-8 h-6 cursor-pointer rounded border border-gray-200"
            />
          </div>
        </div>
      </Section>
      <Section label="Options">
        <div className="space-y-2">
          {block.shape === "rectangle" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400">Arrondi (px)</span>
              <input
                type="number" min={0} max={500}
                value={block.borderRadius ?? 0}
                onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
                className="border border-gray-200 rounded px-2 py-1"
              />
            </label>
          )}
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Épaisseur contour (px)</span>
            <input
              type="number" min={0} max={50}
              value={block.borderWidth ?? 0}
              onChange={(e) => onChange({ borderWidth: Number(e.target.value) || undefined })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Opacité (0–1)</span>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={1} step={0.05}
                value={block.opacity ?? 1}
                onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-gray-500 w-8 text-right">{((block.opacity ?? 1) * 100).toFixed(0)}%</span>
            </div>
          </label>
        </div>
      </Section>
    </>
  );
}

function ImageProps({ block, onChange }: { block: ImageBlock; onChange: (c: Partial<ImageBlock>) => void }) {
  const staticInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleStaticUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) onChange({ staticSrc: data.url });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Section label="Options image">
      {/* Image statique (logo, fond fixe) */}
      <div className="mb-3">
        <p className="text-gray-400 mb-1">Image statique (logo, fond…)</p>
        <input
          ref={staticInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleStaticUpload(f);
            e.target.value = "";
          }}
        />
        {block.staticSrc ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.staticSrc} alt="" className="h-10 w-10 object-contain rounded border border-gray-200 bg-gray-50" />
            <span className="text-[10px] text-gray-500 flex-1 truncate">{block.staticSrc.split("/").pop()}</span>
            <button
              type="button"
              onClick={() => onChange({ staticSrc: undefined })}
              className="text-[10px] text-red-400 hover:text-red-600"
              title="Retirer l'image statique"
            >✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-xs py-1.5 border border-dashed border-gray-300 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Upload…" : "+ Télécharger une image"}
          </button>
        )}
        {block.staticSrc && (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="mt-1 w-full text-[10px] text-gray-400 hover:text-gray-600"
          >
            Remplacer
          </button>
        )}
        <p className="text-[9px] text-gray-300 mt-1">
          Si renseigné, cette image est toujours affichée (ignore le binding).
        </p>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Ajustement</span>
        <select value={block.fit}
          onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Border radius</span>
        <input type="number" value={block.borderRadius ?? 0}
          onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
    </Section>
  );
}

function VideoProps({ block, onChange }: { block: VideoBlock; onChange: (c: Partial<VideoBlock>) => void }) {
  return (
    <Section label="Options vidéo">
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Redimensionnement</span>
        <select
          value={block.fit ?? "cover"}
          onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
          className="border border-gray-200 rounded px-2 py-1 text-sm"
        >
          <option value="cover">Cover (remplir + recadrer)</option>
          <option value="contain">Contain (letterbox)</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Border radius</span>
        <input type="number" value={block.borderRadius ?? 0}
          onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Couleur placeholder (builder)</span>
        <input type="color" value={block.placeholderColor ?? "#111827"}
          onChange={(e) => onChange({ placeholderColor: e.target.value })}
          className="h-8 w-full border border-gray-200 rounded"
        />
      </label>
      <label className="flex items-center gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={block.mute ?? false}
          onChange={(e) => onChange({ mute: e.target.checked })}
          className="rounded"
        />
        <span className="text-gray-600 text-[11px]">Couper l&apos;audio de cette vidéo</span>
      </label>
      {!block.mute && (
        <label className="flex flex-col gap-1 mt-3">
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Volume audio</span>
            <span className="text-gray-600">{Math.round((block.audioVolume ?? 1) * 100)}%</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={block.audioVolume ?? 1}
            onChange={(e) => onChange({ audioVolume: Number(e.target.value) })}
            className="w-full"
          />
        </label>
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        🎬 Ce bloc est le fond vidéo du template.<br />
        La source et la bibliothèque se configurent dans l&apos;onglet <strong>Séquence</strong>.
      </p>
    </Section>
  );
}

function DPEProps({ block, onChange }: { block: DPEBlock; onChange: (c: Partial<DPEBlock>) => void }) {
  return (
    <Section label="Diagramme">
      <div className="flex gap-1">
        {(["energy", "climate"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange({ variant: v, w: 430, h: 400 })}
            className={`flex-1 text-xs py-1 rounded border transition-colors ${
              block.variant === v
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
            }`}
          >
            {v === "energy" ? "⚡ Énergie" : "🌡 Climat CO₂"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={block.showFrame ?? true}
            onChange={(e) => onChange({ showFrame: e.target.checked })}
          />
          Afficher le cadre
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={block.showBackground ?? true}
            onChange={(e) => onChange({ showBackground: e.target.checked })}
          />
          Afficher le fond
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400 text-[11px]">Couleur du cadre</span>
          <input
            type="color"
            value={block.frameColor ?? "#9a9a9a"}
            onChange={(e) => onChange({ frameColor: e.target.value })}
            className="h-8 w-full border border-gray-200 rounded"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400 text-[11px]">Couleur du fond</span>
          <input
            type="color"
            value={block.backgroundColor ?? "#ffffff"}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="h-8 w-full border border-gray-200 rounded"
          />
        </label>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        Les valeurs sont saisies lors de la génération.<br/>
        Clés fixes : <span className="font-mono">dpe_note</span>, <span className="font-mono">dpe_valeur</span>, <span className="font-mono">ges_note</span>, <span className="font-mono">ges_valeur</span>.
      </p>
    </Section>
  );
}

function ConditionalRulesSection({
  block,
  schema,
  onChange,
}: {
  block: AnyBlock;
  schema: SchemaField[];
  onChange: (c: Partial<AnyBlock>) => void;
}) {
  const conditionalRules = block.conditionalRules ?? [];
  const conditionFields = getConditionSourceFields(schema);
  const supportsTextColor = block.type === "text";
  const supportsBackgroundColor = block.type === "text" || block.type === "shape" || block.type === "dpe";
  const supportsOpacity = block.type === "text" || block.type === "shape" || block.type === "dpe";

  function updateRule(index: number, changes: Partial<BlockConditionalRule>) {
    const next = conditionalRules.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;
      return {
        ...rule,
        ...changes,
        when: { ...rule.when, ...(changes.when ?? {}) },
        effects: { ...rule.effects, ...(changes.effects ?? {}) },
      };
    });
    onChange({ conditionalRules: next, showIf: undefined, conditionalOverrides: undefined } as Partial<AnyBlock>);
  }

  function removeRule(index: number) {
    onChange({ conditionalRules: conditionalRules.filter((_, ruleIndex) => ruleIndex !== index), showIf: undefined, conditionalOverrides: undefined } as Partial<AnyBlock>);
  }

  function addRule() {
    const firstField = conditionFields[0];
    const defaultEquals = getConditionValueOptions(firstField)[0]?.value ?? "";
    onChange({
      conditionalRules: [
        ...conditionalRules,
        {
          when: { field: firstField?.key ?? "", equals: defaultEquals },
          effects: {},
        },
      ],
      showIf: undefined,
      conditionalOverrides: undefined,
    } as Partial<AnyBlock>);
  }

  return (
    <Section label="Règles conditionnelles">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Une règle peut afficher ou masquer le bloc, le décaler, le faire pivoter ou ajuster son rendu selon une valeur du formulaire.
        </p>
        {conditionFields.length === 0 && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
            Ajoute d&apos;abord un champ de type liste ou oui/non dans le schéma pour créer une variante conditionnelle.
          </p>
        )}
        {conditionalRules.map((rule, index) => {
          const selectedField = schema.find((item) => item.key === rule.when.field);
          const valueOptions = getConditionValueOptions(selectedField);
          return (
            <div key={`${rule.when.field}-${index}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-gray-600">Règle {index + 1}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Quand {selectedField?.label || rule.when.field || "un champ"} vaut {rule.when.equals || "…"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="text-[11px] text-red-500 hover:text-red-600"
                >
                  Supprimer
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Champ</span>
                  <select
                    value={rule.when.field}
                    onChange={(e) => {
                      const nextField = schema.find((item) => item.key === e.target.value);
                      updateRule(index, {
                        when: {
                          field: e.target.value,
                          equals: getConditionValueOptions(nextField)[0]?.value ?? "",
                        },
                      });
                    }}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="">— choisir —</option>
                    {conditionFields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label || field.key}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Valeur attendue</span>
                  {valueOptions.length > 0 ? (
                    <select
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    >
                      <option value="">— choisir —</option>
                      {valueOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      placeholder="valeur"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    />
                  )}
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Effet de visibilité</span>
                  <select
                    value={rule.effects.visible === true ? "show" : rule.effects.visible === false ? "hide" : "none"}
                    onChange={(e) => updateRule(index, {
                      effects: {
                        ...rule.effects,
                        visible: e.target.value === "show" ? true : e.target.value === "hide" ? false : undefined,
                      },
                    })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="none">Aucun</option>
                    <option value="show">Afficher le bloc</option>
                    <option value="hide">Masquer le bloc</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage X</span>
                  <input
                    type="number"
                    value={rule.effects.offsetX ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetX: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage Y</span>
                  <input
                    type="number"
                    value={rule.effects.offsetY ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetY: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Rotation</span>
                  <input
                    type="number"
                    value={rule.effects.rotation ?? ""}
                    onChange={(e) => updateRule(index, {
                      effects: { ...rule.effects, rotation: e.target.value === "" ? undefined : Number(e.target.value) },
                    })}
                    placeholder="inchangée"
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
                {supportsOpacity && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 text-[11px]">Opacité</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={rule.effects.opacity ?? ""}
                      onChange={(e) => updateRule(index, {
                        effects: { ...rule.effects, opacity: e.target.value === "" ? undefined : Number(e.target.value) },
                      })}
                      placeholder="inchangée"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {supportsTextColor && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 text-[11px]">Couleur du texte</span>
                    <input
                      type="color"
                      value={rule.effects.textColor ?? "#000000"}
                      onChange={(e) => updateRule(index, { effects: { ...rule.effects, textColor: e.target.value } })}
                      className="h-9 w-full border border-gray-200 rounded bg-white"
                    />
                  </label>
                )}
                {supportsBackgroundColor && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400 text-[11px]">Couleur de fond</span>
                    <input
                      type="color"
                      value={rule.effects.backgroundColor ?? "#ffffff"}
                      onChange={(e) => updateRule(index, { effects: { ...rule.effects, backgroundColor: e.target.value } })}
                      className="h-9 w-full border border-gray-200 rounded bg-white"
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addRule}
          disabled={conditionFields.length === 0}
          className="w-full text-center text-xs py-2 border border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
        >
          + Ajouter une règle
        </button>
      </div>
    </Section>
  );
}

function GroupConditionalRulesSection({
  group,
  schema,
  onChange,
}: {
  group: LayerGroup;
  schema: SchemaField[];
  onChange: (c: Partial<LayerGroup>) => void;
}) {
  const conditionalRules = group.conditionalRules ?? [];
  const conditionFields = getConditionSourceFields(schema);

  function updateRule(index: number, changes: Partial<BlockConditionalRule>) {
    const next = conditionalRules.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;
      return {
        ...rule,
        ...changes,
        when: { ...rule.when, ...(changes.when ?? {}) },
        effects: {
          ...rule.effects,
          ...(changes.effects ?? {}),
        },
      };
    });
    onChange({ conditionalRules: next });
  }

  function removeRule(index: number) {
    onChange({ conditionalRules: conditionalRules.filter((_, ruleIndex) => ruleIndex !== index) });
  }

  function addRule() {
    const firstField = conditionFields[0];
    const defaultEquals = getConditionValueOptions(firstField)[0]?.value ?? "";
    onChange({
      conditionalRules: [
        ...conditionalRules,
        {
          when: { field: firstField?.key ?? "", equals: defaultEquals },
          effects: {},
        },
      ],
    });
  }

  return (
    <Section label="Règles conditionnelles">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Les règles de groupe permettent de masquer tout un ensemble de calques ou de le décaler d&apos;un coup selon une valeur du formulaire.
        </p>
        {conditionFields.length === 0 && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
            Ajoute d&apos;abord un champ de type liste ou oui/non dans le schéma pour créer une variante conditionnelle.
          </p>
        )}
        {conditionalRules.map((rule, index) => {
          const selectedField = schema.find((item) => item.key === rule.when.field);
          const valueOptions = getConditionValueOptions(selectedField);
          return (
            <div key={`${rule.when.field}-${index}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-gray-600">Règle {index + 1}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Quand {selectedField?.label || rule.when.field || "un champ"} vaut {rule.when.equals || "…"}</p>
                </div>
                <button type="button" onClick={() => removeRule(index)} className="text-[11px] text-red-500 hover:text-red-600">
                  Supprimer
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Champ</span>
                  <select
                    value={rule.when.field}
                    onChange={(e) => {
                      const nextField = schema.find((item) => item.key === e.target.value);
                      updateRule(index, {
                        when: {
                          field: e.target.value,
                          equals: getConditionValueOptions(nextField)[0]?.value ?? "",
                        },
                      });
                    }}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="">— choisir —</option>
                    {conditionFields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label || field.key}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Valeur attendue</span>
                  {valueOptions.length > 0 ? (
                    <select
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    >
                      <option value="">— choisir —</option>
                      {valueOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      placeholder="valeur"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    />
                  )}
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Effet de visibilité</span>
                  <select
                    value={rule.effects.visible === true ? "show" : rule.effects.visible === false ? "hide" : "none"}
                    onChange={(e) => updateRule(index, {
                      effects: {
                        ...rule.effects,
                        visible: e.target.value === "show" ? true : e.target.value === "hide" ? false : undefined,
                      },
                    })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="none">Aucun</option>
                    <option value="show">Afficher le groupe</option>
                    <option value="hide">Masquer le groupe</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage X</span>
                  <input
                    type="number"
                    value={rule.effects.offsetX ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetX: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage Y</span>
                  <input
                    type="number"
                    value={rule.effects.offsetY ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetY: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addRule}
          disabled={conditionFields.length === 0}
          className="w-full text-center text-xs py-2 border border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
        >
          + Ajouter une règle
        </button>
      </div>
    </Section>
  );
}

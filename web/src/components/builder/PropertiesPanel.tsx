"use client";

import { useRef } from "react";
import { extractTemplateVars } from "@/lib/textTemplate";
import { type BuilderFontEntry } from "@/lib/builderFonts";
import { getAutoLayoutMode, getAutoLayoutOrderedBlocks, getGroupBounds } from "@/lib/groupLayout";
import { useBuilderStore } from "@/lib/store/builderStore";
import type {
  AnyBlock, TextBlock, ImageBlock, VideoBlock, DPEBlock,
  ShapeBlock, SchemaField, LayerGroup, MusicBlock,
} from "@/types/template";
import { Section } from "./properties/Section";
import { buildAnchoredSizeChange } from "./properties/utils";
import { BlockConditionalRulesSection } from "./properties/BlockConditionalRulesSection";
import { GroupConditionalRulesSection } from "./properties/GroupConditionalRulesSection";
import { ShapeBlockPropertiesPanel } from "./properties/ShapeBlockPropertiesPanel";
import { ImageBlockPropertiesPanel } from "./properties/ImageBlockPropertiesPanel";
import { VideoBlockPropertiesPanel } from "./properties/VideoBlockPropertiesPanel";
import { DPEBlockPropertiesPanel } from "./properties/DPEBlockPropertiesPanel";
import { StyleEditor } from "./properties/StyleEditor";
import { TextContentSection } from "./properties/TextContentSection";

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

  const prevBindingRef = useRef<string>("");

  function updateSchemaField(fieldKey: string, changes: Partial<SchemaField>) {
    setSchema(template.schema.map((field) => (
      field.key === fieldKey ? { ...field, ...changes } : field
    )));
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
        {block.type === "text" && (
          <TextContentSection
            block={block as TextBlock}
            schema={template.schema}
            showResolvedTextPreview={showResolvedTextPreview}
            onShowResolvedTextPreviewChange={onShowResolvedTextPreviewChange}
            onUpdateBlock={(id, changes) => updateBlock(id, changes)}
            onUpdateSchemaField={updateSchemaField}
            onSyncTextSchema={syncTextSchema}
            onSetSchema={setSchema}
          />
        )}

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
        {block.type === "text" && (() => {
          const tb = block as TextBlock;
          return (
            <>
              <Section label="Style">
                <StyleEditor
                  style={tb.style}
                  globalFonts={globalFonts}
                  backgroundDefaults={{ width: tb.w, height: tb.h }}
                  onChange={(s) => updateBlock(tb.id, { style: { ...tb.style, ...s } })}
                />
              </Section>
              <Section label="Règles texte">
                <div className="space-y-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-400">Max lignes</span>
                    <input type="number" min={1} placeholder="Illimite" value={tb.rules.maxLines ?? ""}
                      onChange={(e) => updateBlock(tb.id, { rules: { ...tb.rules, maxLines: e.target.value ? Number(e.target.value) : undefined } })}
                      className="border border-gray-200 rounded px-2 py-1"
                    />
                    <span className="text-[10px] text-gray-400">Laisser vide pour autoriser autant de lignes que possible.</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!tb.rules.shrinkToFit}
                      onChange={(e) => updateBlock(tb.id, { rules: {
                        ...tb.rules,
                        shrinkToFit: e.target.checked,
                        minFontSize: e.target.checked ? (tb.rules.minFontSize ?? Math.max(6, Math.round((tb.style.fontSize ?? 14) * 0.6))) : undefined,
                      } })} />
                    <span className="text-gray-600">Shrink to fit</span>
                  </label>
                  {tb.rules.shrinkToFit && (
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-400">Taille min (pt)</span>
                      <input
                        type="number"
                        min={1}
                        step={0.5}
                        value={tb.rules.minFontSize ?? ""}
                        onChange={(e) => updateBlock(tb.id, { rules: { ...tb.rules, minFontSize: e.target.value ? Number(e.target.value) : undefined } })}
                        className="border border-gray-200 rounded px-2 py-1"
                      />
                      <span className="text-[10px] text-gray-400">Le texte réduit jusqu&apos;à cette taille minimale s&apos;il ne rentre pas dans la box.</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!tb.rules.uppercase}
                      onChange={(e) => updateBlock(tb.id, { rules: { ...tb.rules, uppercase: e.target.checked } })} />
                    <span className="text-gray-600">Majuscules</span>
                  </label>
                </div>
              </Section>
            </>
          );
        })()}

        {/* Shape specific */}
        {block.type === "shape" && (
          <ShapeBlockPropertiesPanel block={block as ShapeBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Image specific */}
        {block.type === "image" && (
          <ImageBlockPropertiesPanel block={block as ImageBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Vidéo specific */}
        {block.type === "video" && (
          <VideoBlockPropertiesPanel block={block as VideoBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* DPE specific */}
        {block.type === "dpe" && (
          <DPEBlockPropertiesPanel block={block as DPEBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        <BlockConditionalRulesSection
          block={block}
          schema={template.schema}
          onChange={(c) => updateBlock(block.id, c as Partial<AnyBlock>)}
        />
      </div>
    </aside>
  );
}


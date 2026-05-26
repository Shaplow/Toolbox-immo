"use client";

import { getAutoLayoutMode, getAutoLayoutOrderedBlocks, getGroupBounds } from "@/lib/groupLayout";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { LayerGroup } from "@/types/template";
import { Section } from "./Section";
import { GroupConditionalRulesSection } from "./GroupConditionalRulesSection";

export function GroupPropertiesPanel({
  group,
}: {
  group: LayerGroup;
}) {
  const { template, updateGroup, moveGroupBlocks } = useBuilderStore();

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
    updateGroup(group.id, { layout: { ...group.layout, mode: autoLayoutMode, ...changes } });
  }

  function buildAutoLayout(nextMode: "row" | "column") {
    const initialOrder = getAutoLayoutOrderedBlocks(
      { ...group, layout: { ...group.layout, mode: nextMode } },
      members,
    ).map((member) => member.id);
    return {
      mode: nextMode,
      width: Math.max(1, Math.round(group.layout?.width ?? groupBounds?.width ?? template.canvas.width)),
      height: Math.max(1, Math.round(group.layout?.height ?? groupBounds?.height ?? template.canvas.height)),
      gap: group.layout?.gap ?? 16,
      justify: group.layout?.justify ?? "center",
      align: group.layout?.align ?? "top",
      order: initialOrder,
      anchorBlockId: group.layout?.anchorBlockId,
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

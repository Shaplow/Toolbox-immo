"use client";

import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { getAutoLayoutMode, getAutoLayoutOrderedBlocks, getGroupBounds } from "@/lib/groupLayout";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { LayerGroup } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
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
      {/* Header — nom éditable inline.
          Avant : "groupe #abc1" (id tronqué). Le name était enterré dans le
          formulaire propriétés et l'user ne savait pas quel groupe il édite. */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
            Groupe
          </p>
          <input
            type="text"
            value={group.name}
            onChange={(e) => updateGroup(group.id, { name: e.target.value })}
            placeholder="Groupe sans nom"
            className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 outline-none focus:bg-gray-50 focus:ring-2 focus:ring-indigo-300 rounded px-1 -mx-1"
            title="Cliquer pour renommer le groupe"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => updateGroup(group.id, { hidden: !group.hidden })}
            title={group.hidden ? "Afficher le groupe" : "Masquer le groupe à la génération"}
            className={[
              "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors",
              group.hidden
                ? "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600",
            ].join(" ")}
          >
            {group.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={() => updateGroup(group.id, { locked: !group.locked })}
            title={group.locked ? "Déverrouiller le groupe" : "Verrouiller le groupe"}
            className={[
              "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors",
              group.locked
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600",
            ].join(" ")}
          >
            {group.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5 text-xs">
        {/* ── Groupe ── */}
        {/* Nom retiré : édité directement dans le header au-dessus. */}
        <Section label="Groupe">
          <div className="flex items-center justify-between">
            <ToggleSwitch
              checked={group.collapsed ?? false}
              onChange={(v) => updateGroup(group.id, { collapsed: v })}
              label="Replié par défaut"
            />
            <span className="text-[10px] text-gray-400 shrink-0">
              {memberCount} calque{memberCount > 1 ? "s" : ""}
            </span>
          </div>
        </Section>

        {/* ── Déplacement ── */}
        <Section label="Déplacement">
          {groupBounds ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">x</span>
                  <input
                    type="number"
                    value={groupBounds.minX}
                    onChange={(e) => moveGroupTo(Number(e.target.value), undefined)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">y</span>
                  <input
                    type="number"
                    value={groupBounds.minY}
                    onChange={(e) => moveGroupTo(undefined, Number(e.target.value))}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">w</span>
                  <input
                    type="number"
                    value={effectiveGroupWidth}
                    readOnly
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 text-gray-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">h</span>
                  <input
                    type="number"
                    value={effectiveGroupHeight}
                    readOnly
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-gray-50 text-gray-500"
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
                    <button key={title} type="button" title={title} onClick={fn}
                      className="flex-1 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
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
                    <button key={title} type="button" title={title} onClick={fn}
                      className="flex-1 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
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

        {/* ── Disposition ── */}
        <Section label="Disposition">
          <div className="space-y-3">
            {/* Layout mode selector */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: undefined })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  !isAutoLayout ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white",
                ].join(" ")}
              >
                Libre
              </button>
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: buildAutoLayout("row") })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  autoLayoutMode === "row" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white",
                ].join(" ")}
              >
                Ligne
              </button>
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: buildAutoLayout("column") })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  autoLayoutMode === "column" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-white",
                ].join(" ")}
              >
                Colonne
              </button>
            </div>
            {/* Hint contextuel selon le mode choisi — sans modal, juste une
                ligne sous le sélecteur pour expliquer la conséquence concrète. */}
            <p className="text-[10px] text-gray-400 italic leading-relaxed">
              {!isAutoLayout
                ? "Libre : chaque calque garde sa position individuelle. Tu déplaces à la main."
                : autoLayoutMode === "row"
                  ? "Ligne : les calques s'alignent côte à côte horizontalement, espacés régulièrement."
                  : "Colonne : les calques s'empilent verticalement, espacés régulièrement."}
            </p>

            {isAutoLayout ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600 uppercase">{layoutWidthLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={layoutWidth}
                      onChange={(e) => updateAutoLayout({ width: Number(e.target.value) })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600 uppercase">{layoutHeightLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={layoutHeight}
                      onChange={(e) => updateAutoLayout({ height: Number(e.target.value) })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                    />
                  </label>
                </div>

                <Slider
                  label="Écart"
                  value={group.layout?.gap ?? 16}
                  onChange={(v) => updateAutoLayout({ gap: v })}
                  min={0}
                  max={50}
                  unit="px"
                />

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">{justifyLabel}</span>
                  <select
                    value={group.layout?.justify ?? "center"}
                    onChange={(e) => updateAutoLayout({ justify: e.target.value as "start" | "center" | "end" })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="start">{autoLayoutMode === "column" ? "Haut" : "Gauche"}</option>
                    <option value="center">Centre</option>
                    <option value="end">{autoLayoutMode === "column" ? "Bas" : "Droite"}</option>
                  </select>
                  <span className="text-[10px] text-gray-400 italic">
                    Position du bloc d&apos;ancrage dans le {autoLayoutMode === "column" ? "sens vertical" : "sens horizontal"}.
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">{alignLabel}</span>
                  <select
                    value={group.layout?.align ?? "top"}
                    onChange={(e) => updateAutoLayout({ align: e.target.value as "top" | "middle" | "bottom" })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="top">{autoLayoutMode === "column" ? "Gauche" : "Haut"}</option>
                    <option value="middle">Milieu</option>
                    <option value="bottom">{autoLayoutMode === "column" ? "Droite" : "Bas"}</option>
                  </select>
                  <span className="text-[10px] text-gray-400 italic">
                    Position du bloc d&apos;ancrage dans le {autoLayoutMode === "column" ? "sens horizontal" : "sens vertical"}.
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 uppercase">Bloc centré</span>
                  <select
                    value={group.layout?.anchorBlockId ?? ""}
                    onChange={(e) => updateAutoLayout({ anchorBlockId: e.target.value || undefined })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="">Centre du groupe</option>
                    {orderedMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name?.trim() || `${member.type}-${member.id.slice(-4)}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-gray-400 italic">
                    Bloc pivot pour le centrage. Les autres blocs se positionnent autour selon les règles Justifier / Aligner.
                  </span>
                </label>

                {orderedMembers.length > 0 ? (
                  <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Ordre auto-layout</p>
                    {orderedMembers.map((member, index) => {
                      const isAnchor = group.layout?.anchorBlockId === member.id;
                      const label = member.name?.trim() || `${member.type}-${member.id.slice(-4)}`;
                      return (
                        <div key={member.id} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1.5 border border-gray-200">
                          <span className={[
                            "min-w-0 flex-1 truncate text-xs",
                            isAnchor ? "text-indigo-700 font-medium" : "text-gray-700",
                          ].join(" ")}>{label}</span>
                          <button
                            type="button"
                            onClick={() => moveOrderedMember(member.id, -1)}
                            disabled={index === 0}
                            className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                            title="Monter dans l'ordre"
                          >↑</button>
                          <button
                            type="button"
                            onClick={() => moveOrderedMember(member.id, 1)}
                            disabled={index === orderedMembers.length - 1}
                            className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                            title="Descendre dans l'ordre"
                          >↓</button>
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

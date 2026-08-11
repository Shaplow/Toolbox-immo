"use client";

import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { buildAutoLayoutConfig, GAP_DEFAULT, GAP_MAX, GAP_MIN, getAutoLayoutMode, getAutoLayoutOrderedBlocks, getGroupBounds } from "@/lib/groupLayout";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { AnyBlock, LayerGroup } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
import { Section } from "./Section";
import { GroupConditionalRulesSection } from "./GroupConditionalRulesSection";

export function GroupPropertiesPanel({
  group,
}: {
  group: LayerGroup;
}) {
  const { template, updateGroup, moveGroupBlocks, updateBlock } = useBuilderStore();

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

  // Sous-groupes directs : ils comptent comme des membres ordonnables du parent
  // (le moteur les traite comme des blocs virtuels). Ils apparaissent donc dans
  // la liste d'ordre et peuvent être réordonnés / décalés comme un bloc.
  const childGroups = template.groups.filter((g) => g.parentGroupId === group.id);
  type OrderItem =
    | { id: string; kind: "block"; block: AnyBlock }
    | { id: string; kind: "group"; subgroup: LayerGroup };
  const orderedItems: OrderItem[] = (() => {
    const items: OrderItem[] = [
      ...members.map((b): OrderItem => ({ id: b.id, kind: "block", block: b })),
      ...childGroups.map((g): OrderItem => ({ id: g.id, kind: "group", subgroup: g })),
    ];
    if (!isAutoLayout) return items;
    const order = group.layout?.order ?? [];
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...items].sort((a, b) => rank(a.id) - rank(b.id));
  })();

  function updateAutoLayout(changes: Partial<NonNullable<LayerGroup["layout"]>>) {
    if (!autoLayoutMode) return;
    updateGroup(group.id, { layout: { ...group.layout, mode: autoLayoutMode, ...changes } });
  }

  // Construction déléguée à `groupLayout.ts` : l'objet était reconstruit ici à la
  // main et `sizeToContent` y était systématiquement perdu (cf. commentaire de
  // buildAutoLayoutConfig).
  function buildAutoLayout(nextMode: "row" | "column") {
    return buildAutoLayoutConfig(group, members, nextMode, {
      width: groupBounds?.width ?? template.canvas.width,
      height: groupBounds?.height ?? template.canvas.height,
    });
  }

  function moveOrderedMember(itemId: string, direction: -1 | 1) {
    if (!autoLayoutMode) return;
    const order = orderedItems.map((item) => item.id);
    const index = order.indexOf(itemId);
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
    <aside className="w-64 bg-white border-l border-border flex flex-col shrink-0 overflow-y-auto">
      {/* Header — nom éditable inline.
          Avant : "groupe #abc1" (id tronqué). Le name était enterré dans le
          formulaire propriétés et l'user ne savait pas quel groupe il édite. */}
      <div className="p-4 border-b border-border flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
            Groupe
          </p>
          <input
            type="text"
            value={group.name}
            onChange={(e) => updateGroup(group.id, { name: e.target.value })}
            placeholder="Groupe sans nom"
            className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 outline-none focus:bg-muted focus:ring-2 focus:ring-indigo-300 rounded px-1 -mx-1"
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
                : "bg-white border-border text-muted-foreground hover:border-gray-400 hover:text-muted-foreground",
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
                : "bg-white border-border text-muted-foreground hover:border-gray-400 hover:text-muted-foreground",
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
            <span className="text-[10px] text-muted-foreground shrink-0">
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
                  <span className="text-xs font-medium text-muted-foreground uppercase">x</span>
                  <input
                    type="number"
                    value={groupBounds.minX}
                    onChange={(e) => moveGroupTo(Number(e.target.value), undefined)}
                    className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">y</span>
                  <input
                    type="number"
                    value={groupBounds.minY}
                    onChange={(e) => moveGroupTo(undefined, Number(e.target.value))}
                    className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">w</span>
                  <input
                    type="number"
                    value={effectiveGroupWidth}
                    readOnly
                    className="border border-border rounded-lg px-2 py-1 text-xs bg-muted text-muted-foreground"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">h</span>
                  <input
                    type="number"
                    value={effectiveGroupHeight}
                    readOnly
                    className="border border-border rounded-lg px-2 py-1 text-xs bg-muted text-muted-foreground"
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
                      className="flex-1 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
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
                      className="flex-1 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground leading-5 mt-2">
                Vous pouvez aussi sélectionner le groupe dans la pile puis glisser n&apos;importe quel bloc membre sur le canvas pour déplacer tout le groupe.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-5">
              Ajoutez d&apos;abord des calques dans ce groupe pour le déplacer ensemble.
            </p>
          )}
        </Section>

        {/* ── Disposition ── */}
        <Section label="Disposition">
          <div className="space-y-3">
            {/* Layout mode selector */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: undefined })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  !isAutoLayout ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-white",
                ].join(" ")}
              >
                Libre
              </button>
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: buildAutoLayout("row") })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  autoLayoutMode === "row" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-white",
                ].join(" ")}
              >
                Ligne
              </button>
              <button
                type="button"
                onClick={() => updateGroup(group.id, { layout: buildAutoLayout("column") })}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  autoLayoutMode === "column" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-white",
                ].join(" ")}
              >
                Colonne
              </button>
            </div>
            {/* Hint contextuel selon le mode choisi — sans modal, juste une
                ligne sous le sélecteur pour expliquer la conséquence concrète. */}
            <p className="text-[10px] text-muted-foreground italic leading-relaxed">
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
                    <span className="text-xs font-medium text-muted-foreground uppercase">{layoutWidthLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={layoutWidth}
                      onChange={(e) => updateAutoLayout({ width: Number(e.target.value) })}
                      className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase">{layoutHeightLabel}</span>
                    <input
                      type="number"
                      min={1}
                      value={layoutHeight}
                      onChange={(e) => updateAutoLayout({ height: Number(e.target.value) })}
                      className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                    />
                  </label>
                </div>

                {/* Écart négatif = les blocs se chevauchent. Le curseur couvre la
                    plage de travail courante ; le champ donne accès aux extrêmes. */}
                <Slider
                  label="Écart"
                  value={group.layout?.gap ?? GAP_DEFAULT}
                  onChange={(v) => updateAutoLayout({ gap: v })}
                  min={-50}
                  max={GAP_MAX}
                  unit="px"
                  editable
                  inputMin={GAP_MIN}
                  inputMax={GAP_MAX}
                />

                <div className="flex flex-col gap-1">
                  <ToggleSwitch
                    checked={group.layout?.sizeToContent === true}
                    onChange={(v) => updateAutoLayout({ sizeToContent: v ? true : undefined })}
                    label="Hauteur réelle du texte"
                  />
                  <span className="text-[10px] text-muted-foreground italic">
                    Les blocs suivent la hauteur réelle du contenu (utile pour que les m² collent au
                    titre, qu&apos;il tienne sur 1 ou 2 lignes).
                  </span>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">{justifyLabel}</span>
                  <select
                    value={group.layout?.justify ?? "center"}
                    onChange={(e) => updateAutoLayout({ justify: e.target.value as "start" | "center" | "end" })}
                    className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="start">{autoLayoutMode === "column" ? "Haut" : "Gauche"}</option>
                    <option value="center">Centre</option>
                    <option value="end">{autoLayoutMode === "column" ? "Bas" : "Droite"}</option>
                  </select>
                  <span className="text-[10px] text-muted-foreground italic">
                    Position du bloc d&apos;ancrage dans le {autoLayoutMode === "column" ? "sens vertical" : "sens horizontal"}.
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">{alignLabel}</span>
                  <select
                    value={group.layout?.align ?? "top"}
                    onChange={(e) => updateAutoLayout({ align: e.target.value as "top" | "middle" | "bottom" })}
                    className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="top">{autoLayoutMode === "column" ? "Gauche" : "Haut"}</option>
                    <option value="middle">Milieu</option>
                    <option value="bottom">{autoLayoutMode === "column" ? "Droite" : "Bas"}</option>
                  </select>
                  <span className="text-[10px] text-muted-foreground italic">
                    Position du bloc d&apos;ancrage dans le {autoLayoutMode === "column" ? "sens horizontal" : "sens vertical"}.
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">Bloc centré</span>
                  <select
                    value={group.layout?.anchorBlockId ?? ""}
                    onChange={(e) => updateAutoLayout({ anchorBlockId: e.target.value || undefined })}
                    className="border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="">Centre du groupe</option>
                    {orderedMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name?.trim() || `${member.type}-${member.id.slice(-4)}`}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-muted-foreground italic">
                    Bloc pivot pour le centrage. Les autres blocs se positionnent autour selon les règles Justifier / Aligner.
                  </span>
                </label>

                {orderedItems.length > 0 ? (
                  <div className="space-y-1 rounded-lg border border-border bg-muted p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ordre auto-layout</p>
                    {orderedItems.map((item, index) => {
                      const isAnchor = group.layout?.anchorBlockId === item.id;
                      const isGroup = item.kind === "group";
                      const label = isGroup
                        ? (item.subgroup.name?.trim() || "Sous-groupe")
                        : (item.block.name?.trim() || `${item.block.type}-${item.id.slice(-4)}`);
                      const offsetX = isGroup ? (item.subgroup.autoLayoutOffsetX ?? 0) : (item.block.autoLayoutOffsetX ?? 0);
                      const offsetY = isGroup ? (item.subgroup.autoLayoutOffsetY ?? 0) : (item.block.autoLayoutOffsetY ?? 0);
                      const setOffset = (changes: { autoLayoutOffsetX?: number; autoLayoutOffsetY?: number }) => {
                        if (isGroup) updateGroup(item.id, changes);
                        else updateBlock(item.id, changes as Partial<AnyBlock>);
                      };
                      return (
                        <div key={item.id} className="rounded-lg bg-white px-2 py-1.5 border border-border space-y-1.5">
                          <div className="flex items-center gap-1">
                            {isGroup ? <span className="text-[10px] text-indigo-500" title="Sous-groupe">⊟</span> : null}
                            <span className={[
                              "min-w-0 flex-1 truncate text-xs",
                              isAnchor ? "text-indigo-700 font-medium" : "text-foreground",
                            ].join(" ")}>{label}</span>
                            <button
                              type="button"
                              onClick={() => moveOrderedMember(item.id, -1)}
                              disabled={index === 0}
                              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                              title="Monter dans l'ordre"
                            >↑</button>
                            <button
                              type="button"
                              onClick={() => moveOrderedMember(item.id, 1)}
                              disabled={index === orderedItems.length - 1}
                              className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                              title="Descendre dans l'ordre"
                            >↓</button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground" title="Décalage fin (n'affecte pas le flux des autres membres)">Décalage</span>
                            <label className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">X</span>
                              <input
                                type="number"
                                value={offsetX}
                                onChange={(e) => setOffset({ autoLayoutOffsetX: Number(e.target.value) || undefined })}
                                className="w-14 border border-border rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">Y</span>
                              <input
                                type="number"
                                value={offsetY}
                                onChange={(e) => setOffset({ autoLayoutOffsetY: Number(e.target.value) || undefined })}
                                className="w-14 border border-border rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <p className="text-[11px] text-muted-foreground leading-5">
                  {autoLayoutMode === "column"
                    ? "En mode colonne, les blocs du groupe restent éditables, leur ordre peut etre forcé, et vous pouvez centrer exactement un bloc sur l'axe vertical."
                    : "En mode ligne, les blocs du groupe restent éditables, leur ordre peut etre forcé, et vous pouvez centrer exactement un bloc sur l'axe horizontal."}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-5">
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

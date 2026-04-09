import { compileTextTemplate } from "@/lib/textTemplate";
import type {
  AnyBlock,
  BlockConditionalRule,
  ConditionalBlockOverride,
  LayerGroup,
  TemplateFormSection,
  TemplateJSON,
  TextBlock,
} from "@/types/template";
import { normalizeGroupLayout } from "@/lib/groupLayout";
import { normalizeConditionMatch, normalizeFormSection, normalizeSchemaField } from "@/lib/schemaFields";

function normalizeLegacyOverride(override: ConditionalBlockOverride): BlockConditionalRule | null {
  const when = normalizeConditionMatch(override.when);
  if (!when) return null;
  return {
    when,
    effects: {
      ...(override.offsetX !== undefined ? { offsetX: override.offsetX } : {}),
      ...(override.offsetY !== undefined ? { offsetY: override.offsetY } : {}),
      ...(override.color !== undefined ? { textColor: override.color } : {}),
    },
  };
}

function normalizeBlockRules(block: AnyBlock): BlockConditionalRule[] | undefined {
  const rules: BlockConditionalRule[] = [];

  for (const rule of block.conditionalRules ?? []) {
    const when = normalizeConditionMatch(rule.when);
    if (!when) continue;
    rules.push({
      when,
      effects: {
        ...(rule.effects.visible !== undefined ? { visible: rule.effects.visible } : {}),
        ...(rule.effects.offsetX !== undefined ? { offsetX: rule.effects.offsetX } : {}),
        ...(rule.effects.offsetY !== undefined ? { offsetY: rule.effects.offsetY } : {}),
        ...(rule.effects.rotation !== undefined ? { rotation: rule.effects.rotation } : {}),
        ...(rule.effects.opacity !== undefined ? { opacity: rule.effects.opacity } : {}),
        ...(rule.effects.backgroundColor !== undefined ? { backgroundColor: rule.effects.backgroundColor } : {}),
        ...(rule.effects.textColor !== undefined ? { textColor: rule.effects.textColor } : {}),
      },
    });
  }

  const legacyShowIf = normalizeConditionMatch(block.showIf);
  if (legacyShowIf) {
    rules.unshift({ when: legacyShowIf, effects: { visible: true } });
  }

  for (const override of block.conditionalOverrides ?? []) {
    const normalized = normalizeLegacyOverride(override);
    if (normalized) rules.push(normalized);
  }

  return rules.length > 0 ? rules : undefined;
}

function normalizeBlock<T extends AnyBlock>(block: T): T {
  return {
    ...block,
    conditionalRules: normalizeBlockRules(block),
    showIf: undefined,
    conditionalOverrides: undefined,
  } as T;
}

function normalizeGroupRules(group: LayerGroup): BlockConditionalRule[] | undefined {
  const rules: BlockConditionalRule[] = [];

  for (const rule of group.conditionalRules ?? []) {
    const when = normalizeConditionMatch(rule.when);
    if (!when) continue;
    rules.push({
      when,
      effects: {
        ...(rule.effects.visible !== undefined ? { visible: rule.effects.visible } : {}),
        ...(rule.effects.offsetX !== undefined ? { offsetX: rule.effects.offsetX } : {}),
        ...(rule.effects.offsetY !== undefined ? { offsetY: rule.effects.offsetY } : {}),
      },
    });
  }

  return rules.length > 0 ? rules : undefined;
}

function normalizeLayerGroup(group: LayerGroup): LayerGroup {
  return {
    ...group,
    name: group.name?.trim() || "Groupe",
    hidden: Boolean(group.hidden),
    locked: Boolean(group.locked),
    collapsed: Boolean(group.collapsed),
    layout: normalizeGroupLayout(group.layout),
    conditionalRules: normalizeGroupRules(group),
  };
}

export function normalizeTemplateJSON(template: TemplateJSON): TemplateJSON {
  const normalizedSections = (template.formSections ?? [])
    .map((section) => normalizeFormSection(section))
    .filter((section): section is TemplateFormSection => section !== null);
  const seenSectionIds = new Set<string>();
  const formSections = normalizedSections.filter((section) => {
    if (seenSectionIds.has(section.id)) return false;
    seenSectionIds.add(section.id);
    return true;
  });
  const groups = (template.groups ?? []).map((group) => normalizeLayerGroup(group));
  const validGroupIds = new Set(groups.map((group) => group.id));
  const normalizedBlocks = (template.blocks ?? []).map((block) => {
    const normalized = normalizeBlock(block);
    if (!normalized.groupId || validGroupIds.has(normalized.groupId)) return normalized;
    return { ...normalized, groupId: undefined };
  });
  const blockIdsByGroup = new Map<string, Set<string>>();

  for (const block of normalizedBlocks) {
    if (!block.groupId) continue;
    if (!blockIdsByGroup.has(block.groupId)) blockIdsByGroup.set(block.groupId, new Set());
    blockIdsByGroup.get(block.groupId)?.add(block.id);
  }

  const sanitizedGroups = groups.map((group) => {
    const memberIds = blockIdsByGroup.get(group.id) ?? new Set<string>();
    if (!group.layout) return group;
    const nextOrder = (group.layout.order ?? []).filter((id) => memberIds.has(id));
    const anchorBlockId = group.layout.anchorBlockId && memberIds.has(group.layout.anchorBlockId)
      ? group.layout.anchorBlockId
      : undefined;
    return {
      ...group,
      layout: {
        ...group.layout,
        order: nextOrder.length > 0 ? nextOrder : undefined,
        anchorBlockId,
      },
    };
  });

  return {
    ...template,
    blocks: normalizedBlocks,
    groups: sanitizedGroups,
    formSections,
    schema: (template.schema ?? []).map((field) => {
      const normalizedField = normalizeSchemaField(field);
      if (normalizedField.sectionId && !seenSectionIds.has(normalizedField.sectionId)) {
        return { ...normalizedField, sectionId: undefined };
      }
      return normalizedField;
    }),
  };
}

export function serializeTemplateJSON(template: TemplateJSON): TemplateJSON {
  return normalizeTemplateJSON(template);
}

export function collectTemplateConditionValues(template: TemplateJSON): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();

  for (const block of template.blocks) {
    for (const rule of block.conditionalRules ?? []) {
      if (!values.has(rule.when.field)) values.set(rule.when.field, new Set());
      values.get(rule.when.field)?.add(rule.when.equals);
    }

    if (block.type === "text") {
      const textBlock = block as TextBlock;
      const content = textBlock.content ?? (textBlock.contentSegments ? compileTextTemplate(textBlock.contentSegments) : "");
      const matches = [...content.matchAll(/\{\{#if\s+(\w+)\s*==\s*"?([^"\}\s]+)"?\s*\}\}/g)];
      for (const [, field, value] of matches) {
        if (!values.has(field)) values.set(field, new Set());
        values.get(field)?.add(value);
      }
    }
  }

  return values;
}
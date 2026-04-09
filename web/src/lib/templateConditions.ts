import type {
  AnyBlock,
  BaseBlock,
  BlockConditionalRule,
  BlockConditionalEffects,
  BlockStyle,
  ConditionMatch,
  LayerGroup,
  SchemaField,
  TemplateFormSection,
} from "@/types/template";
import { normalizeConditionMatch } from "@/lib/schemaFields";

function hasVisualStyle(block: AnyBlock): block is AnyBlock & { style: BlockStyle } {
  return "style" in block;
}

function isShapeBlock(block: AnyBlock): block is Extract<AnyBlock, { type: "shape" }> {
  return block.type === "shape";
}

function isDpeBlock(block: AnyBlock): block is Extract<AnyBlock, { type: "dpe" }> {
  return block.type === "dpe";
}

export function matchesCondition(condition: ConditionMatch | undefined, listing: Record<string, unknown>): boolean {
  if (!condition) return true;
  const actual = String(listing[condition.field] ?? "");
  return actual === condition.equals;
}

function hasNonVisibilityEffects(effects: BlockConditionalEffects): boolean {
  return (
    effects.offsetX !== undefined ||
    effects.offsetY !== undefined ||
    effects.rotation !== undefined ||
    effects.opacity !== undefined ||
    effects.backgroundColor !== undefined ||
    effects.textColor !== undefined
  );
}

function resolveVisibility(hidden: boolean | undefined, rules: BlockConditionalRule[], listing: Record<string, unknown>): boolean {
  if (hidden) return false;

  const visibilityRules = rules.filter((rule) => rule.effects.visible !== undefined);
  if (visibilityRules.length === 0) return true;

  const matchedVisibility = visibilityRules.filter((rule) => matchesCondition(rule.when, listing));
  const hasHideRule = matchedVisibility.some((rule) => rule.effects.visible === false);
  if (hasHideRule) return false;
  const hasShowRule = matchedVisibility.some((rule) => rule.effects.visible === true);
  if (hasShowRule) return true;

  // Historical builder behavior created new rules with visible=true by default,
  // even when the user only wanted color/background/offset variations.
  // Preserve the base block visibility when no rule matches and every visibility
  // rule is only acting as a decorative variant on an already-visible block.
  const decorativeShowRules = visibilityRules.every((rule) => (
    rule.effects.visible === true && hasNonVisibilityEffects(rule.effects)
  ));

  return decorativeShowRules;
}

function resolveMatchedEffects(rules: BlockConditionalRule[], listing: Record<string, unknown>): BlockConditionalEffects {
  const effects: BlockConditionalEffects = {};

  for (const rule of rules) {
    if (!matchesCondition(rule.when, listing)) continue;

    if (rule.effects.offsetX !== undefined) effects.offsetX = rule.effects.offsetX;
    if (rule.effects.offsetY !== undefined) effects.offsetY = rule.effects.offsetY;
    if (rule.effects.rotation !== undefined) effects.rotation = rule.effects.rotation;
    if (rule.effects.opacity !== undefined) effects.opacity = rule.effects.opacity;
    if (rule.effects.backgroundColor !== undefined) effects.backgroundColor = rule.effects.backgroundColor;
    if (rule.effects.textColor !== undefined) effects.textColor = rule.effects.textColor;
  }

  return effects;
}

export function getGroupConditionalRules(group: LayerGroup | undefined): BlockConditionalRule[] {
  return group?.conditionalRules ?? [];
}

export function isBlockVisibleForListing(block: BaseBlock, listing: Record<string, unknown>, group?: LayerGroup): boolean {
  return resolveBlockState(block, listing, group).visible;
}

export function isSchemaFieldVisible(field: SchemaField, values: Record<string, unknown>): boolean {
  return matchesCondition(field.showIf, values);
}

export function matchesConditions(conditions: ConditionMatch[] | undefined, listing: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((condition) => matchesCondition(condition, listing));
}

export function isSectionComplete(
  fields: SchemaField[],
  values: Record<string, unknown>,
  mode: "all" | "required" = "all"
): boolean {
  const fieldsToCheck = mode === "required"
    ? fields.filter((field) => field.required)
    : fields;

  if (fieldsToCheck.length === 0) return false;

  return fieldsToCheck.every((field) => {
    const value = values[field.key];
    return !(value === undefined || value === null || value === "");
  });
}

export function isFormSectionVisible(
  section: TemplateFormSection,
  values: Record<string, unknown>,
  previousSectionComplete = true
): boolean {
  const conditionsMatch = matchesConditions(section.conditions ?? (section.showIf ? [section.showIf] : undefined), values);
  const progressionMatch = !section.revealWhenPreviousComplete || previousSectionComplete;
  return conditionsMatch && progressionMatch;
}

function legacyRules(block: BaseBlock): BlockConditionalRule[] {
  const rules: BlockConditionalRule[] = [];
  const showIf = normalizeConditionMatch(block.showIf);
  if (showIf) {
    rules.push({ when: showIf, effects: { visible: true } });
  }
  for (const override of block.conditionalOverrides ?? []) {
    const when = normalizeConditionMatch(override.when);
    if (!when) continue;
    rules.push({
      when,
      effects: {
        ...(override.offsetX !== undefined ? { offsetX: override.offsetX } : {}),
        ...(override.offsetY !== undefined ? { offsetY: override.offsetY } : {}),
        ...(override.color !== undefined ? { textColor: override.color } : {}),
      },
    });
  }
  return rules;
}

export function getBlockConditionalRules(block: BaseBlock): BlockConditionalRule[] {
  if (block.conditionalRules?.length) return block.conditionalRules;
  return legacyRules(block);
}

export function resolveBlockState<T extends BaseBlock>(block: T, listing: Record<string, unknown>, group?: LayerGroup): { visible: boolean; rules: BlockConditionalRule[] } {
  const groupRules = getGroupConditionalRules(group);
  const rules = getBlockConditionalRules(block);
  const groupVisible = resolveVisibility(group?.hidden, groupRules, listing);
  if (!groupVisible) return { visible: false, rules: [...groupRules, ...rules] };

  const blockVisible = resolveVisibility(block.hidden, rules, listing);
  return { visible: blockVisible, rules: [...groupRules, ...rules] };
}

export function resolveBlockForListing<T extends AnyBlock>(block: T, listing: Record<string, unknown>, group?: LayerGroup): T {
  const groupRules = getGroupConditionalRules(group);
  const rules = getBlockConditionalRules(block);
  const groupEffects = resolveMatchedEffects(groupRules, listing);
  if (rules.length === 0 && Object.keys(groupEffects).length === 0) return block;

  const groupOffsetX = groupEffects.offsetX ?? 0;
  const groupOffsetY = groupEffects.offsetY ?? 0;
  let resolvedX = block.x + groupOffsetX;
  let resolvedY = block.y + groupOffsetY;
  let resolvedRotation = block.rotation;
  let resolvedStyle = hasVisualStyle(block) ? block.style : undefined;
  let resolvedFillColor = isShapeBlock(block) ? block.fillColor : undefined;
  let resolvedShapeOpacity = isShapeBlock(block) ? block.opacity : undefined;
  let resolvedDpeBackground = isDpeBlock(block) ? block.backgroundColor : undefined;
  let changedPosition = groupOffsetX !== 0 || groupOffsetY !== 0;
  let changedBlock = false;
  let changedStyle = false;

  for (const rule of rules) {
    if (!matchesCondition(rule.when, listing)) continue;

    if (rule.effects.offsetX !== undefined) {
      resolvedX = block.x + groupOffsetX + rule.effects.offsetX;
      changedPosition = true;
    }
    if (rule.effects.offsetY !== undefined) {
      resolvedY = block.y + groupOffsetY + rule.effects.offsetY;
      changedPosition = true;
    }
    if (rule.effects.rotation !== undefined) {
      resolvedRotation = rule.effects.rotation;
      changedBlock = true;
    }
    if (rule.effects.textColor !== undefined && resolvedStyle) {
      if (!changedStyle) {
        resolvedStyle = { ...resolvedStyle };
        changedStyle = true;
      }
      resolvedStyle.color = rule.effects.textColor;
    }
    if (rule.effects.backgroundColor !== undefined) {
      if (resolvedStyle) {
        if (!changedStyle) {
          resolvedStyle = { ...resolvedStyle };
          changedStyle = true;
        }
        resolvedStyle.backgroundColor = rule.effects.backgroundColor;
      }
      if (isShapeBlock(block)) {
        resolvedFillColor = rule.effects.backgroundColor;
        changedBlock = true;
      } else if (isDpeBlock(block)) {
        resolvedDpeBackground = rule.effects.backgroundColor;
        changedBlock = true;
      }
    }
    if (rule.effects.opacity !== undefined) {
      if (resolvedStyle) {
        if (!changedStyle) {
          resolvedStyle = { ...resolvedStyle };
          changedStyle = true;
        }
        resolvedStyle.opacity = rule.effects.opacity;
      } else if (isShapeBlock(block)) {
        resolvedShapeOpacity = rule.effects.opacity;
        changedBlock = true;
      }
    }
  }

  if (!changedPosition && !changedStyle && !changedBlock) return block;

  return {
    ...block,
    ...(changedPosition ? { x: resolvedX, y: resolvedY } : {}),
    ...(changedBlock ? { rotation: resolvedRotation } : {}),
    ...(isShapeBlock(block) && changedBlock ? { fillColor: resolvedFillColor, opacity: resolvedShapeOpacity } : {}),
    ...(isDpeBlock(block) && changedBlock ? { backgroundColor: resolvedDpeBackground } : {}),
    ...(changedStyle && resolvedStyle ? { style: resolvedStyle } : {}),
  } as T;
}
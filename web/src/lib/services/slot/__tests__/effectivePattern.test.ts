/**
 * resolveSlotEffectivePattern — résolution legacy AccountPattern ↔ recette
 * PatternBinding pour les triggers auto.
 *
 * Régression visée (bug P2) : les slots créés via une recette ont
 * patternId=null + patternBindingId renseigné. Les triggers lisaient seulement
 * slot.pattern (legacy) → coverMode/needsDescription retombaient à "none" →
 * transcription/description/cover/transitions auto silencieusement skippées.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSlotEffectivePattern,
  type SlotWithEffectivePattern,
} from "@/lib/services/slot/effectivePattern";

type LegacyPattern = NonNullable<SlotWithEffectivePattern["pattern"]>;
type Binding = NonNullable<SlotWithEffectivePattern["patternBinding"]>;
type Template = NonNullable<SlotWithEffectivePattern["patternTemplate"]>;

function makeTemplate(over: Partial<Template> = {}): Template {
  return {
    source: "auto_template",
    templateId: "builder-tpl-mission",
    captionPresetId: "capt-mission",
    descriptionPromptId: "prompt-mission",
    coverMode: "autoPack",
    coverConfig: { coverPresetId: "preset-mission" },
    needsCaptions: false,
    needsCaptionsMode: "none",
    needsDescription: "autoGenerate",
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    ...over,
  } as Template;
}

function makeLegacyPattern(over: Partial<LegacyPattern> = {}): LegacyPattern {
  return {
    source: "auto_template",
    templateId: "tpl-legacy",
    captionPresetId: null,
    descriptionPromptId: "prompt-legacy",
    coverMode: "manualSelect",
    coverConfig: null,
    needsCaptions: false,
    needsCaptionsMode: "none",
    needsDescription: "manualWrite",
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    needsRushes: false,
    ...over,
  } as LegacyPattern;
}

function makeBinding(
  templateOver: Record<string, unknown> = {},
  bindingOver: Record<string, unknown> = {},
): Binding {
  const patternTemplate = {
    id: "tpl-1",
    label: "Recette RPI",
    source: "auto_template",
    templateId: "builder-tpl-1",
    coverMode: "autoPack",
    coverConfig: { coverPresetId: "preset-1" },
    needsDescription: "autoGenerate",
    needsCaptions: false,
    needsCaptionsMode: "none",
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    captionPresetId: "capt-tpl",
    descriptionPromptId: "prompt-tpl",
    ...templateOver,
  };
  return {
    id: "binding-1",
    accountId: "acc-1",
    patternTemplateId: "tpl-1",
    customLabel: null,
    dayOfWeek: [1],
    publishTime: "09:00",
    isActive: true,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
    templateIdOverride: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    patternTemplate,
    ...bindingOver,
  } as unknown as Binding;
}

describe("resolveSlotEffectivePattern", () => {
  it("legacy AccountPattern présent → renvoyé tel quel (slots historiques inchangés)", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: makeLegacyPattern({ coverMode: "manualSelect", needsDescription: "manualWrite" }),
      patternBinding: null,
      patternTemplate: null,
    });
    expect(eff?.coverMode).toBe("manualSelect");
    expect(eff?.needsDescription).toBe("manualWrite");
    expect(eff?.descriptionPromptId).toBe("prompt-legacy");
  });

  it("pattern null + binding (recette) → dérive du template (le cœur du fix)", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: null,
      patternBinding: makeBinding(),
      patternTemplate: null,
    });
    expect(eff).not.toBeNull();
    expect(eff?.coverMode).toBe("autoPack"); // avant le fix : "none"
    expect(eff?.needsDescription).toBe("autoGenerate"); // avant le fix : "none"
    expect(eff?.descriptionPromptId).toBe("prompt-tpl");
    expect(eff?.source).toBe("auto_template");
  });

  it("overrides du binding priment sur le template", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: null,
      patternBinding: makeBinding(
        { coverMode: "none", descriptionPromptId: "prompt-tpl" },
        { coverModeOverride: "autoPack", descriptionPromptIdOverride: "prompt-override" },
      ),
      patternTemplate: null,
    });
    expect(eff?.coverMode).toBe("autoPack");
    expect(eff?.descriptionPromptId).toBe("prompt-override");
  });

  it("legacy prioritaire sur binding quand les deux existent", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: makeLegacyPattern({ coverMode: "manualSelect" }),
      patternBinding: makeBinding({ coverMode: "autoPack" }),
      patternTemplate: null,
    });
    expect(eff?.coverMode).toBe("manualSelect");
  });

  it("mission : patternTemplate direct (sans compte ni binding) → dérive du template", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: null,
      patternBinding: null,
      patternTemplate: makeTemplate(),
    });
    expect(eff).not.toBeNull();
    expect(eff?.coverMode).toBe("autoPack");
    expect(eff?.needsDescription).toBe("autoGenerate");
    expect(eff?.descriptionPromptId).toBe("prompt-mission");
    expect(eff?.templateId).toBe("builder-tpl-mission");
    expect(eff?.source).toBe("auto_template");
  });

  it("mission : needsRushes dérivé de source === 'manual_rushes'", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: null,
      patternBinding: null,
      patternTemplate: makeTemplate({ source: "manual_rushes" }),
    });
    expect(eff?.needsRushes).toBe(true);
  });

  it("binding prioritaire sur patternTemplate direct quand les deux existent", () => {
    const eff = resolveSlotEffectivePattern({
      pattern: null,
      patternBinding: makeBinding({ coverMode: "autoPack" }),
      patternTemplate: makeTemplate({ coverMode: "manualSelect" }),
    });
    expect(eff?.coverMode).toBe("autoPack");
  });

  it("ni pattern ni binding ni template → null", () => {
    expect(
      resolveSlotEffectivePattern({ pattern: null, patternBinding: null, patternTemplate: null }),
    ).toBeNull();
  });
});

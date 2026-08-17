/**
 * Tests resolveEffectivePattern — résolution Template + Binding overrides.
 *
 * Invariants :
 *  1. Champs sans override : valeur du template.
 *  2. Override binding non null : prend le pas sur le template.
 *  3. needsRushes dérivé de source (manual_rushes ⇒ true).
 *  4. customLabel binding : override le label du template.
 *  5. Planning + assignations toujours portés par le binding.
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectivePattern,
  toPatternView,
} from "@/lib/services/pattern/resolveEffective";

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tpl-1",
    label: "Recette par défaut",
    source: "auto_template",
    templateId: "builder-tpl-A",
    coverMode: "autoPack",
    coverConfig: { foo: "bar" },
    needsDescription: "preFilled",
    needsCaptions: true,
    needsCaptionsMode: "auto",
    needsAdminValidation: false,
    needsClientValidation: true,
    allowsClientRevision: true,
    needsBrief: false,
    captionPresetId: "cap-A",
    descriptionPromptId: "prompt-A",
    isArchived: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBinding = any;

function makeBinding(overrides: Partial<Record<string, unknown>> = {}): AnyBinding {
  // Note : `patternTemplate` est extrait en premier pour que l'override
  // explicite des tests ait précédence sur le defaut. Sans ça, `...overrides`
  // mettrait le template custom avant le default qui finit par l'écraser.
  const { patternTemplate: tplOverride, ...rest } = overrides;
  return {
    id: "binding-1",
    accountId: "account-A",
    patternTemplateId: "tpl-1",
    customLabel: null,
    dayOfWeek: [1, 3, 5],
    publishTime: "09:00",
    isActive: true,
    defaultAssigneeMonteurId: "monteur-A",
    defaultAssigneeCmId: "cm-A",
    defaultAssigneeVideasteId: "videaste-A",
    templateIdOverride: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    patternTemplate: tplOverride ?? makeTemplate(),
  };
}

describe("resolveEffectivePattern", () => {
  it("Sans override : hérite tous les champs du template", () => {

    const eff = resolveEffectivePattern(makeBinding());
    expect(eff.label).toBe("Recette par défaut");
    expect(eff.source).toBe("auto_template");
    expect(eff.builderTemplateId).toBe("builder-tpl-A");
    expect(eff.captionPresetId).toBe("cap-A");
    expect(eff.descriptionPromptId).toBe("prompt-A");
    expect(eff.coverMode).toBe("autoPack");
    expect(eff.needsCaptionsMode).toBe("auto");
  });

  it("customLabel binding prend le pas sur template.label", () => {

    const eff = resolveEffectivePattern(
      makeBinding({ customLabel: "Variante compte X" }),
    );
    expect(eff.label).toBe("Variante compte X");
  });

  it("templateIdOverride est mort (V2.4) : le template du blueprint prime toujours", () => {
    const eff = resolveEffectivePattern(
      makeBinding({ templateIdOverride: "builder-tpl-B" }),
    );
    expect(eff.builderTemplateId).toBe(makeBinding({}).patternTemplate.templateId);
  });

  it("captionPresetIdOverride remplace template.captionPresetId", () => {

    const eff = resolveEffectivePattern(
      makeBinding({ captionPresetIdOverride: "cap-B" }),
    );
    expect(eff.captionPresetId).toBe("cap-B");
  });

  it("descriptionPromptIdOverride remplace template.descriptionPromptId", () => {

    const eff = resolveEffectivePattern(
      makeBinding({ descriptionPromptIdOverride: "prompt-B" }),
    );
    expect(eff.descriptionPromptId).toBe("prompt-B");
  });

  it("coverModeOverride remplace template.coverMode", () => {

    const eff = resolveEffectivePattern(
      makeBinding({ coverModeOverride: "monteurUpload" }),
    );
    expect(eff.coverMode).toBe("monteurUpload");
  });

  it("Planning + assignations portés par le binding (pas le template)", () => {

    const eff = resolveEffectivePattern(makeBinding());
    expect(eff.publishTime).toBe("09:00");
    expect(eff.dayOfWeek).toEqual([1, 3, 5]);
    expect(eff.defaultAssigneeMonteurId).toBe("monteur-A");
    expect(eff.defaultAssigneeCmId).toBe("cm-A");
    expect(eff.defaultAssigneeVideasteId).toBe("videaste-A");
  });

  it("needsRushes : true pour manual_rushes, false sinon", () => {

    const evManual = resolveEffectivePattern(
      makeBinding({ patternTemplate: makeTemplate({ source: "manual_rushes" }) }),
    );
    expect(evManual.needsRushes).toBe(true);


    const evAuto = resolveEffectivePattern(
      makeBinding({ patternTemplate: makeTemplate({ source: "auto_template" }) }),
    );
    expect(evAuto.needsRushes).toBe(false);


    const evExt = resolveEffectivePattern(
      makeBinding({ patternTemplate: makeTemplate({ source: "external_upload" }) }),
    );
    expect(evExt.needsRushes).toBe(false);
  });
});

describe("toPatternView", () => {
  it("Projette les valeurs résolues sur l'ancien contrat AccountPattern", () => {

    const legacy = toPatternView(
      makeBinding({
        customLabel: "Variante",
        captionPresetIdOverride: "cap-B",
      }),
    );
    expect(legacy.id).toBe("binding-1");
    expect(legacy.accountId).toBe("account-A");
    expect(legacy.label).toBe("Variante");
    expect(legacy.captionPresetId).toBe("cap-B");
    expect(legacy.source).toBe("auto_template");
    expect(legacy.needsRushes).toBe(false);
  });
});

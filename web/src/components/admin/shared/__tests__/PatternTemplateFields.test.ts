/**
 * encodePatternTemplateFieldsPayload — couverture ciblée du comportement clé
 * du Lot 2 (P7) : `descriptionDataLibraryId`/`descriptionDataSetTag` doivent
 * être OMIS du payload (clé absente, pas `null`) quand `needsDescription !==
 * "preFilled"`, pour que `toPatternTemplateUpdateData` ne touche jamais la
 * colonne — un save qui ne concerne pas ce mode ne doit jamais nuller
 * silencieusement une bibliothèque de légendes tournantes déjà épinglée en
 * base. Avant ce fix (revue bug-hunter, minor finding), ce comportement
 * n'était vérifié que manuellement — un futur refactor du spread
 * conditionnel ne serait pas détecté par la suite existante.
 */
import { describe, it, expect } from "vitest";
import {
  encodePatternTemplateFieldsPayload,
  type PatternTemplateFieldValues,
} from "@/components/admin/shared/PatternTemplateFields";

function baseValues(overrides: Partial<PatternTemplateFieldValues> = {}): PatternTemplateFieldValues {
  return {
    label: "Recette test",
    source: "manual_rushes",
    templateId: "",
    coverMode: "auto",
    needsCaptionsMode: "none",
    captionPresetId: "",
    needsDescription: "none",
    descriptionPromptId: "",
    descriptionSourceFieldKey: "",
    descriptionFixedText: "",
    descriptionDataLibraryId: "",
    descriptionDataSetTag: "",
    requiresEntityTypeId: "",
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    autoSaveToLibraryId: "",
    notes: "",
    ...overrides,
  };
}

describe("encodePatternTemplateFieldsPayload — descriptionDataLibraryId/descriptionDataSetTag", () => {
  it("omet les 2 clés quand needsDescription !== 'preFilled'", () => {
    const payload = encodePatternTemplateFieldsPayload(
      baseValues({ needsDescription: "autoGenerate", descriptionDataLibraryId: "lib-1", descriptionDataSetTag: "tag-1" }),
    );
    expect(payload).not.toHaveProperty("descriptionDataLibraryId");
    expect(payload).not.toHaveProperty("descriptionDataSetTag");
  });

  it("omet les 2 clés en mode 'none' même si des valeurs traînent dans le state local", () => {
    const payload = encodePatternTemplateFieldsPayload(
      baseValues({ needsDescription: "none", descriptionDataLibraryId: "lib-1", descriptionDataSetTag: "tag-1" }),
    );
    expect(payload).not.toHaveProperty("descriptionDataLibraryId");
    expect(payload).not.toHaveProperty("descriptionDataSetTag");
  });

  it("en mode preFilled avec une bibliothèque choisie, envoie les clés avec leurs valeurs", () => {
    const payload = encodePatternTemplateFieldsPayload(
      baseValues({ needsDescription: "preFilled", descriptionDataLibraryId: "lib-1", descriptionDataSetTag: "tag-1" }),
    );
    expect(payload.descriptionDataLibraryId).toBe("lib-1");
    expect(payload.descriptionDataSetTag).toBe("tag-1");
  });

  it("en mode preFilled + « Aucune » bibliothèque, envoie descriptionDataLibraryId=null explicite (efface une valeur existante)", () => {
    const payload = encodePatternTemplateFieldsPayload(
      baseValues({ needsDescription: "preFilled", descriptionDataLibraryId: "", descriptionDataSetTag: "" }),
    );
    expect(payload).toHaveProperty("descriptionDataLibraryId", null);
    expect(payload).toHaveProperty("descriptionDataSetTag", null);
  });

  it("en mode preFilled avec bibliothèque choisie mais sans dossier (setTag), envoie descriptionDataSetTag=null", () => {
    const payload = encodePatternTemplateFieldsPayload(
      baseValues({ needsDescription: "preFilled", descriptionDataLibraryId: "lib-1", descriptionDataSetTag: "" }),
    );
    expect(payload.descriptionDataLibraryId).toBe("lib-1");
    expect(payload).toHaveProperty("descriptionDataSetTag", null);
  });
});

/**
 * Tests validatePatternTemplateInput — gardes partagées POST/PATCH
 * /api/admin/patterns et sous-payload `template` de /recipes.
 *
 * Couvre en particulier les deux trous confirmés par l'audit avant
 * extraction :
 *  - autoSaveToLibraryId non protégé sur les routes /recipes (existence +
 *    type vidéo).
 *  - label vide accepté par PATCH /patterns/[id] mais refusé par
 *    /recipes/[bindingId].
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  validatePatternTemplateInput,
  toPatternTemplateCreateData,
  toPatternTemplateUpdateData,
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";

function makeFakePrisma(opts: {
  entityType?: unknown;
  mediaLibrary?: { id: string; type: string } | null;
  dataLibrary?: { id: string } | null;
  /** Une fiche du dossier demandé, ou null si le dossier n'existe pas. */
  dataEntry?: { id: string } | null;
} = {}): PrismaClient {
  return {
    entityType: {
      findUnique: vi.fn().mockResolvedValue(opts.entityType ?? null),
    },
    mediaLibrary: {
      findUnique: vi.fn().mockResolvedValue(opts.mediaLibrary ?? null),
    },
    dataLibrary: {
      findUnique: vi.fn().mockResolvedValue(opts.dataLibrary ?? null),
    },
    dataEntry: {
      findFirst: vi.fn().mockResolvedValue(opts.dataEntry ?? null),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaClient;
}

function validPayload(overrides: Partial<PatternTemplateInputPayload> = {}): PatternTemplateInputPayload {
  return {
    label: "Reels Lola",
    source: "auto_template",
    ...overrides,
  };
}

describe("validatePatternTemplateInput", () => {
  it("autoSaveToLibraryId inexistant → erreur", async () => {
    const prisma = makeFakePrisma({ mediaLibrary: null });
    const err = await validatePatternTemplateInput(
      validPayload({ autoSaveToLibraryId: "lib-inconnue" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/autoSaveToLibraryId.*introuvable/i);
  });

  it("autoSaveToLibraryId de type audio → erreur", async () => {
    const prisma = makeFakePrisma({ mediaLibrary: { id: "lib-audio", type: "audio" } });
    const err = await validatePatternTemplateInput(
      validPayload({ autoSaveToLibraryId: "lib-audio" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/autoSaveToLibraryId.*type vidéo/i);
  });

  it("autoSaveToLibraryId de type vidéo → accepté", async () => {
    const prisma = makeFakePrisma({ mediaLibrary: { id: "lib-video", type: "video" } });
    const err = await validatePatternTemplateInput(
      validPayload({ autoSaveToLibraryId: "lib-video" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toBeNull();
  });

  it("label vide (requireAll=false, ex. PATCH) → erreur", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(
      { label: "   " },
      { requireAll: false },
      prisma,
    );
    expect(err).toMatch(/label vide interdit/);
  });

  it("label manquant (requireAll=true, ex. POST) → erreur", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(
      { source: "auto_template" },
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/label requis/);
  });

  it("enum invalide (source) → erreur", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(
      validPayload({ source: "not_a_real_source" }),
      { requireAll: false },
      prisma,
    );
    expect(err).toMatch(/source invalide/);
  });

  it("enum invalide (coverMode) → erreur", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(
      validPayload({ coverMode: "not_a_real_mode" }),
      { requireAll: false },
      prisma,
    );
    expect(err).toMatch(/coverMode invalide/);
  });

  it("requiresEntityTypeId introuvable → erreur", async () => {
    const prisma = makeFakePrisma({ entityType: null });
    const err = await validatePatternTemplateInput(
      validPayload({ requiresEntityTypeId: "etype_inconnu" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/requiresEntityTypeId.*introuvable/i);
  });

  it("payload valide → ok (null)", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(validPayload(), { requireAll: true }, prisma);
    expect(err).toBeNull();
  });

  it("fieldPrefix préfixe les messages d'erreur (parité avec le sous-payload template des routes /recipes)", async () => {
    const prisma = makeFakePrisma();
    const err = await validatePatternTemplateInput(
      { label: "   " },
      { requireAll: false, fieldPrefix: "template." },
      prisma,
    );
    expect(err).toBe("template.label vide interdit");
  });

  it("descriptionDataLibraryId inexistante → erreur", async () => {
    const prisma = makeFakePrisma({ dataLibrary: null });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataLibraryId: "datalib-inconnue" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/descriptionDataLibraryId.*introuvable/i);
  });

  it("descriptionDataLibraryId existante → accepté (pas de contrôle de type)", async () => {
    const prisma = makeFakePrisma({ dataLibrary: { id: "datalib-1" } });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataLibraryId: "datalib-1" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toBeNull();
  });

  it("descriptionDataSetTag sans bibliothèque → erreur (le dossier est une sous-sélection)", async () => {
    const prisma = makeFakePrisma({ dataLibrary: { id: "datalib-1" }, dataEntry: { id: "e1" } });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataSetTag: "RTEXT12" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/descriptionDataSetTag.*bibliothèque de données/i);
  });

  it("descriptionDataSetTag inexistant dans la bibliothèque → erreur", async () => {
    const prisma = makeFakePrisma({ dataLibrary: { id: "datalib-1" }, dataEntry: null });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataLibraryId: "datalib-1", descriptionDataSetTag: "RTEXT99" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toMatch(/dossier.*RTEXT99.*introuvable/i);
  });

  it("descriptionDataSetTag existant dans la bibliothèque → accepté", async () => {
    const prisma = makeFakePrisma({ dataLibrary: { id: "datalib-1" }, dataEntry: { id: "e1" } });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataLibraryId: "datalib-1", descriptionDataSetTag: "RTEXT12" }),
      { requireAll: true },
      prisma,
    );
    expect(err).toBeNull();
  });

  it("descriptionDataSetTag blanc → ignoré (= tous les dossiers), aucune requête dossier", async () => {
    const prisma = makeFakePrisma({ dataLibrary: { id: "datalib-1" } });
    const err = await validatePatternTemplateInput(
      validPayload({ descriptionDataLibraryId: "datalib-1", descriptionDataSetTag: "   " }),
      { requireAll: true },
      prisma,
    );
    expect(err).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).dataEntry.findFirst).not.toHaveBeenCalled();
  });
});

describe("toPatternTemplateCreateData / toPatternTemplateUpdateData — mapping descriptionDataLibraryId", () => {
  it("create : reprend descriptionDataLibraryId tel quel, null par défaut", () => {
    expect(
      toPatternTemplateCreateData(validPayload({ descriptionDataLibraryId: "datalib-1" }), "user-1")
        .descriptionDataLibraryId,
    ).toBe("datalib-1");
    expect(toPatternTemplateCreateData(validPayload(), "user-1").descriptionDataLibraryId).toBeNull();
  });

  it("update : absent du payload → champ omis (pas touché) ; présent (y compris null) → appliqué", () => {
    expect(toPatternTemplateUpdateData({}, "user-1")).not.toHaveProperty("descriptionDataLibraryId");
    expect(
      toPatternTemplateUpdateData({ descriptionDataLibraryId: "datalib-2" }, "user-1")
        .descriptionDataLibraryId,
    ).toBe("datalib-2");
    expect(
      toPatternTemplateUpdateData({ descriptionDataLibraryId: null }, "user-1").descriptionDataLibraryId,
    ).toBeNull();
  });
});

describe("mapping descriptionDataSetTag — le dossier suit toujours la bibliothèque", () => {
  it("create : trimmé, et forcé à null sans bibliothèque", () => {
    expect(
      toPatternTemplateCreateData(
        validPayload({ descriptionDataLibraryId: "datalib-1", descriptionDataSetTag: "  RTEXT12  " }),
        "user-1",
      ).descriptionDataSetTag,
    ).toBe("RTEXT12");
    expect(
      toPatternTemplateCreateData(validPayload({ descriptionDataSetTag: "RTEXT12" }), "user-1")
        .descriptionDataSetTag,
    ).toBeNull();
    expect(toPatternTemplateCreateData(validPayload(), "user-1").descriptionDataSetTag).toBeNull();
  });

  it("update : ni lib ni dossier dans le payload → champ omis", () => {
    expect(toPatternTemplateUpdateData({}, "user-1")).not.toHaveProperty("descriptionDataSetTag");
  });

  it("update : bibliothèque retirée → dossier remis à null même s'il est fourni", () => {
    expect(
      toPatternTemplateUpdateData(
        { descriptionDataLibraryId: null, descriptionDataSetTag: "RTEXT12" },
        "user-1",
      ).descriptionDataSetTag,
    ).toBeNull();
  });

  it("update : bibliothèque changée sans dossier → dépinglage", () => {
    expect(
      toPatternTemplateUpdateData({ descriptionDataLibraryId: "datalib-2" }, "user-1")
        .descriptionDataSetTag,
    ).toBeNull();
  });

  it("update : dossier seul → appliqué trimmé ; chaîne blanche → null", () => {
    expect(
      toPatternTemplateUpdateData({ descriptionDataSetTag: " RTEXT1 " }, "user-1").descriptionDataSetTag,
    ).toBe("RTEXT1");
    expect(
      toPatternTemplateUpdateData({ descriptionDataSetTag: "  " }, "user-1").descriptionDataSetTag,
    ).toBeNull();
  });
});

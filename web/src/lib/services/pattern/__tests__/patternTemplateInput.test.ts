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
  type PatternTemplateInputPayload,
} from "@/lib/services/pattern/patternTemplateInput";

function makeFakePrisma(opts: {
  entityType?: unknown;
  mediaLibrary?: { id: string; type: string } | null;
} = {}): PrismaClient {
  return {
    entityType: {
      findUnique: vi.fn().mockResolvedValue(opts.entityType ?? null),
    },
    mediaLibrary: {
      findUnique: vi.fn().mockResolvedValue(opts.mediaLibrary ?? null),
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
});

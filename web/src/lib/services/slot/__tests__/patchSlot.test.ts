/**
 * Tests d'intégration sur patchSlot — fige les invariants critiques
 * découverts par l'audit calendrier :
 *
 *  1. canTransition est enforced côté service (pas seulement côté UI)
 *  2. PATCH status=PUBLISHED est bloqué même pour ADMIN (forcer /mark-published)
 *  3. patternBindingId d'un autre compte refusé
 *  4. cross-field validation utilise le NOUVEAU pattern quand patternBindingId change
 *  5. assigneeVideasteId loggué dans ASSIGNEE_CHANGED
 *  6. scoping non-admin → NotFoundError
 *  7. mission account-less (patternBindingId null, patternTemplateId direct) :
 *     la validation cross-field doit résoudre via la branche patternTemplate
 *     directe de resolveSlotEffectivePattern, pas seulement patternBinding —
 *     sinon un slot avec preset/prompt hérité du template throw à tort
 *     (bug audit 2026-08-18, cf. les fixtures avant ce test n'avaient
 *     jamais patternBinding: null + patternTemplate non-null).
 *
 * Prisma est mocké au niveau module — tests vitest unit purs, pas de DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockSlotFindUnique = vi.fn();
const mockSlotUpdate = vi.fn();
const mockSlotUpdateMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();
// patchSlot résout l'effective pattern via PatternBinding (canonique).
const mockBindingFindUnique = vi.fn().mockResolvedValue(null);
// Fiche (Entity, Phase 5) — bloc de (re)rattachement propertyId.
const mockEntityFindUnique = vi.fn().mockResolvedValue({ fields: "{}" });
// Légende bibliothèque de données (Phase 2) — orchestrateur + claim, mockés
// directement. Passthrough par défaut vers l'implémentation réelle (pure
// quand descriptionDataLibraryId est absent) pour ne pas casser les tests
// existants qui ne touchent pas propertyId.
const mockResolveCaptionWithDataLibrary = vi.fn();
const mockClaimDataEntryForCaption = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
      update: (...args: unknown[]) => mockSlotUpdate(...args),
      updateMany: (...args: unknown[]) => mockSlotUpdateMany(...args),
    },
    patternBinding: {
      findUnique: (...args: unknown[]) => mockBindingFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    entity: {
      findUnique: (...args: unknown[]) => mockEntityFindUnique(...args),
    },
    publicationActivity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
}));

vi.mock("@/lib/publications/captionDataLibrary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publications/captionDataLibrary")>();
  return {
    ...actual,
    // Wrapper LAZY — cf. createSlot.test.ts pour l'explication détaillée
    // (un `.mockImplementation` eager ici tape dans la TDZ des const "mock*").
    resolveCaptionWithDataLibrary: (
      ...args: Parameters<typeof actual.resolveCaptionWithDataLibrary>
    ) => {
      if (!mockResolveCaptionWithDataLibrary.getMockImplementation()) {
        mockResolveCaptionWithDataLibrary.mockImplementation(actual.resolveCaptionWithDataLibrary);
      }
      return mockResolveCaptionWithDataLibrary(...args);
    },
  };
});

vi.mock("@/lib/contentLibraryResolver", () => ({
  claimDataEntryForCaption: (...args: unknown[]) => mockClaimDataEntryForCaption(...args),
}));

// Import APRES le mock
import { patchSlot } from "@/lib/services/slot/slotService";
import {
  ForbiddenError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeUserCtx(role: "ADMIN" | "MONTEUR" | "CM" | "VIDEASTE", userId = "user-1") {
  return {
    session: {} as unknown,
    actualUser: { id: userId, role, name: null, email: null, permissions: "[]" },
    effectiveUser: { id: userId, role, name: null, email: null, permissions: "[]" },
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof patchSlot>[2];
}

interface SlotFixture {
  id: string;
  status: string;
  accountId: string;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  assigneeVideasteId: string | null;
  needsCaptionsOverride: boolean | null;
  needsDescriptionOverride: string | null;
  captionPresetIdOverride: string | null;
  descriptionPromptIdOverride: string | null;
  coverModeOverride: string | null;
  coverPresetIdOverride: string | null;
  patternBinding: {
    captionPresetIdOverride: string | null;
    descriptionPromptIdOverride: string | null;
    coverModeOverride: string | null;
    patternTemplate: {
      captionPresetId: string | null;
      descriptionPromptId: string | null;
      needsCaptions: boolean;
      needsDescription: string;
      coverMode: string;
      coverConfig: unknown;
    };
  } | null;
  /**
   * Recette globale directe (mission account-less, patternBindingId null +
   * patternTemplateId non-null) — branche 2 de resolveSlotEffectivePattern,
   * chargée via slotEffectivePatternSelect dans le select réel de patchSlot.
   */
  patternTemplate: {
    id: string;
    label: string;
    source: string;
    templateId: string | null;
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    coverMode: string;
    coverConfig: unknown;
    needsCaptionsMode: string;
    needsDescription: string;
    descriptionSourceFieldKey: string | null;
    descriptionFixedText: string | null;
    descriptionDataLibraryId: string | null;
    needsAdminValidation: boolean;
    needsClientValidation: boolean;
    allowsClientRevision: boolean;
    needsBrief: boolean;
    requiresProperty: boolean;
    requiresEntityTypeId: string | null;
  } | null;
  /** Fiche tournage (fixe) — fiche data < fiche tournage, cf. captionDataLibrary. */
  shootEntity: { fields: string } | null;
  /** DataEntry mémorisée par un tirage précédent (légende bibliothèque). */
  captionDataEntry: { id: string; fields: string; setTag: string | null; libraryId: string } | null;
}

/** PatternBinding mock complet (chemin canonique du changement de recette). */
function makeBindingRow(
  templateOver: Record<string, unknown> = {},
  bindingOver: Record<string, unknown> = {},
) {
  return {
    id: "binding-A",
    accountId: "account-A",
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    patternTemplate: {
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      ...templateOver,
    },
    ...bindingOver,
  };
}

/** PatternTemplate mock direct (mission account-less, sans binding). */
function makeTemplateRow(over: Record<string, unknown> = {}) {
  return {
    id: "template-mission",
    label: "Mission recette",
    source: "auto_template",
    templateId: null,
    captionPresetId: null,
    descriptionPromptId: null,
    coverMode: "none",
    coverConfig: null,
    needsCaptionsMode: "none",
    needsDescription: "none",
    descriptionSourceFieldKey: null,
    descriptionFixedText: null,
    descriptionDataLibraryId: null,
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    requiresProperty: false,
    requiresEntityTypeId: null,
    ...over,
  };
}

function makeSlot(overrides: Partial<SlotFixture> = {}): SlotFixture {
  return {
    id: "slot-1",
    status: "DRAFT",
    accountId: "account-A",
    assigneeMonteurId: "user-monteur",
    assigneeCmId: "user-cm",
    assigneeVideasteId: "user-videaste",
    needsCaptionsOverride: null,
    needsDescriptionOverride: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    coverPresetIdOverride: null,
    patternBinding: {
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      patternTemplate: {
        captionPresetId: null,
        descriptionPromptId: null,
        needsCaptions: false,
        needsDescription: "none",
        coverMode: "none",
        coverConfig: null,
      },
    },
    patternTemplate: null,
    shootEntity: null,
    captionDataEntry: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSlotFindUnique.mockReset();
  mockSlotUpdate.mockReset();
  mockSlotUpdateMany.mockReset();
  mockBindingFindUnique.mockReset().mockResolvedValue(null);
  mockUserFindUnique.mockReset();
  mockEntityFindUnique.mockReset().mockResolvedValue({ fields: "{}" });
  mockActivityCreate.mockReset();
  mockTransaction.mockReset();
  // mockClear (pas mockReset) : garde le passthrough par défaut posé dans
  // vi.mock ci-dessus, ne vide que l'historique d'appels.
  mockResolveCaptionWithDataLibrary.mockClear();
  mockClaimDataEntryForCaption.mockReset().mockResolvedValue(true);

  // Default : update renvoie le slot mis à jour
  mockSlotUpdate.mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    return Promise.resolve({
      id: where.id,
      ...data,
      account: { id: "account-A", name: "Test", handle: "test" },
      template: null,
      render: null,
      fields: "{}",
      fieldSchema: "[]",
    });
  });

  // Default : $transaction proxie le callback avec un tx object identique
  // au prisma mocké. Sans ça, mockTransaction renvoie undefined et patchSlot
  // throw quand il accède aux propriétés du résultat.
  mockTransaction.mockImplementation((cb: unknown) => {
    if (typeof cb !== "function") return Promise.resolve(undefined);
    const tx = {
      publicationSlot: {
        findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
        update: (...args: unknown[]) => mockSlotUpdate(...args),
        updateMany: (...args: unknown[]) => mockSlotUpdateMany(...args),
      },
      publicationActivity: {
        create: (...args: unknown[]) => mockActivityCreate(...args),
      },
    };
    return Promise.resolve((cb as (tx: unknown) => Promise<unknown>)(tx));
  });
});

// ─── Invariant 1 : canTransition enforced côté service ─────────────────────

describe("patchSlot — canTransition enforcement", () => {
  it("MONTEUR ne peut pas sauter DRAFT → SCHEDULED (skipping pipeline)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ status: "DRAFT", assigneeMonteurId: "user-monteur" }),
    );

    await expect(
      patchSlot("slot-1", { status: "SCHEDULED" }, makeUserCtx("MONTEUR", "user-monteur")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("MONTEUR ne peut pas sauter EDIT_REVIEW → READY_FOR_CM (bypass validation CM)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ status: "EDIT_REVIEW", assigneeMonteurId: "user-monteur" }),
    );

    await expect(
      patchSlot("slot-1", { status: "READY_FOR_CM" }, makeUserCtx("MONTEUR", "user-monteur")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ADMIN bypass : DRAFT → SCHEDULED accepté", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot({ status: "DRAFT" }));

    const result = await patchSlot(
      "slot-1",
      { status: "SCHEDULED" },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
    expect(mockSlotUpdate).toHaveBeenCalled();
  });

  it("MONTEUR : transition légitime IN_EDIT → EDIT_REVIEW acceptée", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ status: "IN_EDIT", assigneeMonteurId: "user-monteur" }),
    );

    const result = await patchSlot(
      "slot-1",
      { status: "EDIT_REVIEW" },
      makeUserCtx("MONTEUR", "user-monteur"),
    );
    expect(result).toBeDefined();
  });
});

// ─── Invariant 2 : PATCH PUBLISHED bloqué (même ADMIN) ─────────────────────

describe("patchSlot — PUBLISHED bypass /mark-published", () => {
  it("ADMIN ne peut pas PATCH status=PUBLISHED directement", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot({ status: "SCHEDULED" }));

    await expect(
      patchSlot("slot-1", { status: "PUBLISHED" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ADMIN PATCH status=PUBLISHED : message guide vers /mark-published", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot({ status: "SCHEDULED" }));

    await expect(
      patchSlot("slot-1", { status: "PUBLISHED" }, makeUserCtx("ADMIN")),
    ).rejects.toThrow(/Marquer publié|mark-published/i);
  });

  it("CM ne peut pas non plus (bloqué d'abord par RESERVED_TERMINAL_STATUSES)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ status: "SCHEDULED", assigneeCmId: "user-cm" }),
    );

    await expect(
      patchSlot("slot-1", { status: "PUBLISHED" }, makeUserCtx("CM", "user-cm")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── Invariant 3 : patternBindingId (binding) cross-account refusé ─────────────────

describe("patchSlot — patternBindingId cross-account guard", () => {
  it("ADMIN ne peut pas attribuer une recette d'un autre compte", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(makeSlot({ accountId: "account-A" }))
      .mockResolvedValueOnce({ accountId: "account-A" }); // re-fetch pour slotAccount

    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({}, { id: "binding-B", accountId: "account-B" }), // ← autre compte !
    );

    await expect(
      patchSlot("slot-1", { patternBindingId: "binding-B" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("patternBindingId d'une recette inexistante rejeté", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    mockBindingFindUnique.mockResolvedValueOnce(null);

    await expect(
      patchSlot("slot-1", { patternBindingId: "binding-ghost" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("patternBindingId du même compte accepté", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(makeSlot({ accountId: "account-A" }))
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockBindingFindUnique.mockResolvedValueOnce(makeBindingRow()); // ← même compte

    const result = await patchSlot(
      "slot-1",
      { patternBindingId: "binding-A" },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });
});

// ─── Invariant 4 : cross-field validation utilise NOUVEAU pattern ──────────

describe("patchSlot — cross-field validation post-update pattern", () => {
  it("change patternBindingId vers une recette sans captionPresetId + active needsCaptionsModeOverride → rejet", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(
        makeSlot({
          patternBinding: {
            captionPresetIdOverride: null,
            descriptionPromptIdOverride: null,
            coverModeOverride: null,
            patternTemplate: {
              captionPresetId: "preset-X", // ANCIENNE recette AVAIT un preset
              descriptionPromptId: null,
              needsCaptions: false,
              needsDescription: "none",
              coverMode: "none",
              coverConfig: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({ captionPresetId: null }), // NOUVELLE recette n'a PAS de preset
    );

    await expect(
      patchSlot(
        "slot-1",
        { patternBindingId: "binding-new", needsCaptionsModeOverride: "auto" },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("change patternBindingId vers une recette AVEC captionPresetId + needsCaptionsOverride → accepté", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(
        makeSlot({
          patternBinding: {
            captionPresetIdOverride: null,
            descriptionPromptIdOverride: null,
            coverModeOverride: null,
            patternTemplate: {
              captionPresetId: null,
              descriptionPromptId: null,
              needsCaptions: false,
              needsDescription: "none",
              coverMode: "none",
              coverConfig: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({ captionPresetId: "preset-new" }), // ← nouvelle recette AVEC preset
    );

    const result = await patchSlot(
      "slot-1",
      { patternBindingId: "binding-new", needsCaptionsModeOverride: "auto" },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });
});

// ─── Invariant 5 : ASSIGNEE_CHANGED log inclut vidéaste ─────────────────────

describe("patchSlot — ASSIGNEE_CHANGED log inclut le vidéaste", () => {
  it("change assigneeVideasteId déclenche un log d'activité", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ assigneeVideasteId: "old-videaste" }),
    );
    mockUserFindUnique.mockResolvedValueOnce({ role: "VIDEASTE" });

    await patchSlot(
      "slot-1",
      { assigneeVideasteId: "new-videaste" },
      makeUserCtx("ADMIN"),
    );

    // L'activity create a été appelé
    expect(mockActivityCreate).toHaveBeenCalled();
    const call = mockActivityCreate.mock.calls.find((c) => {
      const data = (c[0] as { data?: { type?: string } }).data;
      return data?.type === "ASSIGNEE_CHANGED";
    });
    expect(call).toBeDefined();
    // Le payload peut être stringifié (logActivity persiste un String JSON
    // selon le schéma Prisma) ou laissé en objet par le mock.
    const payloadRaw = (call![0] as { data: { payload: unknown } }).data.payload;
    const payload =
      typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw;
    expect(payload).toHaveProperty("videaste");
    expect((payload as { videaste: unknown }).videaste).toEqual({
      from: "old-videaste",
      to: "new-videaste",
    });
  });
});

// ─── Invariant 6 : non-admin sans accès → NotFoundError (anti-énumération) ──

describe("patchSlot — scoping", () => {
  it("MONTEUR non assigné à ce slot reçoit NotFoundError, pas Forbidden", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        assigneeMonteurId: "other-monteur", // ← pas l'user
      }),
    );

    await expect(
      patchSlot("slot-1", { notes: "test" }, makeUserCtx("MONTEUR", "user-monteur")),
    ).rejects.toMatchObject({ message: expect.stringMatching(/introuvable/i) });
  });
});

// ─── Invariant 7 : mission account-less — branche patternTemplate directe ──

describe("patchSlot — mission account-less (patternBindingId null, patternTemplateId direct)", () => {
  it('override captions "auto" + preset hérité du patternTemplate direct → PAS de throw', async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        patternBinding: null,
        patternTemplate: makeTemplateRow({ captionPresetId: "preset-mission" }),
      }),
    );

    const result = await patchSlot(
      "slot-1",
      { needsCaptionsModeOverride: "auto" },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });

  it("mode auto hérité du patternTemplate direct sans preset nulle part → throw", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        patternBinding: null,
        patternTemplate: makeTemplateRow({ needsCaptionsMode: "auto", captionPresetId: null }),
      }),
    );

    await expect(
      patchSlot("slot-1", { notes: "test" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Légende bibliothèque de données (Phase 2) ──────────────────────────────
// Rattachement/re-rattachement d'une fiche (propertyId fourni, description
// omise) sur une recette avec descriptionDataLibraryId — cf.
// `resolveCaptionWithDataLibrary` (mocké directement, cf. beforeEach).

describe("patchSlot — légende pré-remplie depuis une DataLibrary (rattachement de fiche)", () => {
  function makeSlotWithLibrary(overrides: Partial<SlotFixture> = {}) {
    return makeSlot({
      patternBinding: null,
      patternTemplate: makeTemplateRow({
        needsDescription: "preFilled",
        descriptionFixedText: "Bonjour {{ville}}",
        descriptionDataLibraryId: "lib-1",
      }),
      ...overrides,
    });
  }

  it("entrée déjà mémorisée (captionDataEntry) → réutilisée sans re-tirer, captionDataEntryId inchangé, aucun claim", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlotWithLibrary({
        captionDataEntry: { id: "entry-old", fields: '{"ville":"Lyon"}', setTag: "vitrine", libraryId: "lib-1" },
      }),
    );
    mockEntityFindUnique.mockResolvedValueOnce({ fields: '{"prix":"200000"}' });
    mockResolveCaptionWithDataLibrary.mockResolvedValueOnce({
      caption: "Bonjour Lyon",
      usedEntry: { entryId: "entry-old", fields: { ville: "Lyon" }, setTag: "vitrine", libraryId: "lib-1" },
      drewNewEntry: false,
    });

    const result = await patchSlot("slot-1", { propertyId: "prop-1" }, makeUserCtx("ADMIN"));

    expect(result.description).toBe("Bonjour Lyon");
    // storedEntry transmis = l'entrée mémorisée sur le slot (reuse, pas de redraw).
    expect(mockResolveCaptionWithDataLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-A",
        storedEntry: { id: "entry-old", fields: '{"ville":"Lyon"}', setTag: "vitrine", libraryId: "lib-1" },
      }),
    );
    // Pas de redraw → pas de nouvelle entrée à persister.
    const updateCallData = mockSlotUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(updateCallData.data).not.toHaveProperty("captionDataEntryId");
    expect(mockClaimDataEntryForCaption).not.toHaveBeenCalled();

    const call = mockActivityCreate.mock.calls.find(
      (c) => (c[0] as { data?: { type?: string } }).data?.type === "DESCRIPTION_PREFILLED",
    );
    expect(call).toBeDefined();
    const payloadRaw = (call![0] as { data: { payload: unknown } }).data.payload;
    const payload = typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw;
    expect(payload).toMatchObject({ entryId: "entry-old", reusedEntry: true });
  });

  it("aucune entrée mémorisée → premier tirage, captionDataEntryId persisté, claim appelé post-commit", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlotWithLibrary({ captionDataEntry: null }),
    );
    mockResolveCaptionWithDataLibrary.mockResolvedValueOnce({
      caption: "Bonjour Nice",
      usedEntry: { entryId: "entry-new", fields: { ville: "Nice" }, setTag: "vitrine", libraryId: "lib-1" },
      drewNewEntry: true,
    });

    const result = await patchSlot("slot-1", { propertyId: "prop-1" }, makeUserCtx("ADMIN"));

    expect(result.description).toBe("Bonjour Nice");
    expect(result.captionDataEntryId).toBe("entry-new");
    expect(mockClaimDataEntryForCaption).toHaveBeenCalledWith("entry-new", "account-A");

    const call = mockActivityCreate.mock.calls.find(
      (c) => (c[0] as { data?: { type?: string } }).data?.type === "DESCRIPTION_PREFILLED",
    );
    const payloadRaw = (call![0] as { data: { payload: unknown } }).data.payload;
    const payload = typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw;
    expect(payload).toMatchObject({ entryId: "entry-new", reusedEntry: false });
  });

  it("claim en échec (best-effort) ne fait pas échouer le PATCH", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlotWithLibrary({ captionDataEntry: null }),
    );
    mockResolveCaptionWithDataLibrary.mockResolvedValueOnce({
      caption: "Bonjour Nice",
      usedEntry: { entryId: "entry-new", fields: { ville: "Nice" }, setTag: "vitrine", libraryId: "lib-1" },
      drewNewEntry: true,
    });
    mockClaimDataEntryForCaption.mockResolvedValueOnce(false);

    const result = await patchSlot("slot-1", { propertyId: "prop-1" }, makeUserCtx("ADMIN"));

    expect(result.description).toBe("Bonjour Nice");
    expect(result.captionDataEntryId).toBe("entry-new");
  });

  it("détachement de la fiche (propertyId: null) → pas de résolution de légende, aucun claim", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlotWithLibrary({ captionDataEntry: { id: "entry-old", fields: "{}", setTag: null, libraryId: "lib-1" } }),
    );

    const result = await patchSlot("slot-1", { propertyId: null }, makeUserCtx("ADMIN"));

    expect(result).toBeDefined();
    expect(mockResolveCaptionWithDataLibrary).not.toHaveBeenCalled();
    expect(mockClaimDataEntryForCaption).not.toHaveBeenCalled();
  });
});


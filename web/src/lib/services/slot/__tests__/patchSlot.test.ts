/**
 * Tests d'intégration sur patchSlot — fige les invariants critiques
 * découverts par l'audit calendrier :
 *
 *  1. canTransition est enforced côté service (pas seulement côté UI)
 *  2. PATCH status=PUBLISHED est bloqué même pour ADMIN (forcer /mark-published)
 *  3. patternId d'un autre compte refusé
 *  4. cross-field validation utilise le NOUVEAU pattern quand patternId change
 *  5. assigneeVideasteId loggué dans ASSIGNEE_CHANGED
 *
 * Prisma est mocké au niveau module — tests vitest unit purs, pas de DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockSlotFindUnique = vi.fn();
const mockSlotUpdate = vi.fn();
const mockSlotUpdateMany = vi.fn();
const mockPatternFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
      update: (...args: unknown[]) => mockSlotUpdate(...args),
      updateMany: (...args: unknown[]) => mockSlotUpdateMany(...args),
    },
    accountPattern: {
      findUnique: (...args: unknown[]) => mockPatternFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    publicationActivity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
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
  pattern: {
    captionPresetId: string | null;
    descriptionPromptId: string | null;
    needsCaptions: boolean;
    needsDescription: string;
    coverMode: string;
    coverConfig: unknown;
  } | null;
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
    pattern: {
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockSlotFindUnique.mockReset();
  mockSlotUpdate.mockReset();
  mockSlotUpdateMany.mockReset();
  mockPatternFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockActivityCreate.mockReset();
  mockTransaction.mockReset();

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

// ─── Invariant 3 : patternId cross-account refusé ───────────────────────────

describe("patchSlot — patternId cross-account guard", () => {
  it("ADMIN ne peut pas attribuer un pattern d'un autre compte", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(makeSlot({ accountId: "account-A" }))
      .mockResolvedValueOnce({ accountId: "account-A" }); // re-fetch pour slotAccount

    mockPatternFindUnique.mockResolvedValueOnce({
      accountId: "account-B", // ← autre compte !
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
    });

    await expect(
      patchSlot("slot-1", { patternId: "pattern-B" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("patternId d'un pattern inexistant rejeté", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    mockPatternFindUnique.mockResolvedValueOnce(null);

    await expect(
      patchSlot("slot-1", { patternId: "pattern-ghost" }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("patternId du même compte accepté", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(makeSlot({ accountId: "account-A" }))
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockPatternFindUnique.mockResolvedValueOnce({
      accountId: "account-A", // ← même compte
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
    });

    const result = await patchSlot(
      "slot-1",
      { patternId: "pattern-A" },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });
});

// ─── Invariant 4 : cross-field validation utilise NOUVEAU pattern ──────────

describe("patchSlot — cross-field validation post-update pattern", () => {
  it("change patternId vers un pattern sans captionPresetId + active needsCaptionsOverride → rejet", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(
        makeSlot({
          pattern: {
            captionPresetId: "preset-X", // ANCIEN pattern AVAIT un preset
            descriptionPromptId: null,
            needsCaptions: false,
            needsDescription: "none",
            coverMode: "none",
            coverConfig: null,
          },
        }),
      )
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockPatternFindUnique.mockResolvedValueOnce({
      accountId: "account-A",
      captionPresetId: null, // NOUVEAU pattern n'a PAS de preset
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
    });

    await expect(
      patchSlot(
        "slot-1",
        { patternId: "pattern-new", needsCaptionsOverride: true },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("change patternId vers un pattern AVEC captionPresetId + needsCaptionsOverride → accepté", async () => {
    mockSlotFindUnique
      .mockResolvedValueOnce(
        makeSlot({
          pattern: {
            captionPresetId: null,
            descriptionPromptId: null,
            needsCaptions: false,
            needsDescription: "none",
            coverMode: "none",
            coverConfig: null,
          },
        }),
      )
      .mockResolvedValueOnce({ accountId: "account-A" });
    mockPatternFindUnique.mockResolvedValueOnce({
      accountId: "account-A",
      captionPresetId: "preset-new", // ← nouveau pattern AVEC preset
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
    });

    const result = await patchSlot(
      "slot-1",
      { patternId: "pattern-new", needsCaptionsOverride: true },
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

// ─── Invariant 7 : bornes captionVerticalOffsetOverride ────────────────────

describe("patchSlot — captionVerticalOffsetOverride bornes", () => {
  it("offset > 0.5 → ValidationError", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    await expect(
      patchSlot(
        "slot-1",
        { captionVerticalOffsetOverride: 0.6 },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("offset < -0.5 → ValidationError", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    await expect(
      patchSlot(
        "slot-1",
        { captionVerticalOffsetOverride: -0.7 },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("offset NaN → ValidationError", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    await expect(
      patchSlot(
        "slot-1",
        { captionVerticalOffsetOverride: Number.NaN },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("offset = null (reset) → accepté", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    const result = await patchSlot(
      "slot-1",
      { captionVerticalOffsetOverride: null },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });

  it("offset = 0.3 (valide) → accepté", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    const result = await patchSlot(
      "slot-1",
      { captionVerticalOffsetOverride: 0.3 },
      makeUserCtx("ADMIN"),
    );
    expect(result).toBeDefined();
  });

  it("MONTEUR assigné peut patcher l'offset (whitelist explicite)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ assigneeMonteurId: "user-monteur" }),
    );
    const result = await patchSlot(
      "slot-1",
      { captionVerticalOffsetOverride: 0.15 },
      makeUserCtx("MONTEUR", "user-monteur"),
    );
    expect(result).toBeDefined();
  });
});

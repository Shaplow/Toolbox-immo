/**
 * Tests bulkStockSlots — banque de contenus (slots sans date programmée).
 *
 * Invariants :
 *  1. ForbiddenError si non-admin (canAdminBypass=false).
 *  2. ValidationError sur champs requis (accountId, patternId).
 *  3. ValidationError sur quantity hors bornes [1, 20].
 *  4. ValidationError si pattern d'un autre compte (cross-account guard).
 *  5. ValidationError si pattern.source !== "manual_rushes" (scope v1).
 *  6. NotFoundError si le compte n'existe pas.
 *  7. Crée bien N slots avec scheduledAt: null et le bon initialStatus.
 *  8. Override monteur prime sur pattern.defaultAssigneeMonteurId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotCreate = vi.fn();
const mockPatternFindUnique = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockActivityCreate = vi.fn().mockResolvedValue({ id: "activity-stub" });

// $transaction simplifié : exécute le callback avec un client minimal.
const mockTransaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
  cb({
    publicationSlot: { create: (...args: unknown[]) => mockSlotCreate(...args) },
    publicationActivity: { create: (...args: unknown[]) => mockActivityCreate(...args) },
  }),
);

// P2 — bulkStockSlots résout désormais via patternBinding en priorité ;
// les anciens tests passaient un patternId AccountPattern → on simule
// l'absence de binding (findUnique=null), puis findFirst trouve un binding
// dérivé via le shim de compat. On expose les mocks pour pouvoir les
// override par test (chaîne canonique vs legacy).
const mockBindingFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      create: (...args: unknown[]) => mockSlotCreate(...args),
    },
    accountPattern: {
      findUnique: (...args: unknown[]) => mockPatternFindUnique(...args),
    },
    patternBinding: {
      findUnique: (...args: unknown[]) => mockBindingFindUnique(...args),
      findFirst: (...args: unknown[]) => mockBindingFindFirst(...args),
    },
    instagramAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => mockTransaction(cb),
    publicationActivity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
  },
}));

import {
  bulkStockSlots,
  BULK_STOCK_MIN,
  BULK_STOCK_MAX,
} from "@/lib/services/slot/slotService";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function makeAdminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof bulkStockSlots>[1];
}

function makeNonAdminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "user-1", role: "MONTEUR", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "user-1", role: "MONTEUR", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: false,
  } as Parameters<typeof bulkStockSlots>[1];
}

const baseInput = {
  accountId: "account-A",
  patternId: "pattern-1",
  quantity: 3,
};

beforeEach(() => {
  mockSlotCreate.mockReset();
  mockPatternFindUnique.mockReset();
  mockAccountFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockActivityCreate.mockClear();
  mockTransaction.mockClear();
  mockBindingFindUnique.mockReset();
  mockBindingFindFirst.mockReset();

  // Default : create renvoie un slot avec id séquentiel
  let n = 0;
  mockSlotCreate.mockImplementation(() => {
    n += 1;
    return Promise.resolve({ id: `slot-${n}` });
  });
  mockAccountFindUnique.mockResolvedValue({ id: "account-A" });
  // Pattern legacy par défaut : manual_rushes, défaut monteur null
  mockPatternFindUnique.mockResolvedValue({
    id: "pattern-1",
    accountId: "account-A",
    source: "manual_rushes",
    templateId: "tpl-1",
    publishTime: "10:00",
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
  });
  // P2 — Par défaut, on simule input.patternId pointant sur un AccountPattern
  // legacy (binding.findUnique=null) → le shim cherche le binding équivalent
  // par accountId+publishTime via findFirst.
  mockBindingFindUnique.mockResolvedValue(null);
  mockBindingFindFirst.mockResolvedValue({
    id: "binding-1",
    accountId: "account-A",
    patternTemplate: {
      id: "tpl-recipe-1",
      source: "manual_rushes",
      templateId: "tpl-1",
    },
    templateIdOverride: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
  });
});

// ─── Invariant 1 — auth ADMIN only ─────────────────────────────────────────

describe("bulkStockSlots — auth ADMIN only", () => {
  it("non-admin (canAdminBypass=false) → ForbiddenError", async () => {
    await expect(
      bulkStockSlots(baseInput, makeNonAdminCtx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── Invariant 2 — champs requis ───────────────────────────────────────────

describe("bulkStockSlots — champs requis", () => {
  it("accountId manquant → ValidationError", async () => {
    await expect(
      bulkStockSlots({ ...baseInput, accountId: "" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("patternId manquant → ValidationError", async () => {
    await expect(
      bulkStockSlots({ ...baseInput, patternId: "" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 3 — quantity bornes ────────────────────────────────────────

describe("bulkStockSlots — bornes quantity", () => {
  it("quantity < MIN → ValidationError", async () => {
    await expect(
      bulkStockSlots(
        { ...baseInput, quantity: BULK_STOCK_MIN - 1 },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("quantity > MAX → ValidationError", async () => {
    await expect(
      bulkStockSlots(
        { ...baseInput, quantity: BULK_STOCK_MAX + 1 },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("quantity non-numérique → ValidationError", async () => {
    await expect(
      bulkStockSlots(
        { ...baseInput, quantity: Number.NaN },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 4 — cross-account guard ────────────────────────────────────

describe("bulkStockSlots — cross-account guard", () => {
  it("Pattern d'un autre compte → ValidationError", async () => {
    // Simule un binding résolu pour un autre compte que celui ciblé par
    // l'admin. Le shim de compat (findFirst) renvoie ce binding "à côté".
    mockBindingFindFirst.mockResolvedValueOnce({
      id: "binding-x",
      accountId: "account-B", // autre compte
      patternTemplate: {
        id: "tpl-1",
        source: "manual_rushes",
        templateId: null,
      },
      templateIdOverride: null,
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-1",
      accountId: "account-B",
      source: "manual_rushes",
      templateId: null,
      publishTime: "10:00",
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    await expect(
      bulkStockSlots(baseInput, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 5 — source manual_rushes only ──────────────────────────────

describe("bulkStockSlots — scope manual_rushes only", () => {
  it.each(["auto_template", "external_upload", "anything"])(
    "Pattern source=%s → ValidationError",
    async (source) => {
      // Le binding résolu a la même source que le pattern legacy.
      mockBindingFindFirst.mockResolvedValueOnce({
        id: "binding-x",
        accountId: "account-A",
        patternTemplate: { id: "tpl-1", source, templateId: null },
        templateIdOverride: null,
        captionPresetIdOverride: null,
        descriptionPromptIdOverride: null,
        coverModeOverride: null,
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
        defaultAssigneeVideasteId: null,
      });
      mockPatternFindUnique.mockResolvedValueOnce({
        id: "pattern-1",
        accountId: "account-A",
        source,
        templateId: null,
        publishTime: "10:00",
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
        defaultAssigneeVideasteId: null,
      });
      await expect(
        bulkStockSlots(baseInput, makeAdminCtx()),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );
});

// ─── Invariant 6 — compte inexistant ──────────────────────────────────────

describe("bulkStockSlots — compte inexistant", () => {
  it("Compte introuvable → NotFoundError", async () => {
    mockAccountFindUnique.mockResolvedValueOnce(null);
    await expect(
      bulkStockSlots(baseInput, makeAdminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Invariant 7 — création des N slots ───────────────────────────────────

describe("bulkStockSlots — création", () => {
  it("Crée exactement N slots avec scheduledAt: null + status RUSHES_EXPECTED", async () => {
    const result = await bulkStockSlots(
      { accountId: "account-A", patternId: "pattern-1", quantity: 3 },
      makeAdminCtx(),
    );

    expect(result.count).toBe(3);
    expect(mockSlotCreate).toHaveBeenCalledTimes(3);

    for (const call of mockSlotCreate.mock.calls) {
      const { data } = call[0] as { data: Record<string, unknown> };
      expect(data.scheduledAt).toBeNull();
      expect(data.status).toBe("RUSHES_EXPECTED");
      expect(data.isAuto).toBe(false);
      expect(data.accountId).toBe("account-A");
      // P2 — slot.patternBindingId pointe sur le PatternBinding résolu
      // (et non plus l'AccountPattern legacy).
      expect(data.patternBindingId).toBe("binding-1");
    }

    // Une activité BANK_SLOT_CREATED par slot.
    expect(mockActivityCreate).toHaveBeenCalledTimes(3);
    for (const call of mockActivityCreate.mock.calls) {
      const { data } = call[0] as { data: Record<string, unknown> };
      expect(data.type).toBe("BANK_SLOT_CREATED");
    }
  });
});

// ─── Invariant 8 — override monteur prime ─────────────────────────────────

describe("bulkStockSlots — override monteur", () => {
  beforeEach(() => {
    // P2 — le défaut monteur est désormais porté par le binding (pas par
    // l'AccountPattern legacy).
    mockBindingFindFirst.mockResolvedValue({
      id: "binding-1",
      accountId: "account-A",
      patternTemplate: {
        id: "tpl-recipe-1",
        source: "manual_rushes",
        templateId: null,
      },
      templateIdOverride: null,
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      defaultAssigneeMonteurId: "pattern-monteur",
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    mockPatternFindUnique.mockResolvedValue({
      id: "pattern-1",
      accountId: "account-A",
      source: "manual_rushes",
      templateId: null,
      publishTime: "10:00",
      defaultAssigneeMonteurId: "pattern-monteur",
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    mockUserFindUnique.mockResolvedValue({ role: "MONTEUR" });
  });

  it("monteurId fourni → utilise l'override (pas le défaut pattern)", async () => {
    await bulkStockSlots(
      { ...baseInput, quantity: 1, monteurId: "override-monteur" },
      makeAdminCtx(),
    );
    const call = mockSlotCreate.mock.calls[0];
    const { data } = call[0] as { data: Record<string, unknown> };
    expect(data.assigneeMonteurId).toBe("override-monteur");
  });

  it("monteurId non fourni → utilise défaut pattern", async () => {
    await bulkStockSlots(
      { ...baseInput, quantity: 1, monteurId: null },
      makeAdminCtx(),
    );
    const call = mockSlotCreate.mock.calls[0];
    const { data } = call[0] as { data: Record<string, unknown> };
    expect(data.assigneeMonteurId).toBe("pattern-monteur");
  });
});

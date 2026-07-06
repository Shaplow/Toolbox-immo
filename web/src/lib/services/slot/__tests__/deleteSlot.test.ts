/**
 * Tests d'intégration sur deleteSlot — fige les invariants :
 *
 *  1. ADMIN only (non-admin → NotFoundError, pas Forbidden)
 *  2. NotFoundError si slot inexistant
 *  3. Cleanup R2 best-effort : balayage du préfixe publications/<slotId>/
 *  4. DB delete continue même si le cleanup R2 échoue
 *  5. DB delete AVANT R2 (le slot disparaît même si R2 échoue)
 *  6. Skip R2 si R2 non configuré (dev disque local)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockSlotDelete = vi.fn();
const mockDeleteR2Prefix = vi.fn();
const mockR2Configured = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
      delete: (...args: unknown[]) => mockSlotDelete(...args),
    },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
}));

vi.mock("@/lib/r2", () => ({
  deleteR2Prefix: (...args: unknown[]) => mockDeleteR2Prefix(...args),
  r2Configured: (...args: unknown[]) => mockR2Configured(...args),
}));

import { deleteSlot } from "@/lib/services/slot/slotService";
import { NotFoundError } from "@/lib/services/_runtime/errors";

function makeAdminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof deleteSlot>[1];
}

function makeNonAdminCtx(role: "MONTEUR" | "CM" | "VIDEASTE" = "MONTEUR") {
  return {
    session: {} as unknown,
    actualUser: { id: "user-1", role, name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "user-1", role, name: null, email: null, permissions: "[]" },
    isAdmin: false,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: false,
  } as Parameters<typeof deleteSlot>[1];
}

beforeEach(() => {
  mockSlotFindUnique.mockReset();
  mockSlotDelete.mockReset();
  mockDeleteR2Prefix.mockReset();
  mockR2Configured.mockReset();
  mockTransaction.mockReset();

  mockSlotFindUnique.mockResolvedValue({ id: "slot-1" });
  mockSlotDelete.mockResolvedValue({ id: "slot-1" });
  mockR2Configured.mockReturnValue(true);
  mockDeleteR2Prefix.mockResolvedValue({ deleted: 0, failed: 0 });

  // $transaction default : proxie le callback avec un tx qui appelle les
  // mêmes mocks que prisma.
  mockTransaction.mockImplementation((cb: unknown) => {
    if (typeof cb !== "function") return Promise.resolve(undefined);
    const tx = {
      publicationSlot: {
        findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
        delete: (...args: unknown[]) => mockSlotDelete(...args),
      },
    };
    return Promise.resolve((cb as (tx: unknown) => Promise<unknown>)(tx));
  });
});

// ─── Invariant 1 : ADMIN only ──────────────────────────────────────────────

describe("deleteSlot — auth", () => {
  it("MONTEUR → NotFoundError (anti-énumération)", async () => {
    await expect(deleteSlot("slot-1", makeNonAdminCtx("MONTEUR"))).rejects.toBeInstanceOf(NotFoundError);
    // Le slot n'a même pas été cherché — abort immédiat
    expect(mockSlotFindUnique).not.toHaveBeenCalled();
    expect(mockDeleteR2Prefix).not.toHaveBeenCalled();
  });

  it("CM → NotFoundError", async () => {
    await expect(deleteSlot("slot-1", makeNonAdminCtx("CM"))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("VIDEASTE → NotFoundError", async () => {
    await expect(deleteSlot("slot-1", makeNonAdminCtx("VIDEASTE"))).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Invariant 2 : NotFoundError si slot inexistant ────────────────────────

describe("deleteSlot — slot inexistant", () => {
  it("findUnique=null → NotFoundError, ni delete ni cleanup R2", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(null);
    await expect(deleteSlot("ghost", makeAdminCtx())).rejects.toBeInstanceOf(NotFoundError);
    expect(mockSlotDelete).not.toHaveBeenCalled();
    expect(mockDeleteR2Prefix).not.toHaveBeenCalled();
  });
});

// ─── Invariant 3 : Cleanup R2 par balayage du préfixe du slot ──────────────

describe("deleteSlot — cleanup R2 par préfixe", () => {
  it("balaie le préfixe publications/<slotId>/ et remonte le compteur", async () => {
    mockDeleteR2Prefix.mockResolvedValueOnce({ deleted: 5, failed: 0 });
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(mockDeleteR2Prefix).toHaveBeenCalledTimes(1);
    expect(mockDeleteR2Prefix).toHaveBeenCalledWith("publications/slot-1/");
    expect(result).toEqual({ ok: true, r2ObjectsDeleted: 5 });
  });

  it("slot sans objet R2 → r2ObjectsDeleted=0", async () => {
    mockDeleteR2Prefix.mockResolvedValueOnce({ deleted: 0, failed: 0 });
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.r2ObjectsDeleted).toBe(0);
  });
});

// ─── Invariant 4 : DB delete continue même si R2 échoue ────────────────────

describe("deleteSlot — résilience aux erreurs R2", () => {
  it("échec du sweep R2 ne bloque pas le delete DB", async () => {
    mockDeleteR2Prefix.mockRejectedValueOnce(new Error("R2 unavailable"));
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.ok).toBe(true);
    expect(result.r2ObjectsDeleted).toBe(0);
    expect(mockSlotDelete).toHaveBeenCalled();
  });

  it("cleanup partiel (failed>0) → succès quand même", async () => {
    mockDeleteR2Prefix.mockResolvedValueOnce({ deleted: 3, failed: 2 });
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.ok).toBe(true);
    expect(result.r2ObjectsDeleted).toBe(3);
  });
});

// ─── Invariant 5 : DB delete avant R2 (order matters) ──────────────────────

describe("deleteSlot — ordre d'opérations", () => {
  it("Prisma delete appelé AVANT le sweep R2 (si R2 échoue, le slot disparaît quand même)", async () => {
    const callOrder: string[] = [];
    mockSlotDelete.mockImplementationOnce(() => {
      callOrder.push("db");
      return Promise.resolve({ id: "slot-1" });
    });
    mockDeleteR2Prefix.mockImplementationOnce(() => {
      callOrder.push("r2");
      return Promise.resolve({ deleted: 1, failed: 0 });
    });

    await deleteSlot("slot-1", makeAdminCtx());
    expect(callOrder).toEqual(["db", "r2"]);
  });
});

// ─── Invariant 6 : skip R2 si non configuré (dev disque local) ─────────────

describe("deleteSlot — R2 non configuré", () => {
  it("r2Configured=false → pas de sweep R2, delete DB quand même", async () => {
    mockR2Configured.mockReturnValue(false);
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(mockSlotDelete).toHaveBeenCalled();
    expect(mockDeleteR2Prefix).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, r2ObjectsDeleted: 0 });
  });
});

/**
 * Tests d'intégration sur deleteSlot — fige les invariants :
 *
 *  1. ADMIN only (non-admin → NotFoundError, pas Forbidden)
 *  2. NotFoundError si slot inexistant
 *  3. Cleanup R2 best-effort sur versions / rushes / brief attachments
 *  4. DB delete continue même si R2 cleanup échoue
 *  5. Retourne le nombre de R2 keys nettoyées
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockSlotDelete = vi.fn();
const mockDeleteFromR2 = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
      delete: (...args: unknown[]) => mockSlotDelete(...args),
    },
  },
}));

vi.mock("@/lib/r2", () => ({
  deleteFromR2: (...args: unknown[]) => mockDeleteFromR2(...args),
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

function makeSlot(overrides: Partial<{ versions: Array<{ r2Key: string }>; rushes: Array<{ r2Key: string }>; brief: { attachments: Array<{ r2Key: string }> } | null }> = {}) {
  return {
    id: "slot-1",
    versions: [],
    rushes: [],
    brief: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSlotFindUnique.mockReset();
  mockSlotDelete.mockReset();
  mockDeleteFromR2.mockReset();
  mockSlotDelete.mockResolvedValue({ id: "slot-1" });
  mockDeleteFromR2.mockResolvedValue(undefined);
});

// ─── Invariant 1 : ADMIN only ──────────────────────────────────────────────

describe("deleteSlot — auth", () => {
  it("MONTEUR → NotFoundError (anti-énumération)", async () => {
    await expect(deleteSlot("slot-1", makeNonAdminCtx("MONTEUR"))).rejects.toBeInstanceOf(NotFoundError);
    // Le slot n'a même pas été cherché — abort immédiat
    expect(mockSlotFindUnique).not.toHaveBeenCalled();
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
  it("findUnique=null → NotFoundError", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(null);
    await expect(deleteSlot("ghost", makeAdminCtx())).rejects.toBeInstanceOf(NotFoundError);
    expect(mockSlotDelete).not.toHaveBeenCalled();
  });
});

// ─── Invariant 3 : Cleanup R2 sur versions / rushes / attachments ──────────

describe("deleteSlot — cleanup R2 best-effort", () => {
  it("supprime les R2 keys des versions", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        versions: [
          { r2Key: "publications/slot-1/versions/1.mp4" },
          { r2Key: "publications/slot-1/versions/2.mp4" },
        ],
      }),
    );
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(mockDeleteFromR2).toHaveBeenCalledTimes(2);
    expect(mockDeleteFromR2).toHaveBeenCalledWith("publications/slot-1/versions/1.mp4");
    expect(mockDeleteFromR2).toHaveBeenCalledWith("publications/slot-1/versions/2.mp4");
    expect(result).toEqual({ ok: true, r2KeysDeleted: 2 });
  });

  it("supprime les R2 keys des rushes", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        rushes: [{ r2Key: "publications/slot-1/rushes/abc.mov" }],
      }),
    );
    await deleteSlot("slot-1", makeAdminCtx());
    expect(mockDeleteFromR2).toHaveBeenCalledWith("publications/slot-1/rushes/abc.mov");
  });

  it("supprime les R2 keys des brief attachments", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        brief: { attachments: [{ r2Key: "publications/slot-1/brief/note.pdf" }] },
      }),
    );
    await deleteSlot("slot-1", makeAdminCtx());
    expect(mockDeleteFromR2).toHaveBeenCalledWith("publications/slot-1/brief/note.pdf");
  });

  it("agrège versions + rushes + attachments dans le compteur", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        versions: [{ r2Key: "k1" }, { r2Key: "k2" }],
        rushes: [{ r2Key: "k3" }],
        brief: { attachments: [{ r2Key: "k4" }, { r2Key: "k5" }] },
      }),
    );
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.r2KeysDeleted).toBe(5);
    expect(mockDeleteFromR2).toHaveBeenCalledTimes(5);
  });

  it("slot sans enfants R2 → r2KeysDeleted=0", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(makeSlot());
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.r2KeysDeleted).toBe(0);
    expect(mockDeleteFromR2).not.toHaveBeenCalled();
  });
});

// ─── Invariant 4 : DB delete continue même si R2 échoue ────────────────────

describe("deleteSlot — résilience aux erreurs R2", () => {
  it("échec R2 sur une key ne bloque pas le delete DB", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({
        versions: [{ r2Key: "k1" }, { r2Key: "k2" }],
      }),
    );
    mockDeleteFromR2
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValueOnce(undefined);

    // Pas de throw — la fonction retourne success
    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.ok).toBe(true);
    expect(mockSlotDelete).toHaveBeenCalled();
  });

  it("toutes les R2 keys en erreur → succès quand même (DB déjà delete)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ rushes: [{ r2Key: "k1" }, { r2Key: "k2" }] }),
    );
    mockDeleteFromR2.mockRejectedValue(new Error("R2 down"));

    const result = await deleteSlot("slot-1", makeAdminCtx());
    expect(result.ok).toBe(true);
    expect(mockSlotDelete).toHaveBeenCalled();
  });
});

// ─── Invariant 5 : DB delete avant R2 (order matters) ──────────────────────

describe("deleteSlot — ordre d'opérations", () => {
  it("Prisma delete appelé AVANT les deleteFromR2 (en cas de fail R2, le slot disparaît quand même)", async () => {
    mockSlotFindUnique.mockResolvedValueOnce(
      makeSlot({ versions: [{ r2Key: "k1" }] }),
    );
    const callOrder: string[] = [];
    mockSlotDelete.mockImplementationOnce(() => {
      callOrder.push("db");
      return Promise.resolve({ id: "slot-1" });
    });
    mockDeleteFromR2.mockImplementationOnce(() => {
      callOrder.push("r2");
      return Promise.resolve();
    });

    await deleteSlot("slot-1", makeAdminCtx());
    expect(callOrder).toEqual(["db", "r2"]);
  });
});

/**
 * Tests entityService — fige :
 *  - createEntity : guards (admin, type/label/date/compte requis selon capacités)
 *  - computeShotTransition : logique pure PLANNED→SHOT
 *  - markEntityShot : transition + bump reels (via shootEntityId) + idempotence
 *
 * Port de event/__tests__/eventService.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityTypeFindUnique = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockEntityFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockEntityCreate = vi.fn();
const mockEntityActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entityType: { findUnique: (...a: unknown[]) => mockEntityTypeFindUnique(...a) },
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    entity: {
      findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
      create: (...a: unknown[]) => mockEntityCreate(...a),
    },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    patternBinding: { findFirst: (...a: unknown[]) => mockBindingFindFirst(...a) },
    entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  createEntity,
  computeShotTransition,
  markEntityShot,
} from "@/lib/services/entity/entityService";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/services/_runtime/errors";

function adminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof createEntity>[1];
}

function nonAdminCtx() {
  return {
    ...adminCtx(),
    actualUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    canAdminBypass: false,
  } as Parameters<typeof createEntity>[1];
}

const BIEN_TYPE = {
  id: "etype_bien",
  hasPlanning: false,
  hasAccount: false,
  hasRushes: false,
  hasAssignees: false,
  visibility: "admin",
};

const TOURNAGE_TYPE = {
  id: "etype_tournage",
  hasPlanning: true,
  hasAccount: true,
  hasRushes: true,
  hasAssignees: true,
  visibility: "team",
};

beforeEach(() => {
  mockEntityTypeFindUnique.mockReset().mockResolvedValue(BIEN_TYPE);
  mockAccountFindUnique.mockReset().mockResolvedValue({ id: "acc-1" });
  mockEntityFindUnique.mockReset().mockResolvedValue({ id: "rel-1", isArchived: false });
  mockUserFindUnique.mockReset();
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockEntityActivityCreate.mockReset().mockResolvedValue({ id: "act-1" });
  mockTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      entity: { create: (...a: unknown[]) => mockEntityCreate(...a) },
      entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    }),
  );
  mockEntityCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "ent-new",
      ...data,
      type: { fieldSchema: "[]" },
    }),
  );
});

describe("createEntity — guards", () => {
  it("non-admin (canAdminBypass=false) → ForbiddenError", async () => {
    await expect(
      createEntity({ typeId: "etype_bien", label: "12 rue des Lilas" }, nonAdminCtx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sans typeId → ValidationError", async () => {
    await expect(
      createEntity({ typeId: "", label: "T" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type introuvable → NotFoundError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(null);
    await expect(
      createEntity({ typeId: "etype_ghost", label: "T" }, adminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sans label → ValidationError", async () => {
    await expect(
      createEntity({ typeId: "etype_bien", label: "   " }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning sans scheduledAt → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity({ typeId: "etype_tournage", label: "Tournage Villa", accountId: "acc-1" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning + date invalide → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        { typeId: "etype_tournage", label: "T", accountId: "acc-1", scheduledAt: "pas-une-date" },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning + endAt avant scheduledAt → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        {
          typeId: "etype_tournage",
          label: "T",
          accountId: "acc-1",
          scheduledAt: "2026-08-01T10:00:00Z",
          endAt: "2026-08-01T09:00:00Z",
        },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasAccount sans accountId → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        { typeId: "etype_tournage", label: "T", scheduledAt: "2026-08-01T10:00:00Z" },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path (fiche admin, ex-Bien) → crée la fiche + log CREATED", async () => {
    const entity = await createEntity(
      { typeId: "etype_bien", label: "12 rue des Lilas" },
      adminCtx(),
    );
    expect(entity.status).toBeNull();
    expect(mockEntityCreate).toHaveBeenCalledOnce();
    const arg = mockEntityCreate.mock.calls[0][0].data;
    expect(arg.label).toBe("12 rue des Lilas");
    expect(arg.createdByUserId).toBe("admin-1");
    expect(mockEntityActivityCreate).toHaveBeenCalled();
  });

  it("happy path (fiche team, ex-Tournage) → status initial PLANNED", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    const entity = await createEntity(
      { typeId: "etype_tournage", label: "Tournage Villa", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    expect(entity.status).toBe("PLANNED");
    const arg = mockEntityCreate.mock.calls[0][0].data;
    expect(arg.accountId).toBe("acc-1");
    expect(arg.status).toBe("PLANNED");
  });

  it("seed défauts monteur/CM depuis le binding actif du compte", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    mockBindingFindFirst.mockResolvedValue({
      defaultAssigneeMonteurId: "mon-def",
      defaultAssigneeCmId: "cm-def",
    });
    await createEntity(
      { typeId: "etype_tournage", label: "T", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    const arg = mockEntityCreate.mock.calls[0][0].data;
    expect(arg.defaultAssigneeMonteurId).toBe("mon-def");
    expect(arg.defaultAssigneeCmId).toBe("cm-def");
  });
});

describe("computeShotTransition — pur", () => {
  it("PLANNED → transition SHOT + bump", () => {
    expect(computeShotTransition("PLANNED")).toEqual({ nextStatus: "SHOT", bumpReels: true });
  });

  it("SHOT / DONE / CANCELLED / null → null (idempotent)", () => {
    expect(computeShotTransition("SHOT")).toBeNull();
    expect(computeShotTransition("DONE")).toBeNull();
    expect(computeShotTransition("CANCELLED")).toBeNull();
    expect(computeShotTransition(null)).toBeNull();
  });
});

describe("markEntityShot — DB", () => {
  function fakeDb(status: string) {
    const entityUpdate = vi.fn().mockResolvedValue({});
    const slotUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const activityCreate = vi.fn().mockResolvedValue({ id: "a" });
    return {
      db: {
        entity: {
          findUnique: vi.fn().mockResolvedValue({ id: "ent-1", status }),
          update: entityUpdate,
        },
        publicationSlot: { updateMany: slotUpdateMany },
        entityActivity: { create: activityCreate },
      },
      entityUpdate,
      slotUpdateMany,
      activityCreate,
    };
  }

  it("PLANNED → passe SHOT, bump les reels via shootEntityId, log SHOT", async () => {
    const f = fakeDb("PLANNED");
    const res = await markEntityShot(f.db as never, "ent-1", "actor-1");
    expect(res).toEqual({ transitioned: true, bumpedReels: 2 });
    expect(f.entityUpdate).toHaveBeenCalledOnce();
    const upd = f.entityUpdate.mock.calls[0][0];
    expect(upd.data.status).toBe("SHOT");
    expect(upd.data.shotAt).toBeInstanceOf(Date);
    expect(f.slotUpdateMany).toHaveBeenCalledOnce();
    const bump = f.slotUpdateMany.mock.calls[0][0];
    expect(bump.where.shootEntityId).toBe("ent-1");
    expect(bump.where.status.in).toEqual(["PLANNED", "RUSHES_EXPECTED"]);
    expect(bump.data.status).toBe("IN_EDIT");
    expect(f.activityCreate).toHaveBeenCalled();
  });

  it("déjà SHOT → no-op idempotent", async () => {
    const f = fakeDb("SHOT");
    const res = await markEntityShot(f.db as never, "ent-1", null);
    expect(res).toEqual({ transitioned: false, bumpedReels: 0 });
    expect(f.entityUpdate).not.toHaveBeenCalled();
    expect(f.slotUpdateMany).not.toHaveBeenCalled();
  });
});

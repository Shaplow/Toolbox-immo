/**
 * Tests eventService — fige :
 *  - createEvent : guards (admin, account/titre/date requis)
 *  - computeShotTransition : logique pure PLANNED→SHOT
 *  - markEventShot : transition + bump reels + idempotence (via fake db client)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccountFindUnique = vi.fn();
const mockPropertyFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockShootEventCreate = vi.fn();
const mockShootEventActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    property: { findUnique: (...a: unknown[]) => mockPropertyFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    patternBinding: { findFirst: (...a: unknown[]) => mockBindingFindFirst(...a) },
    shootEvent: { create: (...a: unknown[]) => mockShootEventCreate(...a) },
    shootEventActivity: { create: (...a: unknown[]) => mockShootEventActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  createEvent,
  computeShotTransition,
  markEventShot,
} from "@/lib/services/event/eventService";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";

function adminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof createEvent>[1];
}

function nonAdminCtx() {
  return {
    ...adminCtx(),
    actualUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    canAdminBypass: false,
  } as Parameters<typeof createEvent>[1];
}

beforeEach(() => {
  mockAccountFindUnique.mockReset().mockResolvedValue({ id: "acc-1" });
  mockPropertyFindUnique.mockReset().mockResolvedValue({ id: "prop-1", isArchived: false });
  mockUserFindUnique.mockReset();
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockShootEventActivityCreate.mockReset().mockResolvedValue({ id: "act-1" });
  mockTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      shootEvent: { create: (...a: unknown[]) => mockShootEventCreate(...a) },
      shootEventActivity: { create: (...a: unknown[]) => mockShootEventActivityCreate(...a) },
    }),
  );
  mockShootEventCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "ev-new", ...data }),
  );
});

describe("createEvent — guards", () => {
  it("non-admin (canAdminBypass=false) → ForbiddenError", async () => {
    await expect(
      createEvent({ title: "T", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" }, nonAdminCtx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sans compte → ValidationError", async () => {
    await expect(
      createEvent({ title: "T", accountId: "", scheduledAt: "2026-08-01T10:00:00Z" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sans titre → ValidationError", async () => {
    await expect(
      createEvent({ title: "  ", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("date invalide → ValidationError", async () => {
    await expect(
      createEvent({ title: "T", accountId: "acc-1", scheduledAt: "pas-une-date" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("endAt avant scheduledAt → ValidationError", async () => {
    await expect(
      createEvent(
        { title: "T", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z", endAt: "2026-08-01T09:00:00Z" },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path → crée l'événement PLANNED + log EVENT_CREATED", async () => {
    const ev = await createEvent(
      { title: "Tournage Villa", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    expect(ev.status).toBe("PLANNED");
    expect(mockShootEventCreate).toHaveBeenCalledOnce();
    const arg = mockShootEventCreate.mock.calls[0][0].data;
    expect(arg.accountId).toBe("acc-1");
    expect(arg.createdByUserId).toBe("admin-1");
    expect(mockShootEventActivityCreate).toHaveBeenCalled();
  });

  it("seed défauts monteur/CM depuis le binding actif du compte", async () => {
    mockBindingFindFirst.mockResolvedValue({
      defaultAssigneeMonteurId: "mon-def",
      defaultAssigneeCmId: "cm-def",
    });
    await createEvent(
      { title: "T", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    const arg = mockShootEventCreate.mock.calls[0][0].data;
    expect(arg.defaultAssigneeMonteurId).toBe("mon-def");
    expect(arg.defaultAssigneeCmId).toBe("cm-def");
  });
});

describe("computeShotTransition — pur", () => {
  it("PLANNED → transition SHOT + bump", () => {
    expect(computeShotTransition("PLANNED")).toEqual({ nextStatus: "SHOT", bumpReels: true });
  });

  it("SHOT / DONE / CANCELLED → null (idempotent)", () => {
    expect(computeShotTransition("SHOT")).toBeNull();
    expect(computeShotTransition("DONE")).toBeNull();
    expect(computeShotTransition("CANCELLED")).toBeNull();
  });
});

describe("markEventShot — DB", () => {
  function fakeDb(status: string) {
    const shootEventUpdate = vi.fn().mockResolvedValue({});
    const slotUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const activityCreate = vi.fn().mockResolvedValue({ id: "a" });
    return {
      db: {
        shootEvent: {
          findUnique: vi.fn().mockResolvedValue({ id: "ev-1", status }),
          update: shootEventUpdate,
        },
        publicationSlot: { updateMany: slotUpdateMany },
        shootEventActivity: { create: activityCreate },
      },
      shootEventUpdate,
      slotUpdateMany,
      activityCreate,
    };
  }

  it("PLANNED → passe SHOT, bump les reels, log EVENT_SHOT", async () => {
    const f = fakeDb("PLANNED");
    const res = await markEventShot(f.db as never, "ev-1", "actor-1");
    expect(res).toEqual({ transitioned: true, bumpedReels: 2 });
    expect(f.shootEventUpdate).toHaveBeenCalledOnce();
    const upd = f.shootEventUpdate.mock.calls[0][0];
    expect(upd.data.status).toBe("SHOT");
    expect(upd.data.shotAt).toBeInstanceOf(Date);
    expect(f.slotUpdateMany).toHaveBeenCalledOnce();
    const bump = f.slotUpdateMany.mock.calls[0][0];
    expect(bump.where.eventId).toBe("ev-1");
    expect(bump.where.status.in).toEqual(["PLANNED", "RUSHES_EXPECTED"]);
    expect(bump.data.status).toBe("IN_EDIT");
    expect(f.activityCreate).toHaveBeenCalled();
  });

  it("déjà SHOT → no-op idempotent", async () => {
    const f = fakeDb("SHOT");
    const res = await markEventShot(f.db as never, "ev-1", null);
    expect(res).toEqual({ transitioned: false, bumpedReels: 0 });
    expect(f.shootEventUpdate).not.toHaveBeenCalled();
    expect(f.slotUpdateMany).not.toHaveBeenCalled();
  });
});

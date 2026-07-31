/**
 * Tests de bulkMarkPublishedSlots — marquage « publié » en lot depuis le calendrier.
 *
 * Invariants figés :
 *  1. ADMIN uniquement (canAdminBypass, donc false en impersonation)
 *  2. Seuls les statuts de BULK_PUBLISHABLE_STATUSES passent — le reste est
 *     compté en skipped, jamais une erreur qui ferait échouer tout le lot
 *  3. Un slot sans accountId (mission stock) est ignoré, comme sur la route unitaire
 *  4. Les ids introuvables comptent dans skipped (ne pas mentir sur le total)
 *  5. publishedUrl n'est jamais écrit : l'URL est propre à chaque post
 *  6. bulkPatchSlots refuse status=PUBLISHED (garde anti-bypass, comme patchSlot)
 *
 * Prisma est mocké au niveau module — vitest unit pur, pas de DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindMany = vi.fn();
const mockSlotUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findMany: (...args: unknown[]) => mockSlotFindMany(...args),
      update: (...args: unknown[]) => mockSlotUpdate(...args),
    },
    publicationActivity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
}));

// Import APRÈS le mock
import { bulkMarkPublishedSlots, bulkPatchSlots } from "@/lib/services/slot/slotService";
import { BULK_PUBLISHABLE_STATUSES } from "@/lib/publications/constants";
import { STATUS_TRANSITIONS } from "@/lib/services/slot/transitions";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";

function makeUserCtx(role: "ADMIN" | "CM", userId = "user-1") {
  return {
    session: {} as unknown,
    actualUser: { id: userId, role, name: null, email: null, permissions: "[]" },
    effectiveUser: { id: userId, role, name: null, email: null, permissions: "[]" },
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof bulkMarkPublishedSlots>[1];
}

beforeEach(() => {
  mockSlotFindMany.mockReset();
  mockSlotUpdate.mockReset().mockResolvedValue({});
  mockActivityCreate.mockReset().mockResolvedValue({});
  mockTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      publicationSlot: { update: (...a: unknown[]) => mockSlotUpdate(...a) },
      publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    }),
  );
});

describe("BULK_PUBLISHABLE_STATUSES", () => {
  it("reste aligné sur la matrice de transitions", () => {
    const derived = Object.entries(STATUS_TRANSITIONS)
      .filter(([, targets]) => (targets as string[]).includes("PUBLISHED"))
      .map(([from]) => from)
      .sort();
    expect([...BULK_PUBLISHABLE_STATUSES].sort()).toEqual(derived);
  });
});

describe("bulkMarkPublishedSlots", () => {
  it("refuse un non-admin", async () => {
    await expect(
      bulkMarkPublishedSlots({ slotIds: ["s1"] }, makeUserCtx("CM")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSlotFindMany).not.toHaveBeenCalled();
  });

  it("refuse une liste vide", async () => {
    await expect(
      bulkMarkPublishedSlots({ slotIds: [] }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse au-delà de la borne haute", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `s${i}`);
    await expect(
      bulkMarkPublishedSlots({ slotIds: ids }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("publie les slots éligibles et pose publishedAt sans publishedUrl", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: "acc-1" },
      { id: "s2", status: "READY_FOR_CM", accountId: "acc-1" },
    ]);

    const res = await bulkMarkPublishedSlots({ slotIds: ["s1", "s2"] }, makeUserCtx("ADMIN"));

    expect(res).toEqual({ patchedCount: 2, skippedCount: 0 });
    expect(mockSlotUpdate).toHaveBeenCalledTimes(2);
    const firstCall = mockSlotUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(firstCall.data.status).toBe("PUBLISHED");
    expect(firstCall.data.publishedAt).toBeInstanceOf(Date);
    // L'URL est propre à chaque post : un lot ne doit jamais l'écrire.
    expect(firstCall.data).not.toHaveProperty("publishedUrl");
  });

  it("ignore les statuts dont la vidéo n'est pas validée", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: "acc-1" },
      { id: "s2", status: "TO_DO", accountId: "acc-1" },
      { id: "s3", status: "EDIT_REVIEW", accountId: "acc-1" },
    ]);

    const res = await bulkMarkPublishedSlots(
      { slotIds: ["s1", "s2", "s3"] },
      makeUserCtx("ADMIN"),
    );

    expect(res).toEqual({ patchedCount: 1, skippedCount: 2 });
    expect(mockSlotUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignore un slot sans compte Instagram (mission stock)", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: null },
    ]);

    const res = await bulkMarkPublishedSlots({ slotIds: ["s1"] }, makeUserCtx("ADMIN"));

    expect(res).toEqual({ patchedCount: 0, skippedCount: 1 });
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("compte les ids introuvables dans skipped", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: "acc-1" },
    ]);

    const res = await bulkMarkPublishedSlots(
      { slotIds: ["s1", "disparu-1", "disparu-2"] },
      makeUserCtx("ADMIN"),
    );

    expect(res).toEqual({ patchedCount: 1, skippedCount: 2 });
  });

  it("logge une activité PUBLISHED par slot, marquée batch", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: "acc-1" },
    ]);

    await bulkMarkPublishedSlots({ slotIds: ["s1"] }, makeUserCtx("ADMIN"));

    expect(mockActivityCreate).toHaveBeenCalledTimes(1);
    const call = mockActivityCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.type).toBe("PUBLISHED");
    const payload =
      typeof call.data.payload === "string"
        ? (JSON.parse(call.data.payload) as Record<string, unknown>)
        : (call.data.payload as Record<string, unknown>);
    expect(payload).toMatchObject({ batch: true });
    // Pas d'URL dans le lot : elle est propre à chaque post.
    expect(payload).not.toHaveProperty("url");
  });

  it("accepte un publishedAt commun et refuse une date hors fenêtre", async () => {
    mockSlotFindMany.mockResolvedValue([
      { id: "s1", status: "SCHEDULED", accountId: "acc-1" },
    ]);
    const iso = "2026-07-01T10:00:00.000Z";

    await bulkMarkPublishedSlots({ slotIds: ["s1"], publishedAt: iso }, makeUserCtx("ADMIN"));
    const call = mockSlotUpdate.mock.calls[0][0] as { data: { publishedAt: Date } };
    expect(call.data.publishedAt.toISOString()).toBe(iso);

    await expect(
      bulkMarkPublishedSlots(
        { slotIds: ["s1"], publishedAt: "1999-01-01T00:00:00.000Z" },
        makeUserCtx("ADMIN"),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("n'ouvre pas de transaction quand rien n'est éligible", async () => {
    mockSlotFindMany.mockResolvedValue([{ id: "s1", status: "TO_DO", accountId: "acc-1" }]);

    const res = await bulkMarkPublishedSlots({ slotIds: ["s1"] }, makeUserCtx("ADMIN"));

    expect(res).toEqual({ patchedCount: 0, skippedCount: 1 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("bulkPatchSlots — garde anti-bypass PUBLISHED", () => {
  it("refuse status=PUBLISHED même pour un ADMIN", async () => {
    await expect(
      bulkPatchSlots({ slotIds: ["s1"], patch: { status: "PUBLISHED" } }, makeUserCtx("ADMIN")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSlotFindMany).not.toHaveBeenCalled();
  });
});

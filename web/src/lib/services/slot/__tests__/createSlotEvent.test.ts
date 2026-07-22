/**
 * Tests createSlot — chemin « reel rattaché à un événement (eventId) ».
 * Fige :
 *  - compte forcé = compte de l'événement
 *  - statut initial : event SHOT → IN_EDIT ; event PLANNED → PLANNED
 *  - needsRushesOverride = false (chaîne démarre au montage)
 *  - eventId persisté
 *  - événement introuvable → NotFoundError
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotCreate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockBindingFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn().mockResolvedValue(null);
const mockShootEventFindUnique = vi.fn();
const mockPropertyFindUnique = vi.fn().mockResolvedValue({ id: "prop-1", isArchived: false });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: { create: (...a: unknown[]) => mockSlotCreate(...a) },
    accountPattern: { findUnique: vi.fn() },
    patternTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    patternBinding: {
      findUnique: (...a: unknown[]) => mockBindingFindUnique(...a),
      findFirst: (...a: unknown[]) => mockBindingFindFirst(...a),
    },
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    property: { findUnique: (...a: unknown[]) => mockPropertyFindUnique(...a) },
    shootEvent: { findUnique: (...a: unknown[]) => mockShootEventFindUnique(...a) },
  },
}));

import { createSlot } from "@/lib/services/slot/slotService";
import { NotFoundError } from "@/lib/services/_runtime/errors";

function adminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof createSlot>[1];
}

function makeBinding(accountId: string) {
  return {
    id: "bind-1",
    accountId,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    patternTemplate: {
      label: "Reel visite",
      source: "manual_rushes",
      requiresProperty: false,
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      descriptionSourceFieldKey: null,
      coverMode: "none",
      coverConfig: null,
    },
  };
}

beforeEach(() => {
  mockSlotCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "slot-new", ...data, account: { id: data.accountId, name: "X", handle: "x" } }),
  );
  mockAccountFindUnique.mockReset().mockResolvedValue({ id: "acc-ev", name: "X", handle: "x" });
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockBindingFindUnique.mockReset().mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(makeBinding("acc-ev")),
  );
  mockPropertyFindUnique.mockReset().mockResolvedValue({ id: "prop-1", isArchived: false });
  mockUserFindUnique.mockReset().mockImplementation(({ where }: { where: { id: string } }) => {
    const id = where.id;
    const role = id.startsWith("mon") ? "MONTEUR" : id.startsWith("cm") ? "CM" : "VIDEASTE";
    return Promise.resolve({ role });
  });
  mockShootEventFindUnique.mockReset();
});

describe("createSlot — reel event-attached", () => {
  it("événement SHOT → reel IN_EDIT, compte forcé, needsRushesOverride=false, eventId persisté", async () => {
    mockShootEventFindUnique.mockResolvedValue({
      id: "ev-1",
      accountId: "acc-ev",
      propertyId: null,
      status: "SHOT",
      assigneeVideasteId: "vid-1",
      defaultAssigneeMonteurId: "mon-1",
      defaultAssigneeCmId: "cm-1",
    });

    const slot = await createSlot(
      // input.accountId volontairement différent → doit être écrasé par l'event
      { eventId: "ev-1", patternBindingId: "bind-1", accountId: "autre-compte" },
      adminCtx(),
    );

    const data = mockSlotCreate.mock.calls[0][0].data;
    expect(data.eventId).toBe("ev-1");
    expect(data.accountId).toBe("acc-ev");
    expect(data.status).toBe("IN_EDIT");
    expect(data.needsRushesOverride).toBe(false);
    // assignés hérités de l'événement (défaut binding null → event gagne)
    expect(data.assigneeMonteurId).toBe("mon-1");
    expect(data.assigneeCmId).toBe("cm-1");
    expect(data.assigneeVideasteId).toBe("vid-1");
    expect(slot.id).toBe("slot-new");
  });

  it("événement PLANNED → reel PLANNED (bumpé plus tard au SHOT)", async () => {
    mockShootEventFindUnique.mockResolvedValue({
      id: "ev-2",
      accountId: "acc-ev",
      propertyId: null,
      status: "PLANNED",
      assigneeVideasteId: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
    });

    await createSlot({ eventId: "ev-2", patternBindingId: "bind-1" }, adminCtx());
    const data = mockSlotCreate.mock.calls[0][0].data;
    expect(data.status).toBe("PLANNED");
    expect(data.needsRushesOverride).toBe(false);
  });

  it("événement introuvable → NotFoundError", async () => {
    mockShootEventFindUnique.mockResolvedValue(null);
    await expect(
      createSlot({ eventId: "ghost", patternBindingId: "bind-1" }, adminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

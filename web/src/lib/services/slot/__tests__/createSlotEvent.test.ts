/**
 * Tests createSlot — chemin « reel rattaché à une fiche tournage (clé API
 * eventId, Phase 5 : Entity) ». Fige :
 *  - compte forcé = compte du tournage
 *  - statut initial : tournage SHOT → IN_EDIT ; PLANNED → PLANNED
 *  - needsRushesOverride = false (chaîne démarre au montage)
 *  - shootEntityId persisté
 *  - tournage introuvable → NotFoundError
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotCreate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockBindingFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn().mockResolvedValue(null);
// Phase 5 : un seul mock Entity sert la fiche tournage (input.eventId) ET la
// fiche data (input.propertyId) — dispatch par where.id dans beforeEach.
const mockShootEventFindUnique = vi.fn();

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
    entity: { findUnique: (...a: unknown[]) => mockShootEventFindUnique(...a) },
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
  mockBindingFindUnique.mockReset().mockImplementation(() =>
    Promise.resolve(makeBinding("acc-ev")),
  );
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
      relatedEntityId: null,
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
    expect(data.shootEntityId).toBe("ev-1");
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
      relatedEntityId: null,
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

  it("événement DONE → reel IN_EDIT (rushs déjà là, comme SHOT)", async () => {
    mockShootEventFindUnique.mockResolvedValue({
      id: "ev-3",
      accountId: "acc-ev",
      relatedEntityId: null,
      status: "DONE",
      assigneeVideasteId: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
    });
    await createSlot({ eventId: "ev-3", patternBindingId: "bind-1" }, adminCtx());
    const data = mockSlotCreate.mock.calls[0][0].data;
    expect(data.status).toBe("IN_EDIT");
  });

  it("événement introuvable → NotFoundError", async () => {
    mockShootEventFindUnique.mockResolvedValue(null);
    await expect(
      createSlot({ eventId: "ghost", patternBindingId: "bind-1" }, adminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

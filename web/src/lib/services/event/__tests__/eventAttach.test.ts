/**
 * Tests attachReelToEvent — fige les correctifs de revue :
 *  - un non-admin ne peut PAS forwarder d'assignés/date/bien (strip privilèges)
 *  - un admin le peut
 *  - une recette source=auto_template est refusée
 *  - 404 anti-énumération (hors scope) vs 403 (rôle non habilité)
 *
 * createSlot est mocké pour capturer l'input effectif transmis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockShootEventFindUnique = vi.fn();
const mockBindingFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockActivityCreate = vi.fn().mockResolvedValue({ id: "act" });
const mockCreateSlot = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shootEvent: { findUnique: (...a: unknown[]) => mockShootEventFindUnique(...a) },
    patternBinding: {
      findUnique: (...a: unknown[]) => mockBindingFindUnique(...a),
      findFirst: (...a: unknown[]) => mockBindingFindFirst(...a),
    },
    shootEventActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
  },
}));

vi.mock("@/lib/services/slot/slotService", () => ({
  createSlot: (...a: unknown[]) => mockCreateSlot(...a),
  assertAssigneeRole: vi.fn().mockResolvedValue(undefined),
}));

// deleteR2Prefix importé par eventService — stub inoffensif.
vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn().mockResolvedValue(undefined) }));

import { attachReelToEvent } from "@/lib/services/event/eventService";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/services/_runtime/errors";

function ctx(role: string, id: string, isAdmin: boolean) {
  return {
    session: {} as unknown,
    actualUser: { id, role, name: null, email: null, permissions: "[]" },
    effectiveUser: { id, role, name: null, email: null, permissions: "[]" },
    isAdmin,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: isAdmin,
  } as Parameters<typeof attachReelToEvent>[2];
}

const EVENT = {
  id: "ev-1",
  accountId: "acc-1",
  status: "SHOT",
  assigneeVideasteId: "vid-1",
  defaultAssigneeMonteurId: "mon-1",
  defaultAssigneeCmId: "cm-1",
  slots: [] as Array<{ assigneeMonteurId: string | null; assigneeCmId: string | null }>,
};

beforeEach(() => {
  mockShootEventFindUnique.mockReset().mockResolvedValue({ ...EVENT });
  mockBindingFindUnique.mockReset().mockResolvedValue({
    patternTemplate: { source: "manual_rushes" },
  });
  mockBindingFindFirst.mockReset().mockResolvedValue({ id: "bind-fallback" });
  mockActivityCreate.mockReset().mockResolvedValue({ id: "act" });
  mockCreateSlot.mockReset().mockResolvedValue({ id: "slot-x" });
});

describe("attachReelToEvent — grammaire de champs par rôle", () => {
  it("MONTEUR : les overrides assignés/date/bien sont ignorés (strip)", async () => {
    // Le monteur a accès via defaultAssigneeMonteurId.
    await attachReelToEvent(
      "ev-1",
      {
        patternBindingId: "bind-1",
        assigneeCmId: "cm-arbitraire",
        assigneeMonteurId: "mon-autre",
        assigneeVideasteId: "vid-autre",
        scheduledAt: "2026-08-01T10:00:00Z",
        propertyId: "prop-x",
        title: "Reel A",
      },
      ctx("MONTEUR", "mon-1", false),
    );
    const slotInput = mockCreateSlot.mock.calls[0][0];
    expect(slotInput.assigneeCmId).toBeNull();
    expect(slotInput.assigneeMonteurId).toBeNull();
    expect(slotInput.assigneeVideasteId).toBeNull();
    expect(slotInput.scheduledAt).toBeNull();
    expect(slotInput.propertyId).toBeNull();
    // title/description (contenu) restent autorisés
    expect(slotInput.title).toBe("Reel A");
    expect(slotInput.eventId).toBe("ev-1");
  });

  it("ADMIN : les overrides sont conservés", async () => {
    await attachReelToEvent(
      "ev-1",
      {
        patternBindingId: "bind-1",
        assigneeCmId: "cm-choisi",
        scheduledAt: "2026-08-01T10:00:00Z",
        propertyId: "prop-x",
      },
      ctx("ADMIN", "admin-1", true),
    );
    const slotInput = mockCreateSlot.mock.calls[0][0];
    expect(slotInput.assigneeCmId).toBe("cm-choisi");
    expect(slotInput.scheduledAt).toBe("2026-08-01T10:00:00Z");
    expect(slotInput.propertyId).toBe("prop-x");
  });

  it("recette auto_template → ValidationError", async () => {
    mockBindingFindUnique.mockResolvedValue({ patternTemplate: { source: "auto_template" } });
    await expect(
      attachReelToEvent("ev-1", { patternBindingId: "bind-auto" }, ctx("ADMIN", "admin-1", true)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockCreateSlot).not.toHaveBeenCalled();
  });

  it("fallback : ne prend qu'un binding de montage (findFirst filtré par source)", async () => {
    await attachReelToEvent("ev-1", {}, ctx("ADMIN", "admin-1", true));
    const where = mockBindingFindFirst.mock.calls[0][0].where;
    expect(where.patternTemplate.source.in).toEqual(["manual_rushes", "external_upload"]);
  });
});

describe("attachReelToEvent — accès", () => {
  it("événement introuvable → NotFoundError", async () => {
    mockShootEventFindUnique.mockResolvedValue(null);
    await expect(
      attachReelToEvent("ghost", { patternBindingId: "b" }, ctx("MONTEUR", "mon-1", false)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hors scope (monteur non assigné) → NotFoundError (404 anti-énum)", async () => {
    mockShootEventFindUnique.mockResolvedValue({
      ...EVENT,
      defaultAssigneeMonteurId: "autre-mon",
      slots: [],
    });
    await expect(
      attachReelToEvent("ev-1", { patternBindingId: "b" }, ctx("MONTEUR", "mon-1", false)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("accessible mais rôle non habilité (CM) → ForbiddenError (403)", async () => {
    // Le CM a accès via defaultAssigneeCmId mais ne peut pas attacher.
    await expect(
      attachReelToEvent("ev-1", { patternBindingId: "b" }, ctx("CM", "cm-1", false)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

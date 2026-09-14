/**
 * Tests attachShootToSlot — fige le rattachement d'une publication à un
 * tournage APRÈS sa création.
 *
 * `shootEntityId` était write-once : le scénario RPOD (pré-shooter des slots
 * sans savoir combien de vidéos sortiront, puis les relier) était impossible.
 *
 * L'enjeu des tests est moins « est-ce que ça rattache » que « qu'est-ce que ça
 * ÉCRASE » : le rattachement rejoue une partie de createSlot, et rejouer la
 * mauvaise partie ferait régresser un reel déjà en production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockSlotUpdate = vi.fn();
const mockEntityFindUnique = vi.fn();
const mockActivityCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...a: unknown[]) => mockSlotFindUnique(...a),
      update: (...a: unknown[]) => mockSlotUpdate(...a),
    },
    entity: { findUnique: (...a: unknown[]) => mockEntityFindUnique(...a) },
    publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
  },
}));

vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn(), r2Configured: () => false }));

import { attachShootToSlot } from "@/lib/services/slot/slotService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(role: "ADMIN" | "MONTEUR" = "ADMIN") {
  const user = { id: `${role.toLowerCase()}-1`, role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof attachShootToSlot>[2];
}

/** Slot nu : aucun compte, aucun assigné, aucune fiche — tous les trous à combler. */
const SLOT = {
  id: "slot-1",
  status: "PLANNED",
  accountId: null,
  entityId: null,
  shootEntityId: null,
  assigneeMonteurId: null,
  assigneeCmId: null,
  assigneeVideasteId: null,
  needsRushesOverride: null,
  patternBinding: null,
  patternTemplate: {
    id: "pt1",
    label: "RVA1",
    source: "manual_rushes",
    templateId: null,
  },
};

const SHOOT = {
  id: "shoot-1",
  isArchived: false,
  accountId: "acc-1",
  relatedEntityId: "bien-1",
  status: "PLANNED",
  validationStatus: "APPROVED",
  assigneeVideasteId: "vid-9",
  defaultAssigneeMonteurId: "mon-9",
  defaultAssigneeCmId: "cm-9",
  type: { hasPlanning: true, hasRushes: true },
};

function lastData() {
  return mockSlotUpdate.mock.calls.at(-1)![0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSlotFindUnique.mockResolvedValue(SLOT);
  mockEntityFindUnique.mockResolvedValue(SHOOT);
  mockSlotUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...SLOT,
    ...args.data,
  }));
  mockActivityCreate.mockResolvedValue({ id: "act-1" });
});

describe("attachShootToSlot — permissions et cibles", () => {
  it("réservé aux admins", async () => {
    await expect(
      attachShootToSlot("slot-1", "shoot-1", ctx("MONTEUR")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("slot inexistant → 404", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    await expect(attachShootToSlot("nope", "shoot-1", ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("tournage inexistant → 404", async () => {
    mockEntityFindUnique.mockResolvedValue(null);
    await expect(attachShootToSlot("slot-1", "nope", ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("une fiche qui n'est pas un tournage est refusée", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...SHOOT,
      type: { hasPlanning: false, hasRushes: false },
    });
    await expect(attachShootToSlot("slot-1", "bien-1", ctx())).rejects.toThrow(
      /n'est pas un tournage/,
    );
  });

  it("un tournage archivé est refusé", async () => {
    mockEntityFindUnique.mockResolvedValue({ ...SHOOT, isArchived: true });
    await expect(attachShootToSlot("slot-1", "shoot-1", ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("un tournage en attente de validation est refusé", async () => {
    mockEntityFindUnique.mockResolvedValue({ ...SHOOT, validationStatus: "PENDING_ADMIN" });
    await expect(attachShootToSlot("slot-1", "shoot-1", ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  // Une recette auto se rend seule depuis un template : rien à partager avec
  // un tournage. Même garde qu'à la création d'un reel.
  it("une recette auto_template est refusée", async () => {
    mockSlotFindUnique.mockResolvedValue({
      ...SLOT,
      patternTemplate: { ...SLOT.patternTemplate, source: "auto_template" },
    });
    await expect(attachShootToSlot("slot-1", "shoot-1", ctx())).rejects.toThrow(
      /rushs ou à envoi externe/,
    );
  });
});

describe("attachShootToSlot — ce qui est hérité, ce qui est préservé", () => {
  it("comble les trous : compte, fiche liée, assignés", async () => {
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData()).toMatchObject({
      shootEntityId: "shoot-1",
      accountId: "acc-1",
      entityId: "bien-1",
      assigneeMonteurId: "mon-9",
      assigneeCmId: "cm-9",
      assigneeVideasteId: "vid-9",
    });
  });

  // Le point le plus important : un rattachement ne doit rien voler à un slot
  // déjà en production. Un monteur assigné garde sa place.
  it("n'écrase JAMAIS une valeur déjà posée", async () => {
    mockSlotFindUnique.mockResolvedValue({
      ...SLOT,
      accountId: "acc-1",
      entityId: "bien-perso",
      assigneeMonteurId: "mon-perso",
      assigneeCmId: "cm-perso",
      assigneeVideasteId: "vid-perso",
    });
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    const data = lastData();
    expect(data).not.toHaveProperty("entityId");
    expect(data).not.toHaveProperty("assigneeMonteurId");
    expect(data).not.toHaveProperty("assigneeCmId");
    expect(data).not.toHaveProperty("assigneeVideasteId");
  });

  // Écraser le compte déplacerait un slot déjà planifié vers un autre
  // calendrier, sans que personne ne le voie partir. On refuse.
  it("des comptes différents → conflit, pas un écrasement silencieux", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, accountId: "acc-autre" });
    await expect(attachShootToSlot("slot-1", "shoot-1", ctx())).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("pose needsRushesOverride=false — les rushs vivent sur le tournage", async () => {
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData().needsRushesOverride).toBe(false);
  });

  it("mais respecte un override explicite déjà posé", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, needsRushesOverride: true });
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData()).not.toHaveProperty("needsRushesOverride");
  });
});

describe("attachShootToSlot — statut", () => {
  it("tournage déjà SHOT → le reel PLANNED démarre le montage", async () => {
    mockEntityFindUnique.mockResolvedValue({ ...SHOOT, status: "SHOT" });
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData().status).toBe("IN_EDIT");
  });

  it("tournage PLANNED → le statut ne bouge pas", async () => {
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData()).not.toHaveProperty("status");
  });

  // Forcer PLANNED (comme le fait createSlot) ferait REGRESSER un reel déjà
  // monté : c'est précisément la partie de createSlot à ne pas rejouer.
  it("un reel déjà en montage n'est jamais ramené en arrière", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, status: "EDIT_APPROVED" });
    mockEntityFindUnique.mockResolvedValue({ ...SHOOT, status: "SHOT" });
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(lastData()).not.toHaveProperty("status");
  });
});

describe("attachShootToSlot — détachement", () => {
  it("détache et ne relance PAS de demande de rushs", async () => {
    mockSlotFindUnique.mockResolvedValue({
      ...SLOT,
      shootEntityId: "shoot-1",
      needsRushesOverride: false,
    });
    await attachShootToSlot("slot-1", null, ctx());
    const data = lastData();
    expect(data.shootEntityId).toBeNull();
    // Repasser needsRushesOverride à true réclamerait des rushs sur un reel
    // potentiellement déjà monté.
    expect(data).not.toHaveProperty("needsRushesOverride");
  });

  it("détacher un slot sans tournage est un conflit", async () => {
    await expect(attachShootToSlot("slot-1", null, ctx())).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("attachShootToSlot — traçabilité", () => {
  it("écrit une activité qui nomme le tournage", async () => {
    await attachShootToSlot("slot-1", "shoot-1", ctx());
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "STATUS_CHANGED",
          payload: expect.objectContaining({ shootEntityId: "shoot-1", reason: "attach-shoot" }),
        }),
      }),
    );
  });
});

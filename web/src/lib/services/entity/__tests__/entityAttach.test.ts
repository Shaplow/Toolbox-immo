/**
 * Tests attachSlotToEntity — fige les deux chemins fusionnés :
 *  - « reel » (fiche team, ex-Tournage) : port d'attachReelToEvent — grammaire
 *    de champs par rôle (strip pour non-admin), recette auto_template refusée,
 *    404 anti-énumération (hors scope) vs 403 (rôle non habilité).
 *  - « missions » (fiche admin, ex-Bien) : port de properties/[id]/missions —
 *    gating par outil `mission` (hasTool) OU admin réel, N recettes → N slots.
 *
 * createSlot est mocké pour capturer l'input effectif transmis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityFindUnique = vi.fn();
const mockBindingFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockTemplateFindMany = vi.fn();
const mockActivityCreate = vi.fn().mockResolvedValue({ id: "act" });
const mockCreateSlot = vi.fn();
const mockHasTool = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: { findUnique: (...a: unknown[]) => mockEntityFindUnique(...a) },
    patternBinding: {
      findUnique: (...a: unknown[]) => mockBindingFindUnique(...a),
      findFirst: (...a: unknown[]) => mockBindingFindFirst(...a),
    },
    patternTemplate: { findMany: (...a: unknown[]) => mockTemplateFindMany(...a) },
    entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
  },
}));

vi.mock("@/lib/services/slot/slotService", () => ({
  createSlot: (...a: unknown[]) => mockCreateSlot(...a),
  assertAssigneeRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/permissions", () => ({
  hasTool: (...a: unknown[]) => mockHasTool(...a),
  TOOLS: { MISSION: "mission" },
}));

// deleteR2Prefix importé par entityService — stub inoffensif.
vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn().mockResolvedValue(undefined) }));

import { attachSlotToEntity } from "@/lib/services/entity/entityService";
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
  } as Parameters<typeof attachSlotToEntity>[2];
}

const TEAM_ENTITY = {
  id: "ent-1",
  isArchived: false,
  type: { visibility: "team", hasPlanning: true, hasRushes: true },
  accountId: "acc-1",
  status: "SHOT",
  assigneeVideasteId: "vid-1",
  defaultAssigneeMonteurId: "mon-1",
  defaultAssigneeCmId: "cm-1",
  shootSlots: [] as Array<{ assigneeMonteurId: string | null; assigneeCmId: string | null }>,
};

const ADMIN_ENTITY = {
  id: "ent-2",
  isArchived: false,
  type: { visibility: "admin", hasPlanning: false, hasRushes: false },
  accountId: null as string | null,
  status: null as string | null,
  assigneeVideasteId: null as string | null,
  defaultAssigneeMonteurId: null as string | null,
  defaultAssigneeCmId: null as string | null,
  shootSlots: [] as Array<{ assigneeMonteurId: string | null; assigneeCmId: string | null }>,
};

beforeEach(() => {
  mockEntityFindUnique.mockReset().mockResolvedValue({ ...TEAM_ENTITY });
  mockBindingFindUnique.mockReset().mockResolvedValue({
    patternTemplate: { source: "manual_rushes" },
  });
  mockBindingFindFirst.mockReset().mockResolvedValue({ id: "bind-fallback" });
  mockTemplateFindMany.mockReset().mockResolvedValue([
    { id: "r1", label: "Recette 1", templateId: "tpl-1" },
    { id: "r2", label: "Recette 2", templateId: null },
  ]);
  mockActivityCreate.mockReset().mockResolvedValue({ id: "act" });
  mockCreateSlot.mockReset().mockResolvedValue({ id: "slot-x" });
  mockHasTool.mockReset().mockResolvedValue(false);
});

describe("attachSlotToEntity — chemin reel (fiche team)", () => {
  it("MONTEUR : les overrides assignés/date/bien sont ignorés (strip)", async () => {
    // Le monteur a accès via defaultAssigneeMonteurId.
    const res = await attachSlotToEntity(
      "ent-1",
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
    expect(res.mode).toBe("reel");
    const slotInput = mockCreateSlot.mock.calls[0][0];
    expect(slotInput.assigneeCmId).toBeNull();
    expect(slotInput.assigneeMonteurId).toBeNull();
    expect(slotInput.assigneeVideasteId).toBeNull();
    expect(slotInput.scheduledAt).toBeNull();
    expect(slotInput.propertyId).toBeNull();
    // title/description (contenu) restent autorisés
    expect(slotInput.title).toBe("Reel A");
    expect(slotInput.eventId).toBe("ent-1");
  });

  it("ADMIN : les overrides sont conservés", async () => {
    await attachSlotToEntity(
      "ent-1",
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
      attachSlotToEntity("ent-1", { patternBindingId: "bind-auto" }, ctx("ADMIN", "admin-1", true)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockCreateSlot).not.toHaveBeenCalled();
  });

  it("fallback : ne prend qu'un binding de montage (findFirst filtré par source)", async () => {
    await attachSlotToEntity("ent-1", {}, ctx("ADMIN", "admin-1", true));
    const where = mockBindingFindFirst.mock.calls[0][0].where;
    expect(where.patternTemplate.source.in).toEqual(["manual_rushes", "external_upload"]);
  });

  it("fiche introuvable → NotFoundError", async () => {
    mockEntityFindUnique.mockResolvedValue(null);
    await expect(
      attachSlotToEntity("ghost", { patternBindingId: "b" }, ctx("MONTEUR", "mon-1", false)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hors scope (monteur non assigné) → NotFoundError (404 anti-énum)", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...TEAM_ENTITY,
      defaultAssigneeMonteurId: "autre-mon",
      shootSlots: [],
    });
    await expect(
      attachSlotToEntity("ent-1", { patternBindingId: "b" }, ctx("MONTEUR", "mon-1", false)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("accessible mais rôle non habilité (CM) → ForbiddenError (403)", async () => {
    // Le CM a accès via defaultAssigneeCmId mais ne peut pas attacher.
    await expect(
      attachSlotToEntity("ent-1", { patternBindingId: "b" }, ctx("CM", "cm-1", false)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("attachSlotToEntity — chemin missions (fiche admin)", () => {
  beforeEach(() => {
    mockEntityFindUnique.mockResolvedValue({ ...ADMIN_ENTITY });
  });

  it("sans outil mission ni admin → ForbiddenError", async () => {
    mockHasTool.mockResolvedValue(false);
    await expect(
      attachSlotToEntity("ent-2", { recipeIds: ["r1"] }, ctx("CM", "cm-1", false)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockCreateSlot).not.toHaveBeenCalled();
  });

  it("aucune recette → ValidationError", async () => {
    await expect(
      attachSlotToEntity("ent-2", { recipeIds: [] }, ctx("ADMIN", "admin-1", true)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("admin : crée un slot par recette avec propertyId=entityId + templateId hérité", async () => {
    mockCreateSlot.mockResolvedValueOnce({ id: "slot-1" }).mockResolvedValueOnce({ id: "slot-2" });
    const res = await attachSlotToEntity(
      "ent-2",
      { recipeIds: ["r1", "r2"], accountId: "acc-9" },
      ctx("ADMIN", "admin-1", true),
    );
    expect(res).toEqual({ mode: "missions", createdIds: ["slot-1", "slot-2"], count: 2, failed: [] });
    expect(mockCreateSlot).toHaveBeenCalledTimes(2);
    const firstCall = mockCreateSlot.mock.calls[0][0];
    expect(firstCall.propertyId).toBe("ent-2");
    expect(firstCall.accountId).toBe("acc-9");
    expect(firstCall.patternTemplateId).toBe("r1");
    // Sans ça, pas de bouton « Ouvrir le formulaire de génération » sur le slot.
    expect(firstCall.templateId).toBe("tpl-1");
    expect(mockCreateSlot.mock.calls[1][0].templateId).toBeNull();
  });

  it("échec partiel : les autres recettes passent, l'échec est remonté", async () => {
    mockCreateSlot
      .mockResolvedValueOnce({ id: "slot-1" })
      .mockRejectedValueOnce(new ValidationError("La fiche fournie n'est pas du type requis par la recette"));
    const res = await attachSlotToEntity(
      "ent-2",
      { recipeIds: ["r1", "r2"] },
      ctx("ADMIN", "admin-1", true),
    );
    expect(res).toEqual({
      mode: "missions",
      createdIds: ["slot-1"],
      count: 1,
      failed: [
        {
          recipeId: "r2",
          label: "Recette 2",
          error: "La fiche fournie n'est pas du type requis par la recette",
        },
      ],
    });
  });

  it("recette inconnue → failed « Recette introuvable », sans appel createSlot", async () => {
    mockTemplateFindMany.mockResolvedValue([]);
    const res = await attachSlotToEntity(
      "ent-2",
      { recipeIds: ["ghost"] },
      ctx("ADMIN", "admin-1", true),
    );
    expect(res).toEqual({
      mode: "missions",
      createdIds: [],
      count: 0,
      failed: [{ recipeId: "ghost", label: "ghost", error: "Recette introuvable" }],
    });
    expect(mockCreateSlot).not.toHaveBeenCalled();
  });

  it("user avec outil mission (non-admin) → autorisé", async () => {
    mockHasTool.mockResolvedValue(true);
    mockCreateSlot.mockResolvedValueOnce({ id: "slot-1" });
    const res = await attachSlotToEntity(
      "ent-2",
      { recipeIds: ["r1"] },
      ctx("EXTERNAL_GENERATOR", "ext-1", false),
    );
    expect(res.mode).toBe("missions");
    expect(mockHasTool).toHaveBeenCalledWith("ext-1", "mission");
  });
});

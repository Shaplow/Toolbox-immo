/**
 * Tests bulkPatchEntities — actions groupées sur les fiches.
 *
 * Deux invariants portent tout le reste :
 *
 *  1. RÉSULTATS PARTIELS. Sur un lot dont quelques fiches refusent, les autres
 *     passent et l'admin apprend lesquelles ont résisté. Un tout-ou-rien lui
 *     ferait tout reperdre pour trois cas.
 *  2. PAS D'updateMany. Chaque fiche passe par patchEntity / deleteEntity, qui
 *     portent les gardes (publications rattachées, commande en cours, fiches
 *     liées) et écrivent le journal.
 *
 * Prisma est mocké au niveau module et les VRAIES patchEntity / deleteEntity
 * s'exécutent : c'est ce qui rend le test fidèle. Espionner les deux fonctions
 * n'aurait rien prouvé — appelées depuis le même module, elles ne passent pas
 * par l'objet exporté et le mock serait resté inerte.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityFindMany = vi.fn();
const mockEntityFindUnique = vi.fn();
const mockEntityUpdate = vi.fn();
const mockEntityUpdateMany = vi.fn();
const mockEntityDelete = vi.fn();
const mockActivityCreate = vi.fn();
const mockSlotUpdateMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: {
      findMany: (...a: unknown[]) => mockEntityFindMany(...a),
      findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
      update: (...a: unknown[]) => mockEntityUpdate(...a),
      updateMany: (...a: unknown[]) => mockEntityUpdateMany(...a),
      delete: (...a: unknown[]) => mockEntityDelete(...a),
    },
    entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    publicationSlot: { updateMany: (...a: unknown[]) => mockSlotUpdateMany(...a) },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn(), r2Configured: () => false }));

import {
  bulkPatchEntities,
  MAX_BULK_ENTITIES,
} from "@/lib/services/entity/entityService";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";

function ctx(role: "ADMIN" | "MONTEUR" = "ADMIN") {
  const user = { id: "u-1", role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof bulkPatchEntities>[1];
}

/** Fiche telle que la lisent patchEntity (accès) et deleteEntity (gardes). */
function entityRow(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    typeId: "etype_bien",
    type: {
      visibility: "admin",
      hasPlanning: false,
      fieldSchema: "[]",
      name: "Bien",
      labelTemplate: null,
    },
    label: "Villa",
    labelIsCustom: true,
    fields: "{}",
    orderId: null,
    order: null,
    status: null,
    scheduledAt: null,
    endAt: null,
    validationStatus: "APPROVED",
    assigneeVideasteId: null,
    videasteConfirmation: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    isArchived: false,
    shootSlots: [],
    _count: { slots: 0, shootSlots: 0, relatedOf: 0 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntityFindMany.mockResolvedValue([
    { id: "e1", label: "Villa" },
    { id: "e2", label: "Studio" },
  ]);
  mockEntityFindUnique.mockImplementation(async (args: { where: { id: string } }) =>
    entityRow({ id: args.where.id }),
  );
  // `entityListSelect` : patchEntity relit le type juste après l'update pour
  // le recalcul de libellé — un mock à deux champs le fait planter.
  mockEntityUpdate.mockImplementation(async (args: { where: { id: string } }) => ({
    id: args.where.id,
    label: "Villa",
    type: { id: "etype_bien", name: "Bien", fieldSchema: "[]", labelTemplate: null },
    fields: "{}",
  }));
  mockUserFindUnique.mockResolvedValue({ role: "VIDEASTE" });
  mockEntityDelete.mockResolvedValue({ id: "e1" });
  mockActivityCreate.mockResolvedValue({ id: "act-1" });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      entity: {
        update: (...a: unknown[]) => mockEntityUpdate(...a),
        findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
        updateMany: (...a: unknown[]) => mockEntityUpdateMany(...a),
      },
      entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
      publicationSlot: { updateMany: (...a: unknown[]) => mockSlotUpdateMany(...a) },
    }),
  );
});

describe("bulkPatchEntities — gardes d'entrée", () => {
  it("réservé aux admins", async () => {
    await expect(
      bulkPatchEntities({ ids: ["e1"], action: "archive" }, ctx("MONTEUR")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sélection vide refusée", async () => {
    await expect(bulkPatchEntities({ ids: [], action: "archive" }, ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("au-delà de la borne, refusé", async () => {
    const ids = Array.from({ length: MAX_BULK_ENTITIES + 1 }, (_, i) => `e${i}`);
    await expect(bulkPatchEntities({ ids, action: "archive" }, ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("les ids en double ne sont traités qu'une fois", async () => {
    const result = await bulkPatchEntities({ ids: ["e1", "e1", "e1"], action: "archive" }, ctx());
    expect(result.ok).toEqual(["e1"]);
    expect(mockEntityUpdate).toHaveBeenCalledTimes(1);
  });

  it("une réassignation sans aucun assigné est refusée", async () => {
    await expect(
      bulkPatchEntities({ ids: ["e1"], action: "reassign", assignees: {} }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("bulkPatchEntities — actions", () => {
  it("archive et désarchive écrivent isArchived", async () => {
    await bulkPatchEntities({ ids: ["e1"], action: "archive" }, ctx());
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isArchived: true }) }),
    );

    vi.clearAllMocks();
    mockEntityFindUnique.mockResolvedValue(entityRow({ isArchived: true }));
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        entity: {
          update: (...a: unknown[]) => mockEntityUpdate(...a),
          findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
        },
        entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
      }),
    );
    await bulkPatchEntities({ ids: ["e1"], action: "unarchive" }, ctx());
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isArchived: false }) }),
    );
  });

  it("la réassignation écrit les rôles fournis, fiche par fiche", async () => {
    await bulkPatchEntities(
      { ids: ["e1", "e2"], action: "reassign", assignees: { assigneeVideasteId: "vid-9" } },
      ctx(),
    );
    expect(mockEntityUpdate).toHaveBeenCalledTimes(2);
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeVideasteId: "vid-9" }) }),
    );
    // Un updateMany court-circuiterait les gardes, le journal et la remise à
    // null de videasteConfirmation.
    expect(mockEntityUpdateMany).not.toHaveBeenCalled();
  });

  it("chaque action écrit une entrée de journal", async () => {
    await bulkPatchEntities({ ids: ["e1", "e2"], action: "archive" }, ctx());
    expect(mockActivityCreate).toHaveBeenCalledTimes(2);
  });

  it("la suppression passe par deleteEntity", async () => {
    const result = await bulkPatchEntities({ ids: ["e1"], action: "delete" }, ctx());
    expect(mockEntityDelete).toHaveBeenCalledWith({ where: { id: "e1" } });
    expect(result.ok).toEqual(["e1"]);
  });
});

describe("bulkPatchEntities — résultats partiels", () => {
  // Le cœur du contrat : une fiche qui porte des publications ne doit pas faire
  // échouer les 39 autres, et l'admin doit savoir LAQUELLE corriger.
  it("une fiche avec publications échoue seule, les autres passent", async () => {
    mockEntityFindUnique.mockImplementation(async (args: { where: { id: string } }) =>
      entityRow({
        id: args.where.id,
        _count:
          args.where.id === "e1"
            ? { slots: 2, shootSlots: 0, relatedOf: 0 }
            : { slots: 0, shootSlots: 0, relatedOf: 0 },
      }),
    );

    const result = await bulkPatchEntities({ ids: ["e1", "e2"], action: "delete" }, ctx());

    expect(result.ok).toEqual(["e2"]);
    expect(result.failed).toEqual([
      {
        id: "e1",
        // Le libellé, pas juste l'id : l'admin doit savoir quelle fiche corriger.
        label: "Villa",
        error: expect.stringContaining("référencée par des publications"),
      },
    ]);
  });

  // Trou réel comblé au passage : `relatedEntityId` est en SetNull, donc la
  // base aurait délié les tournages d'un bien SANS RIEN DIRE.
  it("une fiche liée à d'autres fiches est refusée", async () => {
    mockEntityFindUnique.mockResolvedValue(
      entityRow({ _count: { slots: 0, shootSlots: 0, relatedOf: 3 } }),
    );
    const result = await bulkPatchEntities({ ids: ["e1"], action: "delete" }, ctx());
    expect(result.ok).toEqual([]);
    expect(result.failed[0].error).toMatch(/liée à 3 autre\(s\) fiche\(s\)/);
    expect(mockEntityDelete).not.toHaveBeenCalled();
  });

  it("tout échouer ne lève pas d'exception globale", async () => {
    mockEntityFindUnique.mockResolvedValue(null);
    const result = await bulkPatchEntities({ ids: ["e1", "e2"], action: "archive" }, ctx());
    expect(result.ok).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });

  it("une fiche introuvable garde son id comme libellé de repli", async () => {
    mockEntityFindMany.mockResolvedValue([]);
    mockEntityFindUnique.mockResolvedValue(null);
    const result = await bulkPatchEntities({ ids: ["e-disparue"], action: "archive" }, ctx());
    expect(result.failed[0]).toMatchObject({ id: "e-disparue", label: "e-disparue" });
  });
});

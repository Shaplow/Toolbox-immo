/**
 * Tests orderTemplateService — fige la validation de composition :
 * items ≥1 dédupliqués/existants, recettes non archivées + count borné,
 * clients existants, delete refusé si commandes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityTypeFindMany = vi.fn();
const mockPatternTemplateFindMany = vi.fn();
const mockClientFindMany = vi.fn();
const mockOrderTemplateFindUnique = vi.fn();
const mockOrderTemplateDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entityType: { findMany: (...a: unknown[]) => mockEntityTypeFindMany(...a) },
    patternTemplate: { findMany: (...a: unknown[]) => mockPatternTemplateFindMany(...a) },
    client: { findMany: (...a: unknown[]) => mockClientFindMany(...a) },
    orderTemplate: {
      findUnique: (...a: unknown[]) => mockOrderTemplateFindUnique(...a),
      delete: (...a: unknown[]) => mockOrderTemplateDelete(...a),
    },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  createOrderTemplate,
  deleteOrderTemplate,
  type OrderTemplateInput,
} from "@/lib/services/order/orderTemplateService";
import { ConflictError, ValidationError } from "@/lib/services/_runtime/errors";

function baseInput(over: Partial<OrderTemplateInput> = {}): OrderTemplateInput {
  return {
    name: "Bien + tournage",
    items: [{ entityTypeId: "etype_bien" }, { entityTypeId: "etype_tournage" }],
    recipes: [{ patternTemplateId: "pt1", count: 3 }],
    clientIds: ["c1"],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntityTypeFindMany.mockResolvedValue([{ id: "etype_bien" }, { id: "etype_tournage" }]);
  mockPatternTemplateFindMany.mockResolvedValue([
    { id: "pt1", isArchived: false, label: "Reel visite" },
  ]);
  mockClientFindMany.mockResolvedValue([{ id: "c1" }]);
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      orderTemplate: {
        create: vi.fn().mockResolvedValue({ id: "ot1" }),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "ot1" }),
      },
      orderTemplateItem: { createMany: vi.fn(), deleteMany: vi.fn() },
      orderTemplateRecipe: { createMany: vi.fn(), deleteMany: vi.fn() },
      orderTemplateAccess: { createMany: vi.fn(), deleteMany: vi.fn() },
    }),
  );
});

describe("createOrderTemplate — validation", () => {
  it("crée un modèle valide", async () => {
    const result = await createOrderTemplate(baseInput());
    expect(result).toEqual({ id: "ot1" });
  });

  it("nom requis", async () => {
    await expect(createOrderTemplate(baseInput({ name: "  " }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("au moins un type de fiche", async () => {
    await expect(createOrderTemplate(baseInput({ items: [] }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("types dupliqués refusés", async () => {
    await expect(
      createOrderTemplate(
        baseInput({ items: [{ entityTypeId: "etype_bien" }, { entityTypeId: "etype_bien" }] }),
      ),
    ).rejects.toThrow(/qu'une fois/);
  });

  it("type inexistant refusé", async () => {
    mockEntityTypeFindMany.mockResolvedValue([{ id: "etype_bien" }]);
    await expect(createOrderTemplate(baseInput())).rejects.toThrow(/n'existe pas/);
  });

  it("count hors bornes refusé (0, 21, non entier)", async () => {
    for (const count of [0, 21, 1.5]) {
      await expect(
        createOrderTemplate(baseInput({ recipes: [{ patternTemplateId: "pt1", count }] })),
      ).rejects.toThrow(/vidéos invalide/);
    }
  });

  it("recette archivée refusée", async () => {
    mockPatternTemplateFindMany.mockResolvedValue([
      { id: "pt1", isArchived: true, label: "Reel visite" },
    ]);
    await expect(createOrderTemplate(baseInput())).rejects.toThrow(/archivée/);
  });

  it("client inexistant refusé", async () => {
    mockClientFindMany.mockResolvedValue([]);
    await expect(createOrderTemplate(baseInput())).rejects.toThrow(/clients n'existe pas/);
  });

  it("recettes et clients optionnels (modèle fiches-seules)", async () => {
    const result = await createOrderTemplate(baseInput({ recipes: [], clientIds: [] }));
    expect(result).toEqual({ id: "ot1" });
    expect(mockPatternTemplateFindMany).not.toHaveBeenCalled();
    expect(mockClientFindMany).not.toHaveBeenCalled();
  });
});

describe("deleteOrderTemplate", () => {
  it("supprime un modèle sans commande", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue({ id: "ot1", _count: { orders: 0 } });
    await deleteOrderTemplate("ot1");
    expect(mockOrderTemplateDelete).toHaveBeenCalled();
  });

  it("409 si des commandes utilisent le modèle", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue({ id: "ot1", _count: { orders: 2 } });
    await expect(deleteOrderTemplate("ot1")).rejects.toBeInstanceOf(ConflictError);
  });
});

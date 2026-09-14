/**
 * Tests deployTemplatesToAccounts — « appliquer à des comptes » sur PLUSIEURS
 * recettes d'un coup (« c'est trop long 1 par 1 »).
 *
 * Ce qui compte ici n'est pas « est-ce que ça crée » mais la frontière entre
 * les deux natures d'échec : une garde COMMUNE (planning invalide, droits)
 * remonte telle quelle et n'est pas répétée N fois ; une erreur PROPRE à une
 * recette (archivée, introuvable) n'annule jamais les autres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTemplateFindUnique = vi.fn();
const mockBindingFindMany = vi.fn();
const mockAccountFindMany = vi.fn();
const mockBindingCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patternTemplate: { findUnique: (...a: unknown[]) => mockTemplateFindUnique(...a) },
    patternBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    instagramAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ patternBinding: { create: (...a: unknown[]) => mockBindingCreate(...a) } }),
  },
}));

vi.mock("@/lib/services/slot/slotService", () => ({
  assertAssigneeRole: vi.fn(async () => undefined),
}));

import {
  deployTemplatesToAccounts,
  DEPLOY_MAX_TEMPLATES,
} from "@/lib/services/pattern/deployTemplate";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";

function ctx(role: "ADMIN" | "MONTEUR" = "ADMIN") {
  const user = { id: "u1", role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof deployTemplatesToAccounts>[1];
}

const BASE = {
  accountIds: ["acc1", "acc2"],
  publishTime: "10:00",
  dayOfWeek: [] as number[],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTemplateFindUnique.mockResolvedValue({ id: "t1", isArchived: false });
  mockBindingFindMany.mockResolvedValue([]);
  mockAccountFindMany.mockResolvedValue([{ id: "acc1" }, { id: "acc2" }]);
  let n = 0;
  mockBindingCreate.mockImplementation(async () => ({ id: `b${++n}` }));
});

describe("deployTemplatesToAccounts", () => {
  it("N recettes × N comptes : un couple par liaison", async () => {
    const result = await deployTemplatesToAccounts(
      { ...BASE, patternTemplateIds: ["t1", "t2"] },
      ctx(),
    );
    expect(result.createdCount).toBe(4);
    expect(result.ok).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });

  it("une recette archivée n'annule pas les autres", async () => {
    mockTemplateFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "t2" ? { id: "t2", isArchived: true } : { id: where.id, isArchived: false },
    );
    const result = await deployTemplatesToAccounts(
      { ...BASE, patternTemplateIds: ["t1", "t2", "t3"] },
      ctx(),
    );
    expect(result.ok.map((o) => o.patternTemplateId)).toEqual(["t1", "t3"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].patternTemplateId).toBe("t2");
    expect(result.createdCount).toBe(4);
  });

  /**
   * Le cas qui a fait bouger le code : si la PREMIÈRE recette est archivée, le
   * lot ne doit pas s'arrêter là. Une erreur propre à une recette ne dit rien
   * des suivantes.
   */
  it("une recette archivée EN TÊTE de liste ne fait pas tomber le lot", async () => {
    mockTemplateFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "t1" ? { id: "t1", isArchived: true } : { id: where.id, isArchived: false },
    );
    const result = await deployTemplatesToAccounts(
      { ...BASE, patternTemplateIds: ["t1", "t2"] },
      ctx(),
    );
    expect(result.failed.map((f) => f.patternTemplateId)).toEqual(["t1"]);
    expect(result.ok.map((o) => o.patternTemplateId)).toEqual(["t2"]);
  });

  it("une garde COMMUNE remonte telle quelle, sans être répétée par recette", async () => {
    await expect(
      deployTemplatesToAccounts(
        { ...BASE, publishTime: "25:99", patternTemplateIds: ["t1", "t2"] },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    // Aucune recette n'a été touchée : la cause ne dépendait d'aucune d'elles.
    expect(mockTemplateFindUnique).not.toHaveBeenCalled();
  });

  it("les couples déjà liés sont skippés, pas dupliqués", async () => {
    mockBindingFindMany.mockResolvedValue([{ accountId: "acc1" }]);
    const result = await deployTemplatesToAccounts(
      { ...BASE, patternTemplateIds: ["t1"] },
      ctx(),
    );
    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it("ids dédupliqués, liste vide refusée, plafond respecté", async () => {
    const result = await deployTemplatesToAccounts(
      { ...BASE, patternTemplateIds: ["t1", "t1"] },
      ctx(),
    );
    expect(result.ok).toHaveLength(1);

    await expect(
      deployTemplatesToAccounts({ ...BASE, patternTemplateIds: [] }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      deployTemplatesToAccounts(
        {
          ...BASE,
          patternTemplateIds: Array.from({ length: DEPLOY_MAX_TEMPLATES + 1 }, (_, i) => `t${i}`),
        },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("réservé aux administrateurs", async () => {
    await expect(
      deployTemplatesToAccounts({ ...BASE, patternTemplateIds: ["t1"] }, ctx("MONTEUR")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * Tests weekFillService — la couche base du remplissage de semaine.
 *
 * Le calcul du tourniquet est figé ailleurs (`lib/calendar/__tests__/dispatch`).
 * Ici on verrouille ce que la base a le droit de proposer et d'écrire :
 * quelles recettes entrent dans le pool, ce qui compte comme un usage, et
 * surtout les deux gardes qui ne peuvent PAS vivre côté client — l'occupation
 * revérifiée au jour, et la collision d'instants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccountFindMany = vi.fn(async () => [] as unknown[]);
const mockBindingFindMany = vi.fn(async () => [] as unknown[]);
const mockSlotFindMany = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    patternBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    publicationSlot: { findMany: (...a: unknown[]) => mockSlotFindMany(...a) },
  },
}));

const mockCreateSlot = vi.fn(async () => ({ id: "slot-new" }));
vi.mock("@/lib/services/slot/slotService", () => ({
  createSlot: (...a: unknown[]) => mockCreateSlot(...a),
}));

import {
  applyWeekFill,
  buildWeekFillContext,
  dispatchWindow,
  WEEK_FILL_MAX_CELLS,
} from "@/lib/services/calendar/weekFillService";
import { dayIndexFromKey } from "@/lib/calendar/dispatch";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";

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
  } as Parameters<typeof applyWeekFill>[1];
}

const WINDOW = {
  windowFrom: new Date("2026-07-01T00:00:00.000Z"),
  windowTo: new Date("2027-01-01T00:00:00.000Z"),
};

function bindingRow(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    accountId: "acc1",
    patternTemplateId: "pt1",
    publishTime: "09:00",
    customLabel: null,
    patternTemplate: { label: "RAUTO 1", createdAt: new Date("2026-01-01T00:00:00Z"), templateId: "tpl-1" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccountFindMany.mockResolvedValue([{ id: "acc1", name: "Meng", handle: "meng_paris" }]);
  mockBindingFindMany.mockResolvedValue([bindingRow()]);
  mockSlotFindMany.mockResolvedValue([]);
  mockCreateSlot.mockResolvedValue({ id: "slot-new" });
});

describe("buildWeekFillContext — ce qui entre dans le pool", () => {
  it("ne propose que des recettes auto, actives, non archivées et sans fiche exigée", async () => {
    await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });

    expect(mockBindingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          patternTemplate: expect.objectContaining({
            isArchived: false,
            source: "auto_template",
            // Une recette qui exige une fiche n'est pas générable en lot —
            // même règle que le moteur hebdo.
            requiresEntityTypeId: null,
            requiresProperty: false,
          }),
        }),
      }),
    );
  });

  it("un périmètre vide ne coûte aucune requête", async () => {
    const ctxResult = await buildWeekFillContext({ accountIds: [], ...WINDOW });
    expect(ctxResult.pool).toEqual([]);
    expect(mockBindingFindMany).not.toHaveBeenCalled();
    expect(mockSlotFindMany).not.toHaveBeenCalled();
  });

  /**
   * Une publication annulée ou archivée n'a jamais touché l'audience : la
   * compter pénaliserait une recette parfaitement disponible.
   */
  it("l'historique ignore les publications annulées et archivées", async () => {
    await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });
    expect(mockSlotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: ["CANCELLED", "ARCHIVED"] },
        }),
      }),
    );
  });

  it("l'historique est borné aux comptes du périmètre", async () => {
    await buildWeekFillContext({ accountIds: ["acc1", "acc2"], ...WINDOW });
    expect(mockSlotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: { in: ["acc1", "acc2"] } }),
      }),
    );
  });

  /**
   * L'identité « quelle recette » : le binding fait foi, le template direct est
   * le repli des missions sans compte.
   */
  it("reconstitue l'usage depuis le binding, avec repli sur le template direct", async () => {
    mockSlotFindMany.mockResolvedValue([
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-10-05T09:00:00.000Z"),
        patternTemplateId: null,
        patternTemplate: null,
        patternBinding: { patternTemplateId: "pt1", patternTemplate: { templateId: "tpl-1" } },
      },
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-10-06T09:00:00.000Z"),
        patternTemplateId: "pt-direct",
        patternTemplate: { templateId: null },
        patternBinding: null,
      },
    ]);

    const result = await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });

    // Indexé par CONTENU : le template builder quand il existe, la recette sinon.
    expect(result.existingUse["tpl-1"].allDays).toEqual([dayIndexFromKey("2026-10-05")]);
    expect(result.existingUse["pt-direct"].allDays).toEqual([dayIndexFromKey("2026-10-06")]);
    expect(result.occupiedByAccount.acc1).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("le pool compte sur combien de comptes chaque recette est activée", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow({ id: "b1", accountId: "acc1" }),
      bindingRow({ id: "b2", accountId: "acc2" }),
      bindingRow({ id: "b3", accountId: "acc1", patternTemplateId: "pt2",
        patternTemplate: { label: "RAUTO 2", createdAt: new Date("2026-01-02T00:00:00Z"), templateId: "tpl-2" } }),
    ]);
    const result = await buildWeekFillContext({ accountIds: ["acc1", "acc2"], ...WINDOW });
    expect(result.pool).toEqual([
      { patternTemplateId: "pt1", label: "RAUTO 1", accountCount: 2 },
      { patternTemplateId: "pt2", label: "RAUTO 2", accountCount: 1 },
    ]);
  });
});

describe("applyWeekFill — l'écriture", () => {
  const cell = (over: Record<string, unknown> = {}) => ({
    accountId: "acc1",
    patternBindingId: "b1",
    dayKey: "2026-10-05",
    time: "09:00",
    ...over,
  });

  it("crée par createSlot, jamais en écriture directe", async () => {
    const result = await applyWeekFill([cell()], ctx());
    expect(mockCreateSlot).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc1", patternBindingId: "b1" }),
      expect.anything(),
    );
    expect(result.ok).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  /**
   * La garde qui ne peut pas vivre côté client : entre l'aperçu et la
   * confirmation, une publication peut arriver par un autre chemin. Et
   * l'occupation se juge au JOUR — la clé d'idempotence du moteur hebdo
   * (compte, instant, recette) laisserait passer « même jour, autre heure ».
   */
  it("refuse une case dont le jour est occupé depuis l'aperçu", async () => {
    mockSlotFindMany.mockResolvedValue([
      { accountId: "acc1", scheduledAt: new Date("2026-10-05T18:00:00.000Z") },
    ]);
    const result = await applyWeekFill([cell()], ctx());
    expect(mockCreateSlot).not.toHaveBeenCalled();
    expect(result.ok).toEqual([]);
    expect(result.failed[0].error).toMatch(/existe déjà ce jour-là/);
  });

  it("un compte ne reçoit qu'une publication par jour dans un même lot", async () => {
    const result = await applyWeekFill(
      [cell(), cell({ patternBindingId: "b1" })],
      ctx(),
    );
    expect(result.ok).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it("refuse une recette qui n'est pas activée sur le compte visé", async () => {
    const result = await applyWeekFill([cell({ accountId: "acc-autre" })], ctx());
    expect(mockCreateSlot).not.toHaveBeenCalled();
    expect(result.failed[0].error).toMatch(/pas activée sur ce compte/);
  });

  it("une recette disparue finit dans failed, sans casser les autres", async () => {
    mockBindingFindMany.mockResolvedValue([bindingRow()]);
    const result = await applyWeekFill(
      [cell(), cell({ patternBindingId: "b-disparue", dayKey: "2026-10-06" })],
      ctx(),
    );
    expect(result.ok).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/introuvable/);
  });

  it("un échec de createSlot est isolé, les autres cases passent", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow({ id: "b1" }),
      bindingRow({ id: "b2" }),
    ]);
    mockCreateSlot.mockImplementation(async (input: { patternBindingId: string }) => {
      if (input.patternBindingId === "b2") throw new Error("Recette archivée");
      return { id: "slot-new" };
    });
    const result = await applyWeekFill(
      [cell(), cell({ patternBindingId: "b2", dayKey: "2026-10-06" })],
      ctx(),
    );
    expect(result.ok).toHaveLength(1);
    expect(result.failed[0].error).toBe("Recette archivée");
  });

  it("une heure illisible est refusée, pas silencieusement décalée", async () => {
    const result = await applyWeekFill([cell({ time: "midi" })], ctx());
    expect(mockCreateSlot).not.toHaveBeenCalled();
    expect(result.failed[0].error).toMatch(/Heure illisible/);
  });

  it("réservé aux administrateurs", async () => {
    await expect(applyWeekFill([cell()], ctx("MONTEUR"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("borne la taille d'un lot", async () => {
    const trop = Array.from({ length: WEEK_FILL_MAX_CELLS + 1 }, (_, i) =>
      cell({ dayKey: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    await expect(applyWeekFill(trop, ctx())).rejects.toBeInstanceOf(ValidationError);
  });

  it("un lot vide ne fait rien", async () => {
    expect(await applyWeekFill([], ctx())).toEqual({ ok: [], failed: [] });
    expect(mockCreateSlot).not.toHaveBeenCalled();
  });
});

describe("dispatchWindow", () => {
  it("encadre la semaine visée de part et d'autre", () => {
    const { windowFrom, windowTo } = dispatchWindow(new Date("2026-10-05T00:00:00.000Z"));
    expect(windowFrom < new Date("2026-10-05T00:00:00.000Z")).toBe(true);
    expect(windowTo > new Date("2026-10-05T00:00:00.000Z")).toBe(true);
  });
});

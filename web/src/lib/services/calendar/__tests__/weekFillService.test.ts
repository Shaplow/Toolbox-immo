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
    patternTemplate: {
      label: "RAUTO 1",
      family: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
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
   * L'identité « quelle recette », c'est LA RECETTE. Le binding fait foi, le
   * template direct est le repli des missions sans compte.
   */
  it("reconstitue l'usage depuis le binding, avec repli sur le template direct", async () => {
    mockSlotFindMany.mockResolvedValue([
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-10-05T09:00:00.000Z"),
        patternTemplateId: null,
        patternBinding: { patternTemplateId: "pt1" },
      },
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-10-06T09:00:00.000Z"),
        patternTemplateId: "pt-direct",
        patternBinding: null,
      },
    ]);

    const result = await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });

    expect(result.existingUse.pt1.allDays).toEqual([dayIndexFromKey("2026-10-05")]);
    expect(result.existingUse["pt-direct"].allDays).toEqual([dayIndexFromKey("2026-10-06")]);
    expect(result.occupiedByAccount.acc1).toEqual(["2026-10-05", "2026-10-06"]);
  });

  /**
   * LE VERROU DE RÉGRESSION de cette vague.
   *
   * J'avais décidé que deux recettes pointant le même gabarit builder étaient
   * « le même contenu » et partageaient leur historique. C'est une erreur de
   * catégorie : le gabarit est une MISE EN PAGE, le contenu vient des données
   * (`descriptionDataLibraryId` / `descriptionDataSetTag`, tirage média).
   *
   * Conséquence vécue : ses RAUTO 7 à 14 partagent un gabarit. Publier RAUTO 11
   * le vendredi enterrait les sept autres — dont 12 et 13, vieilles de deux
   * semaines — et l'outil basculait sur une autre série. Son écran l'annonçait
   * sans que personne ne le lise : « 12 contenus distincts » pour 19 recettes.
   *
   * Ce test vit ICI et pas dans `dispatch` : une fois le champ retiré, le bug
   * n'est plus exprimable dans le module pur. C'est le service qui construisait
   * la clé, c'est lui qui doit rester verrouillé.
   */
  it("deux recettes sur le même gabarit ont deux historiques SÉPARÉS", async () => {
    mockSlotFindMany.mockResolvedValue([
      // Les deux recettes partagent le gabarit « tpl-rauto », comme ses
      // RAUTO 7 à 14. C'est exactement ce que la requête renvoie en vrai.
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-09-11T09:00:00.000Z"),
        patternTemplateId: null,
        patternTemplate: null,
        patternBinding: {
          patternTemplateId: "rauto-11",
          patternTemplate: { templateId: "tpl-rauto" },
        },
      },
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-09-02T09:00:00.000Z"),
        patternTemplateId: null,
        patternTemplate: null,
        patternBinding: {
          patternTemplateId: "rauto-12",
          patternTemplate: { templateId: "tpl-rauto" },
        },
      },
    ]);

    const result = await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });

    expect(Object.keys(result.existingUse).sort()).toEqual(["rauto-11", "rauto-12"]);
    expect(result.existingUse["rauto-12"].allDays).toEqual([dayIndexFromKey("2026-09-02")]);
  });

  it("le pool compte sur combien de comptes chaque recette est activée", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow({ id: "b1", accountId: "acc1" }),
      bindingRow({ id: "b2", accountId: "acc2" }),
      bindingRow({ id: "b3", accountId: "acc1", patternTemplateId: "pt2",
        patternTemplate: { label: "RAUTO 2", createdAt: new Date("2026-01-02T00:00:00Z"), templateId: "tpl-2" } }),
    ]);
    const result = await buildWeekFillContext({ accountIds: ["acc1", "acc2"], ...WINDOW });
    expect(result.duplicateLabels).toEqual([]);
    expect(result.pool).toEqual([
      { patternTemplateId: "pt1", label: "RAUTO 1", family: null, accountCount: 2 },
      { patternTemplateId: "pt2", label: "RAUTO 2", family: null, accountCount: 1 },
    ]);
  });

  /**
   * La famille remonte telle quelle, `null` compris — l'écran en fait une
   * entrée « Sans famille » de plein droit. La déduire du libellé a été
   * explicitement écarté : RTEXT 1-5 et RAUTO 7-14 sont la MÊME famille sous
   * deux noms, aucune règle sur le nom ne pouvait le savoir.
   */
  it("le pool porte la famille, et les familles couvertes par chaque compte", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: "acc1", name: "Meng", handle: "meng_paris" },
      { id: "acc2", name: "Autre", handle: "autre" },
    ]);
    mockBindingFindMany.mockResolvedValue([
      bindingRow({
        id: "b1",
        accountId: "acc1",
        patternTemplate: {
          label: "RAUTO 1",
          family: "TRANSACTION",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      }),
      bindingRow({
        id: "b2",
        accountId: "acc1",
        patternTemplateId: "pt2",
        patternTemplate: {
          label: "RCOM 1",
          family: "COMMERCE",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      }),
      bindingRow({
        id: "b3",
        accountId: "acc2",
        patternTemplateId: "pt3",
        patternTemplate: {
          label: "RPI",
          family: null,
          createdAt: new Date("2026-01-03T00:00:00Z"),
        },
      }),
    ]);

    const result = await buildWeekFillContext({ accountIds: ["acc1", "acc2"], ...WINDOW });

    // Le pool reste trié par LIBELLÉ (naturel) : le regroupement par famille
    // se fait dans l'écran, qui filtre avant d'afficher.
    expect(result.pool.map((p) => [p.patternTemplateId, p.family])).toEqual([
      ["pt1", "TRANSACTION"],
      ["pt2", "COMMERCE"],
      ["pt3", null],
    ]);
    expect(result.familiesByAccount.acc1).toEqual(["COMMERCE", "TRANSACTION"]);
    // `null` en dernier : c'est un reste à ranger, pas une famille.
    expect(result.familiesByAccount.acc2).toEqual([null]);
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

describe("les dettes ramassées au passage", () => {
  /** « RAUTO 2 » avant « RAUTO 10 » — vingt recettes numérotées sinon illisibles. */
  it("trie le pool en ordre naturel", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow({ id: "b1", patternTemplateId: "pt10",
        patternTemplate: { label: "RAUTO 10", createdAt: new Date("2026-01-01Z") } }),
      bindingRow({ id: "b2", patternTemplateId: "pt2",
        patternTemplate: { label: "RAUTO 2", createdAt: new Date("2026-01-01Z") } }),
    ]);
    const result = await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });
    expect(result.pool.map((p) => p.label)).toEqual(["RAUTO 2", "RAUTO 10"]);
  });

  /**
   * Deux recettes du même nom ne sont plus fusionnées en silence : c'est un
   * défaut de configuration, on le signale.
   */
  it("signale les libellés en doublon", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow({ id: "b1", patternTemplateId: "ptA",
        patternTemplate: { label: "RPI", createdAt: new Date("2026-01-01Z") } }),
      bindingRow({ id: "b2", patternTemplateId: "ptB",
        patternTemplate: { label: "RPI", createdAt: new Date("2026-01-02Z") } }),
      bindingRow({ id: "b3", patternTemplateId: "ptC",
        patternTemplate: { label: "RVA4", createdAt: new Date("2026-01-03Z") } }),
    ]);
    const result = await buildWeekFillContext({ accountIds: ["acc1"], ...WINDOW });
    expect(result.duplicateLabels).toEqual(["RPI"]);
  });
});

/**
 * Tests recipePickService — « quelle recette pour ce compte, ce jour-là ».
 *
 * Le tourniquet lui-même est figé ailleurs (`lib/calendar/__tests__/dispatch`).
 * Ici on verrouille ce que la famille ajoute par-dessus : le groupement, le
 * fait qu'une famille ne pioche jamais dans une autre, et le cas « toutes les
 * recettes de la famille sont déjà sorties aujourd'hui » — celui qui décide si
 * l'admin voit une proposition ou une famille grisée.
 *
 * Prisma est mocké au plus près : on teste la chaîne réelle (pool + historique
 * + classement), pas un contexte inventé.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBindingFindMany = vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []);
const mockSlotFindMany = vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patternBinding: { findMany: (args: unknown) => mockBindingFindMany(args) },
    publicationSlot: { findMany: (args: unknown) => mockSlotFindMany(args) },
  },
}));

import { buildRecipePick } from "@/lib/services/calendar/recipePickService";

const ACCOUNT = "acc1";
/** Le jour visé dans tous les tests. */
const DAY = "2026-09-23";

function bindingRow(
  id: string,
  templateId: string,
  label: string,
  family: string | null,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    accountId: ACCOUNT,
    patternTemplateId: templateId,
    publishTime: "09:00",
    customLabel: null,
    patternTemplate: {
      label,
      family,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    ...over,
  };
}

/**
 * Une publication déjà posée : ce qui nourrit l'historique du tourniquet.
 *
 * `accountId` est paramétrable parce que l'historique est INTER-COMPTES — c'est
 * le cœur de la règle, les comptes partagent l'audience.
 */
function slotRow(templateId: string, dayKey: string, accountId: string = ACCOUNT) {
  return {
    accountId,
    scheduledAt: new Date(`${dayKey}T12:00:00.000Z`),
    patternTemplateId: null,
    patternBinding: { patternTemplateId: templateId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBindingFindMany.mockResolvedValue([]);
  mockSlotFindMany.mockResolvedValue([]);
});

describe("buildRecipePick — le groupement", () => {
  it("une entrée par famille, « sans famille » en dernier", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
      bindingRow("b3", "pt3", "RVA4", null),
      bindingRow("b4", "pt4", "COM 1", "COMMERCE"),
    ]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(groups.map((g) => g.family)).toEqual(["COMMERCE", "RAUTO", null]);
    expect(groups.find((g) => g.family === "RAUTO")?.memberBindingIds).toEqual(["b1", "b2"]);
    expect(groups.find((g) => g.family === null)?.memberBindingIds).toEqual(["b3"]);
  });

  it("une famille ne pioche jamais dans une autre", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "COM 1", "COMMERCE"),
    ]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    const rauto = groups.find((g) => g.family === "RAUTO");
    expect(rauto?.alternatives.map((o) => o.label)).toEqual(["RAUTO 7"]);
  });
});

describe("buildRecipePick — le choix dans la famille", () => {
  it("propose la recette dont la sortie la plus proche est la plus lointaine", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
      bindingRow("b3", "pt3", "RAUTO 9", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([
      slotRow("pt1", "2026-09-22"), // hier
      slotRow("pt2", "2026-09-01"), // il y a 22 jours
      slotRow("pt3", "2026-08-01"), // il y a 53 jours
    ]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });
    const rauto = groups.find((g) => g.family === "RAUTO");

    expect(rauto?.picked?.label).toBe("RAUTO 9");
    expect(rauto?.picked?.gapDays).toBe(53);
    // Le classement complet suit, pour que l'UI propose « une autre ».
    expect(rauto?.alternatives.map((o) => o.label)).toEqual(["RAUTO 9", "RAUTO 8", "RAUTO 7"]);
  });

  it("une recette jamais servie passe devant, avec gapDays null", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt1", "2026-09-20")]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });
    const rauto = groups.find((g) => g.family === "RAUTO");

    expect(rauto?.picked?.label).toBe("RAUTO 8");
    expect(rauto?.picked?.gapDays).toBeNull();
  });

  it("une recette déjà posée le jour visé est écartée, mais reste comptée", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt1", DAY)]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });
    const rauto = groups.find((g) => g.family === "RAUTO");

    // Elle reste membre de la famille : elle ne doit pas ressortir à l'unité.
    expect(rauto?.memberBindingIds).toEqual(["b1", "b2"]);
    expect(rauto?.alternatives.map((o) => o.label)).toEqual(["RAUTO 8"]);
  });

  it("famille entièrement sortie ce jour-là → aucune proposition", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt1", DAY), slotRow("pt2", DAY)]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });
    const rauto = groups.find((g) => g.family === "RAUTO");

    expect(rauto?.picked).toBeNull();
    expect(rauto?.alternatives).toEqual([]);
    expect(rauto?.memberBindingIds).toHaveLength(2);
  });
});

describe("buildRecipePick — le jour déjà occupé", () => {
  it("signale sans refuser quand le compte publie déjà ce jour-là", async () => {
    mockBindingFindMany.mockResolvedValue([bindingRow("b1", "pt1", "RAUTO 7", "RAUTO")]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt9", DAY)]);

    const { groups, occupiedThisDay } = await buildRecipePick({
      accountId: ACCOUNT,
      dayKey: DAY,
    });

    expect(occupiedThisDay).toBe(true);
    // Le refus serait celui du remplissage de semaine ; ici l'admin décide.
    expect(groups.find((g) => g.family === "RAUTO")?.picked?.label).toBe("RAUTO 7");
  });

  it("aucune publication ce jour-là → pas de signal", async () => {
    mockBindingFindMany.mockResolvedValue([bindingRow("b1", "pt1", "RAUTO 7", "RAUTO")]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt1", "2026-09-20")]);

    const { occupiedThisDay } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(occupiedThisDay).toBe(false);
  });
});

/**
 * L'historique est INTER-COMPTES, et c'est tout l'intérêt.
 *
 * « J'essaie de dispatcher correctement les reels entre tous les comptes pour
 * pas qu'on se retrouve avec 2× le même reel posté trop rapidement » : le
 * problème d'origine est justement que la même recette partait lundi sur un
 * compte et mardi sur un autre. Borner l'historique au compte visé donnerait
 * l'illusion d'un tourniquet tout en réintroduisant exactement ce bug.
 */
describe("buildRecipePick — l'historique traverse les comptes", () => {
  it("ne filtre pas les publications sur le compte visé", async () => {
    await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    const where = (mockSlotFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.accountId).toBeUndefined();
  });

  it("une recette sortie ailleurs le jour visé est écartée ici aussi", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt1", DAY, "autre-compte")]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(groups.find((g) => g.family === "RAUTO")?.alternatives.map((o) => o.label)).toEqual([
      "RAUTO 8",
    ]);
  });

  it("une recette sortie ailleurs récemment passe derrière", async () => {
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "pt1", "RAUTO 7", "RAUTO"),
      bindingRow("b2", "pt2", "RAUTO 8", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([
      slotRow("pt1", "2026-09-22", "autre-compte"), // hier, ailleurs
      slotRow("pt2", "2026-08-01", ACCOUNT), // il y a longtemps, ici
    ]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(groups.find((g) => g.family === "RAUTO")?.picked?.label).toBe("RAUTO 8");
  });

  it("le jour « déjà occupé », lui, ne regarde que le compte visé", async () => {
    mockBindingFindMany.mockResolvedValue([bindingRow("b1", "pt1", "RAUTO 7", "RAUTO")]);
    mockSlotFindMany.mockResolvedValue([slotRow("pt9", DAY, "autre-compte")]);

    const { occupiedThisDay } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(occupiedThisDay).toBe(false);
  });
});

describe("buildRecipePick — ce qui entre dans le pool", () => {
  it("ne propose que des recettes auto, actives, non archivées et sans fiche exigée", async () => {
    await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    expect(mockBindingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: ACCOUNT,
          isActive: true,
          patternTemplate: {
            isArchived: false,
            source: "auto_template",
            requiresEntityTypeId: null,
            requiresProperty: false,
          },
        },
      }),
    );
  });

  it("l'historique ignore les publications annulées et archivées", async () => {
    await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    const where = (mockSlotFindMany.mock.calls[0][0] as { where: { status: unknown } }).where;
    expect(where.status).toEqual({ notIn: ["CANCELLED", "ARCHIVED"] });
  });

  it("reconstitue l'usage depuis le binding, avec repli sur le template direct", async () => {
    mockBindingFindMany.mockResolvedValue([bindingRow("b1", "pt1", "RAUTO 7", "RAUTO")]);
    mockSlotFindMany.mockResolvedValue([
      slotRow("pt1", "2026-09-10"),
      // Mission sans compte-recette : l'identité vient du template direct.
      {
        accountId: ACCOUNT,
        scheduledAt: new Date("2026-09-11T12:00:00.000Z"),
        patternTemplateId: "pt1",
        patternBinding: null,
      },
    ]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });

    // Les deux occurrences comptent : la plus proche est le 11, soit 12 jours.
    expect(groups.find((g) => g.family === "RAUTO")?.picked?.gapDays).toBe(12);
  });

  it("deux recettes qui partagent un gabarit ont deux historiques SÉPARÉS", async () => {
    // Le verrou d'une régression connue : une version regroupait les recettes
    // par gabarit builder et enterrait huit RAUTO dès que l'une sortait.
    mockBindingFindMany.mockResolvedValue([
      bindingRow("b1", "rauto-11", "RAUTO 11", "RAUTO"),
      bindingRow("b2", "rauto-12", "RAUTO 12", "RAUTO"),
    ]);
    mockSlotFindMany.mockResolvedValue([slotRow("rauto-11", DAY)]);

    const { groups } = await buildRecipePick({ accountId: ACCOUNT, dayKey: DAY });
    const rauto = groups.find((g) => g.family === "RAUTO");

    // RAUTO 12 reste proposable bien que RAUTO 11 soit sortie aujourd'hui.
    expect(rauto?.picked?.label).toBe("RAUTO 12");
  });
});

describe("buildRecipePick — compte sans recette", () => {
  it("aucun binding actif → aucun groupe", async () => {
    const { groups, occupiedThisDay } = await buildRecipePick({
      accountId: ACCOUNT,
      dayKey: DAY,
    });

    expect(groups).toEqual([]);
    expect(occupiedThisDay).toBe(false);
  });
});

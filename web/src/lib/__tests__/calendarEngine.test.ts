/**
 * Tests calendarEngine — fige les raisons de non-génération.
 *
 * Le moteur rendait `{ created: 0, skipped: 0 }` par trois sorties muettes
 * différentes, ses refus n'existant qu'en `console.warn` côté serveur. Ces
 * tests verrouillent le fait que chaque refus est désormais NOMMÉ dans
 * `skips[]`, et qu'un binding invalide ne produit qu'UNE entrée même sur une
 * génération multi-semaines (les gardes vivaient dans la boucle des semaines).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBindingFindMany = vi.fn();
const mockSlotFindMany = vi.fn(async () => [] as unknown[]);
const mockSlotCreateMany = vi.fn(async () => ({ count: 0 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patternBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    publicationSlot: {
      findMany: (...a: unknown[]) => mockSlotFindMany(...a),
      createMany: (...a: unknown[]) => mockSlotCreateMany(...a),
    },
  },
}));

import { generateCalendarSlots } from "@/lib/calendarEngine";
import { summarizeCalendarSkips } from "@/lib/calendar/skips";

/** Lundi 14/09/2026 → dimanche 20/09/2026 (une semaine pleine, UTC). */
const WEEK = {
  dateFrom: new Date("2026-09-14T00:00:00.000Z"),
  dateTo: new Date("2026-09-20T23:59:59.999Z"),
};
/** Deux semaines, pour vérifier la déduplication des refus par recette. */
const TWO_WEEKS = {
  dateFrom: WEEK.dateFrom,
  dateTo: new Date("2026-09-27T23:59:59.999Z"),
};

function binding(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    accountId: "acc1",
    patternTemplateId: "pt1",
    customLabel: null,
    dayOfWeek: [1],
    publishTime: "18:00",
    isActive: true,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
    account: { handle: "agence-nord" },
    patternTemplate: {
      id: "pt1",
      label: "RVA1",
      source: "auto_template",
      templateId: "tpl1",
      requiresProperty: false,
      requiresEntityTypeId: null,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSlotFindMany.mockResolvedValue([]);
  mockSlotCreateMany.mockResolvedValue({ count: 0 });
});

describe("generateCalendarSlots — cas nominal", () => {
  it("crée un slot par jour planifié et n'invente aucun refus", async () => {
    mockBindingFindMany.mockResolvedValue([binding({ dayOfWeek: [1, 3] })]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.skips).toEqual([]);
    expect(mockSlotCreateMany).toHaveBeenCalledTimes(1);
  });

  it("dryRun n'écrit rien mais compte pareil", async () => {
    mockBindingFindMany.mockResolvedValue([binding()]);

    const result = await generateCalendarSlots({ ...WEEK, dryRun: true });

    expect(result.created).toBe(1);
    expect(mockSlotCreateMany).not.toHaveBeenCalled();
  });
});

describe("generateCalendarSlots — chaque refus est nommé", () => {
  it("aucune recette active → no_active_bindings", async () => {
    mockBindingFindMany.mockResolvedValue([]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(0);
    expect(result.skips).toEqual([{ reason: "no_active_bindings", count: 0 }]);
  });

  it("recette exigeant une fiche → requires_entity, avec la recette nommée", async () => {
    mockBindingFindMany.mockResolvedValue([
      binding({ patternTemplate: { ...binding().patternTemplate, requiresEntityTypeId: "etype_bien" } }),
    ]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(0);
    expect(result.skips).toEqual([
      { reason: "requires_entity", bindingId: "b1", accountHandle: "agence-nord", label: "RVA1", count: 1 },
    ]);
  });

  it("requiresProperty legacy → requires_entity aussi", async () => {
    mockBindingFindMany.mockResolvedValue([
      binding({ patternTemplate: { ...binding().patternTemplate, requiresProperty: true } }),
    ]);

    const result = await generateCalendarSlots(WEEK);
    expect(result.skips.map((s) => s.reason)).toEqual(["requires_entity"]);
  });

  it("aucun jour planifié → empty_day_of_week", async () => {
    mockBindingFindMany.mockResolvedValue([binding({ dayOfWeek: [] })]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(0);
    expect(result.skips.map((s) => s.reason)).toEqual(["empty_day_of_week"]);
  });

  it.each(["", "abc", "25:00", "12:99", "18h30"])(
    "publishTime « %s » → invalid_publish_time",
    async (publishTime) => {
      mockBindingFindMany.mockResolvedValue([binding({ publishTime })]);

      const result = await generateCalendarSlots(WEEK);

      expect(result.created).toBe(0);
      expect(result.skips.map((s) => s.reason)).toEqual(["invalid_publish_time"]);
    },
  );

  /**
   * Contre-exemples délibérés : le garde est plus laxiste que son commentaire
   * ne le laissait croire. « 9:00 » passe (Number("9") === 9) et « 18: » aussi
   * (Number("") === 0, donc 18h00). Aucun des deux ne produit d'Invalid Date,
   * c'est-à-dire aucun des deux ne peut faire échouer la run — la tolérance est
   * sans danger. Ces cas sont figés ici pour que personne ne « corrige » le
   * garde d'après le commentaire et n'exclue des recettes qui tournent en prod.
   */
  it.each(["9:00", "09:00", "18:"])("publishTime « %s » est accepté", async (publishTime) => {
    mockBindingFindMany.mockResolvedValue([binding({ publishTime })]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(1);
    expect(result.skips).toEqual([]);
  });

  it("date cible déjà passée → out_of_range", async () => {
    mockBindingFindMany.mockResolvedValue([binding({ dayOfWeek: [1] })]);

    // Génération lancée le mercredi : le lundi de la semaine est derrière nous.
    const result = await generateCalendarSlots({
      dateFrom: new Date("2026-09-16T10:00:00.000Z"),
      dateTo: WEEK.dateTo,
    });

    expect(result.created).toBe(0);
    expect(result.skips).toEqual([{ reason: "out_of_range", count: 1 }]);
  });

  it("slot déjà présent → already_exists et skipped", async () => {
    mockBindingFindMany.mockResolvedValue([binding()]);
    mockSlotFindMany.mockResolvedValue([
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-09-14T18:00:00.000Z"),
        patternBindingId: "b1",
      },
    ]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skips).toEqual([{ reason: "already_exists", count: 1 }]);
    expect(mockSlotCreateMany).not.toHaveBeenCalled();
  });
});

describe("generateCalendarSlots — les refus ne se répètent pas par semaine", () => {
  it("une recette sans jour planifié compte une fois, pas une par semaine", async () => {
    mockBindingFindMany.mockResolvedValue([binding({ dayOfWeek: [] })]);

    const result = await generateCalendarSlots(TWO_WEEKS);

    expect(result.skips).toHaveLength(1);
    expect(summarizeCalendarSkips(result.skips)[0].text).toMatch(/^1 recette active sans jour/);
  });

  it("une recette valide génère toujours sur toutes les semaines", async () => {
    mockBindingFindMany.mockResolvedValue([binding({ dayOfWeek: [1] })]);

    const result = await generateCalendarSlots(TWO_WEEKS);

    expect(result.created).toBe(2);
  });
});

describe("generateCalendarSlots — un refus n'empêche pas les autres recettes", () => {
  it("mélange valide + invalides : seule la valide produit un slot", async () => {
    mockBindingFindMany.mockResolvedValue([
      binding({ id: "b-ok", dayOfWeek: [2] }),
      binding({ id: "b-noday", dayOfWeek: [], customLabel: "Sans jour" }),
      binding({ id: "b-badtime", publishTime: "abc", customLabel: "Heure cassée" }),
    ]);

    const result = await generateCalendarSlots(WEEK);

    expect(result.created).toBe(1);
    expect(result.skips.map((s) => s.reason).sort()).toEqual([
      "empty_day_of_week",
      "invalid_publish_time",
    ]);
    // Le libellé personnalisé prime sur celui de la recette globale : c'est
    // sous ce nom que l'admin voit la ligne sur la fiche du compte.
    expect(result.skips.map((s) => s.label).sort()).toEqual(["Heure cassée", "Sans jour"]);
  });
});

describe("summarizeCalendarSkips", () => {
  it("met les causes actionnables avant l'idempotence", async () => {
    const lines = summarizeCalendarSkips([
      { reason: "already_exists", count: 4 },
      { reason: "empty_day_of_week", bindingId: "b1", label: "RVA1", count: 1 },
    ]);

    expect(lines.map((l) => l.reason)).toEqual(["empty_day_of_week", "already_exists"]);
  });

  it("agrège plusieurs recettes sous une même raison", async () => {
    const lines = summarizeCalendarSkips([
      { reason: "empty_day_of_week", bindingId: "b1", label: "RVA1", accountHandle: "nord", count: 1 },
      { reason: "empty_day_of_week", bindingId: "b2", label: "RPI", count: 1 },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^2 recettes actives sans jour/);
    expect(lines[0].details).toEqual(["RVA1 (@nord)", "RPI"]);
  });
});

/**
 * L'aperçu détaillé du dry-run — ce que l'écran « Remplir la semaine » affiche
 * à côté des publications qu'il répartit.
 *
 * Un compteur ne suffit pas : il faut le couple (compte, jour, recette) pour
 * dessiner la grille, ET l'identité du contenu pour que l'espacement en tienne
 * compte — une RVA4 planifiée le mardi doit interdire d'en proposer une le
 * lundi.
 */
describe("aperçu du dry-run", () => {
  it("dit CE QUI serait créé, pas seulement combien", async () => {
    mockBindingFindMany.mockResolvedValue([binding()]);
    const result = await generateCalendarSlots({ ...WEEK, dryRun: true });

    expect(result.created).toBe(1);
    expect(result.preview).toEqual([
      {
        accountId: "acc1",
        patternBindingId: "b1",
        scheduledAt: "2026-09-14T18:00:00.000Z",
        label: "RVA1",
        patternTemplateId: "pt1",
        templateId: "tpl1",
      },
    ]);
  });

  /** Hors dry-run, personne n'en a besoin : ce serait une allocation pour rien. */
  it("est absent quand on écrit vraiment", async () => {
    mockBindingFindMany.mockResolvedValue([binding()]);
    const result = await generateCalendarSlots(WEEK);
    expect(result.preview).toBeUndefined();
  });

  /**
   * Construit depuis `toCreate`, donc déjà filtré par l'idempotence : l'écran
   * n'affiche que ce qui naîtrait réellement.
   */
  it("exclut ce qui existe déjà", async () => {
    mockBindingFindMany.mockResolvedValue([binding()]);
    mockSlotFindMany.mockResolvedValue([
      {
        accountId: "acc1",
        scheduledAt: new Date("2026-09-14T18:00:00.000Z"),
        patternBindingId: "b1",
      },
    ]);
    const result = await generateCalendarSlots({ ...WEEK, dryRun: true });
    expect(result.created).toBe(0);
    expect(result.preview).toEqual([]);
  });
});

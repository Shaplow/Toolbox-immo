import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
// On mock le module entier pour éviter toute connexion DB.
// Les tests injectent leurs propres données via les mocks ci-dessous.

const mockPatternFindMany = vi.fn();
const mockSlotFindMany = vi.fn();
const mockCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountPattern: {
      findMany: (...args: unknown[]) => mockPatternFindMany(...args),
    },
    publicationSlot: {
      findMany: (...args: unknown[]) => mockSlotFindMany(...args),
      createMany: (...args: unknown[]) => mockCreateMany(...args),
    },
  },
}));

// Import APRÈS le mock
import { generateCalendarSlots, nextWeekRange, mapSourceToInitialStatus } from "@/lib/calendarEngine";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Retourne le lundi de la semaine en cours à 00:00 UTC */
function thisMonday(): Date {
  const now = new Date();
  const jsDay = now.getUTCDay(); // 0=Dim
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Retourne le dimanche de la même semaine que monday à 23:59:59 UTC */
function thisSunday(monday: Date): Date {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Calcule la date cible attendue pour un pattern donné dans la semaine de monday */
function expectedSlotDate(monday: Date, dayOfWeek: number, publishTime: string): Date {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + (dayOfWeek - 1));
  const [h, m] = publishTime.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/** Pattern minimal (actif, [lundi] 09:00) */
function makePattern(overrides: Partial<{
  id: string;
  accountId: string;
  label: string;
  source: string;
  dayOfWeek: number[];
  publishTime: string;
  templateId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  isActive: boolean;
}> = {}) {
  return {
    id: "pattern-1",
    accountId: "account-1",
    label: "Test Pattern",
    source: "auto_template",
    dayOfWeek: [1], // Lundi
    publishTime: "09:00",
    templateId: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    isActive: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateCalendarSlots", () => {
  const monday = thisMonday();
  const sunday = thisSunday(monday);

  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut : pas de slot existant
    mockSlotFindMany.mockResolvedValue([]);
    mockCreateMany.mockResolvedValue({ count: 0 });
  });

  // ── Cas 0 pattern actif ───────────────────────────────────────────────────

  it("0 pattern actif → 0 slot créé, 0 skipped", async () => {
    mockPatternFindMany.mockResolvedValue([]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  // ── Cas 1 pattern actif ───────────────────────────────────────────────────

  it("1 pattern actif lundi 09:00 → 1 slot créé pour la semaine", async () => {
    mockPatternFindMany.mockResolvedValue([makePattern()]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).toHaveBeenCalledOnce();

    const dataArr = mockCreateMany.mock.calls[0][0].data;
    expect(dataArr).toHaveLength(1);
    const slot = dataArr[0];
    expect(slot.accountId).toBe("account-1");
    expect(slot.patternId).toBe("pattern-1");
    // Default makePattern() uses source="auto_template" → PLANNED
    expect(slot.status).toBe("PLANNED");
    expect(slot.isAuto).toBe(true);

    // Vérifier la date : lundi 09:00 UTC
    expect(slot.scheduledAt.getUTCHours()).toBe(9);
    expect(slot.scheduledAt.getUTCMinutes()).toBe(0);
    expect(slot.scheduledAt.getUTCDate()).toBe(monday.getUTCDate());
  });

  // ── 2 patterns sur même compte, jours différents ──────────────────────────

  it("2 patterns sur le même compte jours différents → 2 slots créés", async () => {
    mockPatternFindMany.mockResolvedValue([
      makePattern({ id: "p1", dayOfWeek: [1], publishTime: "09:00" }),
      makePattern({ id: "p2", dayOfWeek: [3], publishTime: "18:00" }), // Mercredi
    ]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).toHaveBeenCalledOnce();

    const dataArr = mockCreateMany.mock.calls[0][0].data;
    expect(dataArr).toHaveLength(2);

    const first = dataArr[0];
    expect(first.scheduledAt.getUTCHours()).toBe(9);
    expect(first.scheduledAt.getUTCDate()).toBe(monday.getUTCDate());

    const second = dataArr[1];
    expect(second.scheduledAt.getUTCHours()).toBe(18);
    expect(second.scheduledAt.getUTCDate()).toBe(monday.getUTCDate() + 2);
  });

  // ── Multi-jour : 1 pattern dayOfWeek=[1,3,5] → 3 slots par semaine ───────

  it("1 pattern dayOfWeek=[1,3,5] → 3 slots créés dans la semaine (Lun, Mer, Ven)", async () => {
    mockPatternFindMany.mockResolvedValue([
      makePattern({ id: "p-multi", dayOfWeek: [1, 3, 5], publishTime: "10:00" }),
    ]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).toHaveBeenCalledOnce();

    const dataArr = mockCreateMany.mock.calls[0][0].data;
    expect(dataArr).toHaveLength(3);

    // Lundi (dow=1) → offset 0
    expect(dataArr[0].scheduledAt.getUTCDate()).toBe(monday.getUTCDate());
    // Mercredi (dow=3) → offset 2
    expect(dataArr[1].scheduledAt.getUTCDate()).toBe(monday.getUTCDate() + 2);
    // Vendredi (dow=5) → offset 4
    expect(dataArr[2].scheduledAt.getUTCDate()).toBe(monday.getUTCDate() + 4);

    // Tous à 10:00 UTC
    for (const slot of dataArr) {
      expect(slot.scheduledAt.getUTCHours()).toBe(10);
      expect(slot.scheduledAt.getUTCMinutes()).toBe(0);
    }
  });

  // ── Pattern dayOfWeek vide → warning + skip ───────────────────────────────

  it("pattern dayOfWeek=[] (array vide) → 0 slot créé (warning console)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPatternFindMany.mockResolvedValue([makePattern({ dayOfWeek: [] })]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("empty dayOfWeek"));
    warnSpy.mockRestore();
  });

  // ── Idempotence ───────────────────────────────────────────────────────────

  it("idempotence : slot déjà existant → skipped, pas de doublon", async () => {
    const pattern = makePattern();
    mockPatternFindMany.mockResolvedValue([pattern]);
    // Simuler que le slot existe déjà (dayOfWeek[0] = lundi)
    mockSlotFindMany.mockResolvedValue([
      {
        accountId: pattern.accountId,
        scheduledAt: expectedSlotDate(monday, pattern.dayOfWeek[0], pattern.publishTime),
        patternId: pattern.id,
      },
    ]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("idempotence : 2 appels consécutifs → 1 créé au total (2e appel = 0 créé)", async () => {
    const pattern = makePattern();
    mockPatternFindMany.mockResolvedValue([pattern]);

    // 1er appel : pas de slot existant → 1 created
    mockSlotFindMany.mockResolvedValueOnce([]);
    const r1 = await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(r1.created).toBe(1);

    // 2e appel : le slot précédent est maintenant en base → 0 created, 1 skipped
    mockSlotFindMany.mockResolvedValueOnce([
      {
        accountId: pattern.accountId,
        scheduledAt: expectedSlotDate(monday, pattern.dayOfWeek[0], pattern.publishTime),
        patternId: pattern.id,
      },
    ]);
    const r2 = await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);

    // createMany n'a été appelé qu'une seule fois (sur le 1er appel)
    expect(mockCreateMany).toHaveBeenCalledOnce();
  });

  // ── Pattern inactif → skip ────────────────────────────────────────────────

  it("pattern inactif (isActive=false) → ignoré par la query (0 slot créé)", async () => {
    // La query Prisma filtre déjà isActive=true — on simule en retournant []
    mockPatternFindMany.mockResolvedValue([]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);

    expect(mockPatternFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });

  // ── Filtrage par accountIds ───────────────────────────────────────────────

  it("filtrage par accountIds : query Prisma inclut accountId dans le where", async () => {
    mockPatternFindMany.mockResolvedValue([]);

    await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
      accountIds: ["account-1", "account-2"],
    });

    expect(mockPatternFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: { in: ["account-1", "account-2"] },
        }),
      })
    );
  });

  it("accountIds vide [] → pas de filtre sur accountId (tous les comptes)", async () => {
    mockPatternFindMany.mockResolvedValue([]);

    await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
      accountIds: [],
    });

    const whereArg = mockPatternFindMany.mock.calls[0][0].where;
    expect(whereArg).not.toHaveProperty("accountId");
  });

  // ── Pattern hors plage → skip ─────────────────────────────────────────────

  it("pattern dont la date calculée est hors plage → 0 créé", async () => {
    const mondayOnly = new Date(monday);
    const mondayEnd = new Date(monday);
    mondayEnd.setUTCHours(23, 59, 59, 999);

    // dayOfWeek=[7] → targetDate = lundi + 6 = dimanche → > mondayEnd → hors plage
    mockPatternFindMany.mockResolvedValue([makePattern({ dayOfWeek: [7] })]);

    const result = await generateCalendarSlots({
      dateFrom: mondayOnly,
      dateTo: mondayEnd,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  // ── Assignations par défaut propagées ────────────────────────────────────

  it("les assignées par défaut du pattern sont propagées dans le slot créé", async () => {
    mockPatternFindMany.mockResolvedValue([
      makePattern({
        defaultAssigneeMonteurId: "monteur-1",
        defaultAssigneeCmId: "cm-1",
      }),
    ]);

    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });

    const slot = mockCreateMany.mock.calls[0][0].data[0];
    expect(slot.assigneeMonteurId).toBe("monteur-1");
    expect(slot.assigneeCmId).toBe("cm-1");
  });

  // ── Multi-semaine (régression du BLOCKER code review) ──────────────────────

  it("plage 2 semaines + 1 pattern → 2 slots créés (1 par semaine)", async () => {
    const pattern = makePattern({ dayOfWeek: [1], publishTime: "09:00" });
    mockPatternFindMany.mockResolvedValue([pattern]);

    const dateFrom = new Date(monday);
    const dateTo = new Date(monday);
    dateTo.setUTCDate(dateTo.getUTCDate() + 13); // +13 jours = 2 semaines complètes
    dateTo.setUTCHours(23, 59, 59, 999);

    const result = await generateCalendarSlots({ dateFrom, dateTo });

    expect(result.created).toBe(2);
    expect(mockCreateMany).toHaveBeenCalledOnce();

    const dataArr = mockCreateMany.mock.calls[0][0].data;
    expect(dataArr).toHaveLength(2);

    const first: Date = dataArr[0].scheduledAt;
    const second: Date = dataArr[1].scheduledAt;
    const diffMs = second.getTime() - first.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000); // exactement 7 jours
  });

  // ── Bulk performance : 1 seul appel findMany + 1 seul appel createMany ────

  it("performance : N patterns → 1 findMany existing + 1 createMany (pas de N+1)", async () => {
    const patterns = [
      makePattern({ id: "p1", dayOfWeek: [1], publishTime: "09:00" }),
      makePattern({ id: "p2", dayOfWeek: [2], publishTime: "10:00" }),
      makePattern({ id: "p3", dayOfWeek: [3], publishTime: "11:00" }),
      makePattern({ id: "p4", dayOfWeek: [4], publishTime: "12:00" }),
    ];
    mockPatternFindMany.mockResolvedValue(patterns);

    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });

    // 1 findMany pour les patterns + 1 findMany pour les slots existants + 1 createMany
    expect(mockPatternFindMany).toHaveBeenCalledOnce();
    expect(mockSlotFindMany).toHaveBeenCalledOnce();
    expect(mockCreateMany).toHaveBeenCalledOnce();

    // createMany reçoit toutes les insertions en un seul array
    expect(mockCreateMany.mock.calls[0][0].data).toHaveLength(4);
  });

  // ── Statut initial dérivé de pattern.source ─────────────────────────────

  it("source=auto_template → slot créé en PLANNED (auto-transitions prend le relais)", async () => {
    mockPatternFindMany.mockResolvedValue([makePattern({ source: "auto_template" })]);
    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(mockCreateMany.mock.calls[0][0].data[0].status).toBe("PLANNED");
  });

  it("source=manual_rushes → slot créé en RUSHES_EXPECTED (visible monteur immédiatement)", async () => {
    mockPatternFindMany.mockResolvedValue([makePattern({ source: "manual_rushes" })]);
    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(mockCreateMany.mock.calls[0][0].data[0].status).toBe("RUSHES_EXPECTED");
  });

  it("source=external_upload → slot créé en READY_FOR_CM (pas de montage attendu)", async () => {
    mockPatternFindMany.mockResolvedValue([makePattern({ source: "external_upload" })]);
    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(mockCreateMany.mock.calls[0][0].data[0].status).toBe("READY_FOR_CM");
  });
});

// ── mapSourceToInitialStatus (helper pur) ────────────────────────────────────

describe("mapSourceToInitialStatus", () => {
  it("auto_template → PLANNED", () => {
    expect(mapSourceToInitialStatus("auto_template")).toBe("PLANNED");
  });

  it("manual_rushes → RUSHES_EXPECTED", () => {
    expect(mapSourceToInitialStatus("manual_rushes")).toBe("RUSHES_EXPECTED");
  });

  it("external_upload → READY_FOR_CM", () => {
    expect(mapSourceToInitialStatus("external_upload")).toBe("READY_FOR_CM");
  });

  it("source inconnue → fallback PLANNED + warn console", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(mapSourceToInitialStatus("ufo_source")).toBe("PLANNED");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ufo_source"),
    );
    warnSpy.mockRestore();
  });
});

// ── nextWeekRange ─────────────────────────────────────────────────────────────

describe("nextWeekRange", () => {
  it("retourne un lundi (UTC) à 00:00:00 comme dateFrom", () => {
    const { dateFrom } = nextWeekRange();
    expect(dateFrom.getUTCHours()).toBe(0);
    expect(dateFrom.getUTCMinutes()).toBe(0);
    // getUTCDay() === 1 signifie lundi
    expect(dateFrom.getUTCDay()).toBe(1);
  });

  it("retourne un dimanche (UTC) à 23:59:59 comme dateTo", () => {
    const { dateTo } = nextWeekRange();
    expect(dateTo.getUTCHours()).toBe(23);
    expect(dateTo.getUTCMinutes()).toBe(59);
    expect(dateTo.getUTCDay()).toBe(0); // 0 = Dimanche en UTC
  });

  it("dateTo est 6 jours complets après dateFrom (lundi → dimanche inclus)", () => {
    const { dateFrom, dateTo } = nextWeekRange();
    const diffMs = dateTo.getTime() - dateFrom.getTime();
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(sixDaysMs);
    expect(diffMs).toBeLessThan(sevenDaysMs);
  });

  it("dateFrom est dans le futur (semaine prochaine)", () => {
    const { dateFrom } = nextWeekRange();
    expect(dateFrom.getTime()).toBeGreaterThan(Date.now());
  });
});

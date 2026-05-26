import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
// On mock le module entier pour éviter toute connexion DB.
// Les tests injectent leurs propres données via les mocks ci-dessous.

const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountPattern: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    publicationSlot: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// Import APRÈS le mock
import { generateCalendarSlots, nextWeekRange } from "@/lib/calendarEngine";

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

/** Pattern minimal (actif, lundi 09:00) */
function makePattern(overrides: Partial<{
  id: string;
  accountId: string;
  label: string;
  dayOfWeek: number;
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
    dayOfWeek: 1, // Lundi
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
    // Par défaut : pas de slot existant → pas de skip
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "new-slot-1" });
  });

  // ── Cas 0 pattern actif ───────────────────────────────────────────────────

  it("0 pattern actif → 0 slot créé, 0 skipped", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── Cas 1 pattern actif ───────────────────────────────────────────────────

  it("1 pattern actif lundi 09:00 → 1 slot créé pour la semaine", async () => {
    mockFindMany.mockResolvedValue([makePattern()]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockCreate).toHaveBeenCalledOnce();

    // Vérifier que le slot est créé avec accountId, patternId, status correct
    const createArg = mockCreate.mock.calls[0][0].data;
    expect(createArg.accountId).toBe("account-1");
    expect(createArg.patternId).toBe("pattern-1");
    expect(createArg.status).toBe("TO_DO");
    expect(createArg.isAuto).toBe(true);

    // Vérifier la date : lundi 09:00 UTC
    const scheduledAt: Date = createArg.scheduledAt;
    expect(scheduledAt.getUTCHours()).toBe(9);
    expect(scheduledAt.getUTCMinutes()).toBe(0);
    // dayOfWeek=1 → lundi = même jour que monday
    expect(scheduledAt.getUTCDate()).toBe(monday.getUTCDate());
  });

  // ── 2 patterns sur même compte, jours différents ──────────────────────────

  it("2 patterns sur le même compte jours différents → 2 slots créés", async () => {
    mockFindMany.mockResolvedValue([
      makePattern({ id: "p1", dayOfWeek: 1, publishTime: "09:00" }),
      makePattern({ id: "p2", dayOfWeek: 3, publishTime: "18:00" }), // Mercredi
    ]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Premier slot : lundi 09:00
    const firstDate: Date = mockCreate.mock.calls[0][0].data.scheduledAt;
    expect(firstDate.getUTCHours()).toBe(9);
    expect(firstDate.getUTCDate()).toBe(monday.getUTCDate());

    // Deuxième slot : mercredi 18:00 (monday + 2 jours)
    const secondDate: Date = mockCreate.mock.calls[1][0].data.scheduledAt;
    expect(secondDate.getUTCHours()).toBe(18);
    expect(secondDate.getUTCDate()).toBe(monday.getUTCDate() + 2);
  });

  // ── Idempotence ───────────────────────────────────────────────────────────

  it("idempotence : slot déjà existant → skipped, pas de doublon", async () => {
    mockFindMany.mockResolvedValue([makePattern()]);
    // Simuler que le slot existe déjà
    mockFindFirst.mockResolvedValue({ id: "existing-slot" });

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("idempotence : 2 appels consécutifs → 1 créé au total (2e appel = 0 créé)", async () => {
    mockFindMany.mockResolvedValue([makePattern()]);

    // Premier appel : slot inexistant → création
    mockFindFirst.mockResolvedValueOnce(null);
    const r1 = await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(r1.created).toBe(1);

    // Deuxième appel : slot existe → skip
    mockFindFirst.mockResolvedValueOnce({ id: "just-created" });
    const r2 = await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(1);

    // Au total, create n'a été appelé qu'une fois
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // ── Pattern inactif → skip ────────────────────────────────────────────────

  it("pattern inactif (isActive=false) → ignoré par la query (0 slot créé)", async () => {
    // La query Prisma filtre déjà isActive=true — on simule en retournant []
    // (même si on passe un pattern inactif dans les fixtures, Prisma ne le retournerait pas)
    mockFindMany.mockResolvedValue([]);

    const result = await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);

    // Vérifier que la query Prisma est appelée avec isActive: true
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });

  // ── Filtrage par accountIds ───────────────────────────────────────────────

  it("filtrage par accountIds : query Prisma inclut accountId dans le where", async () => {
    mockFindMany.mockResolvedValue([]);

    await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
      accountIds: ["account-1", "account-2"],
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: { in: ["account-1", "account-2"] },
        }),
      })
    );
  });

  it("accountIds vide [] → pas de filtre sur accountId (tous les comptes)", async () => {
    mockFindMany.mockResolvedValue([]);

    await generateCalendarSlots({
      dateFrom: monday,
      dateTo: sunday,
      accountIds: [],
    });

    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg).not.toHaveProperty("accountId");
  });

  // ── Pattern hors plage → skip ─────────────────────────────────────────────

  it("pattern dont la date calculée est hors plage → 0 créé", async () => {
    // Le moteur calcule targetDate = dateFrom + (dayOfWeek - 1) jours.
    // Pour qu'un pattern soit hors plage, il faut que dayOfWeek soit très grand
    // et que dateTo soit court. On passe dateFrom=lundi, dateTo=lundi (1 seul jour)
    // et un pattern dayOfWeek=7 (dimanche) : targetDate = lundi + 6 > dateTo.
    const mondayOnly = new Date(monday);
    const mondayEnd = new Date(monday);
    mondayEnd.setUTCHours(23, 59, 59, 999);

    // dayOfWeek=7 → targetDate = lundi + 6 = dimanche → > mondayEnd → hors plage
    mockFindMany.mockResolvedValue([makePattern({ dayOfWeek: 7 })]);

    const result = await generateCalendarSlots({
      dateFrom: mondayOnly,
      dateTo: mondayEnd,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── Assignations par défaut propagées ────────────────────────────────────

  it("les assignées par défaut du pattern sont propagées dans le slot créé", async () => {
    mockFindMany.mockResolvedValue([
      makePattern({
        defaultAssigneeMonteurId: "monteur-1",
        defaultAssigneeCmId: "cm-1",
      }),
    ]);

    await generateCalendarSlots({ dateFrom: monday, dateTo: sunday });

    const createArg = mockCreate.mock.calls[0][0].data;
    expect(createArg.assigneeMonteurId).toBe("monteur-1");
    expect(createArg.assigneeCmId).toBe("cm-1");
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
    // dateFrom = lundi 00:00, dateTo = dimanche 23:59:59.999 → ~6.99 jours
    // On vérifie plutôt que le delta en ms est compris entre 6 et 7 jours
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

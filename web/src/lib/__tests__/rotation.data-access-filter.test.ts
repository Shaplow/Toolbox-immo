/**
 * DataLibrary — access filter isolation
 *
 * Les DataEntry peuvent avoir des DataEntryAccess restreignant l'accès à
 * certains comptes IG. Quand une entry est restreinte au compte A, le compte B
 * ne doit JAMAIS la recevoir.
 *
 * Note : l'access filter est injecté dans TOUTES les requêtes SQL de selectDataEntry
 * via le fragment `accessFilter` (Prisma.sql). En mock, on ne peut pas vérifier
 * le SQL réel, mais on valide que :
 *  - Avec accountId=A, la DB peut renvoyer entry-A (restreinte à A).
 *  - Avec accountId=B, la DB renvoie null (SQL filtre déjà côté DB).
 *  - Avec accountId=B et entry globale (pas de DataEntryAccess), la DB renvoie l'entry.
 *
 * Les mocks simulent le résultat APRÈS filtrage SQL (i.e., le mock encode ce que
 * la vraie DB retournerait avec le filtre d'accès appliqué).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
const mockDataCampaignFindUnique = vi.fn();
const mockDataEntryUsageCreate = vi.fn();
const mockDataEntryUsageUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    dataCampaign: { findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args) },
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
  },
}));

import { selectDataEntry } from "@/lib/contentLibraryResolver";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTxProxy() {
  return {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
    dataEntry: { update: vi.fn().mockResolvedValue({}) },
  };
}

function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(makeTxProxy()));
}

function setupCampaign(scope = "per_account") {
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: "lib-access", rotationMode: "auto", rotationScope: scope, maxUsageCount: null },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataLibrary — access filter isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    setupCampaign("per_account");
  });

  it("compte A — reçoit l'entry restreinte à A (mock simule DB après filtrage)", async () => {
    // entry-restricted-to-A a DataEntryAccess(accountId=A)
    // La DB avec accountId=A renvoie cette entry (filtre SQL : global OR accessible à A)
    const restrictedEntry = {
      id: "entry-restricted-to-A",
      fields: JSON.stringify({ exclusif: "true" }),
    };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([restrictedEntry]); // pickEntryFromGroup
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-access", undefined, "account-A", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-restricted-to-A");
  });

  it("compte B — ne reçoit PAS l'entry restreinte à A (mock simule DB retournant rien pour B)", async () => {
    // discoverGroups retourne [] → group-based tx ne set pas entry.
    // Ensuite flat path cycle_per_account (tx primary) renvoie aussi [] (aucune entry non-claimée).
    // Puis flat path fallback cycle restart renvoie aussi [] → null.
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups → aucun groupe accessible pour B
    mockQueryRaw.mockResolvedValueOnce([]); // flat path primary (not-yet-claimed)
    mockQueryRaw.mockResolvedValueOnce([]); // flat path fallback (cycle restart, usageCount >= 1)

    const result = await selectDataEntry("campaign-access", undefined, "account-B", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result).toBeNull();
  });

  it("compte B — peut accéder à une entry globale (aucun DataEntryAccess row)", async () => {
    // entry-global n'a aucun DataEntryAccess → accessible à tous les comptes
    const globalEntry = { id: "entry-global", fields: JSON.stringify({ global: "true" }) };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-g", category: "CatG" }]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([globalEntry]); // pickEntryFromGroup
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-access", undefined, "account-B", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-global");
  });

  it("2 comptes A/B — accès ségrégués : A voit entry-A, B voit entry-B (deux pools distincts)", async () => {
    // Scénario : entry-A restreinte à A, entry-B restreinte à B.
    // Les 2 comptes ne se marchent pas dessus.
    const entryA = { id: "entry-A", fields: "{}" };
    const entryB = { id: "entry-B", fields: "{}" };

    // Compte A
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]);
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const resultA = await selectDataEntry("campaign-access", undefined, "account-A", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    vi.clearAllMocks();
    setupTransaction();
    setupCampaign("per_account");

    // Compte B
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-b", category: "CatB" }]);
    mockQueryRaw.mockResolvedValueOnce([entryB]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const resultB = await selectDataEntry("campaign-access", undefined, "account-B", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(resultA?.entryId).toBe("entry-A");
    expect(resultB?.entryId).toBe("entry-B");
    // Les 2 résultats sont distincts
    expect(resultA?.entryId).not.toBe(resultB?.entryId);
  });

  it("sans accountId — accès global uniquement (entries sans DataEntryAccess)", async () => {
    // Sans accountId, le filtre SQL exclut TOUTES les entries qui ont un DataEntryAccess
    // (i.e., seules les entries truly globales sont éligibles)
    const globalEntry = { id: "entry-global", fields: "{}" };
    mockQueryRaw.mockResolvedValueOnce([globalEntry]); // flat path (pas de tx)

    const result = await selectDataEntry("campaign-access", undefined, undefined, undefined);
    expect(result?.entryId).toBe("entry-global");
  });

  it("scope shared avec access filter — compte A voit les entries globales + restreintes à A", async () => {
    setupCampaign("shared");

    const globalEntry = { id: "entry-global", fields: "{}" };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-g", category: "CatG" }]);
    mockQueryRaw.mockResolvedValueOnce([globalEntry]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-access-shared", undefined, "account-A", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-global");
  });
});

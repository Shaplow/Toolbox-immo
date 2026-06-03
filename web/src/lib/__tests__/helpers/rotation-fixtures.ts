/**
 * Helpers et fixtures pour les tests de rotation MediaLibrary / DataLibrary.
 *
 * Pattern : mock `@/lib/prisma` via vitest, expose des factories pour créer
 * rapidement des scenarios (lib + assets/entries + cursors + usages).
 *
 * Couvre les 4 modes (cat+set, cat seul, set seul, orphelins) et 2 scopes
 * (shared / per_account) pour MediaLibrary ET DataLibrary.
 *
 * À étendre en Phase 10 complétion avec vraie DB pour tester FOR UPDATE +
 * concurrence réelle (les mocks ici testent la logique mais pas la SQL).
 */

import { vi } from "vitest";

// ─── Types fixtures ──────────────────────────────────────────────────────────

export type MediaAssetFixture = {
  id: string;
  libraryId: string;
  url: string;
  filename: string;
  setTag: string | null;
  category: string | null;
  duration: number | null;
  disabled: boolean;
  createdAt: Date;
};

export type DataEntryFixture = {
  id: string;
  campaignId: string;
  fields: string; // JSON
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  usedInCycle: boolean;
  createdAt: Date;
};

export type CursorFixture = {
  accountId: string;
  libraryId: string;
  cursor: number;
  lastUsedSetTag: string | null;
  lastUsedCategory: string | null;
  lastAdvancedAt: Date | null;
};

export type UsageFixture = {
  entryId?: string;
  assetId?: string;
  accountId: string;
  usageCount: number;
  lastUsedAt: Date | null;
};

// ─── Factories — génèrent des objets typés cohérents ─────────────────────────

let _idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++_idCounter}`;

export function resetIdCounter() {
  _idCounter = 0;
}

export function makeMediaAsset(overrides: Partial<MediaAssetFixture> = {}): MediaAssetFixture {
  return {
    id: nextId("asset"),
    libraryId: "lib-1",
    url: `https://r2.test/asset-${_idCounter}.mp4`,
    filename: `asset-${_idCounter}.mp4`,
    setTag: null,
    category: null,
    duration: 10,
    disabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeDataEntry(overrides: Partial<DataEntryFixture> = {}): DataEntryFixture {
  const fields = overrides.fields ?? JSON.stringify({ key1: `value-${_idCounter}` });
  return {
    id: nextId("entry"),
    campaignId: "campaign-1",
    fields,
    setTag: null,
    category: null,
    usageCount: 0,
    lastUsedAt: null,
    usedInCycle: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeCursor(overrides: Partial<CursorFixture> = {}): CursorFixture {
  return {
    accountId: "account-1",
    libraryId: "lib-1",
    cursor: 0,
    lastUsedSetTag: null,
    lastUsedCategory: null,
    lastAdvancedAt: null,
    ...overrides,
  };
}

export function makeUsage(overrides: Partial<UsageFixture> = {}): UsageFixture {
  return {
    accountId: "account-1",
    usageCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

// ─── Scenarios prêts à l'emploi ──────────────────────────────────────────────

/**
 * Scenario : 4 entries en 2 catégories × 2 setTags (Premium A1, Premium A2,
 * Basique B1, Basique B2). Utile pour tester anti-répétition complète.
 */
export function scenario_2cat_2set_DataEntries(): DataEntryFixture[] {
  resetIdCounter();
  return [
    makeDataEntry({ setTag: "premium-a1", category: "Premium" }),
    makeDataEntry({ setTag: "premium-a2", category: "Premium" }),
    makeDataEntry({ setTag: "basique-b1", category: "Basique" }),
    makeDataEntry({ setTag: "basique-b2", category: "Basique" }),
  ];
}

/**
 * Scenario : 3 entries dans une seule catégorie (Premium) avec 3 setTags.
 * Anti-répétition tombe en mode "1 cat → exclure setTag".
 */
export function scenario_1cat_3set_DataEntries(): DataEntryFixture[] {
  resetIdCounter();
  return [
    makeDataEntry({ setTag: "premium-a1", category: "Premium" }),
    makeDataEntry({ setTag: "premium-a2", category: "Premium" }),
    makeDataEntry({ setTag: "premium-a3", category: "Premium" }),
  ];
}

/**
 * Scenario : 3 entries orphelines (setTag null, category null).
 * Pas d'anti-répétition possible → least-used pure.
 */
export function scenario_orphelins_DataEntries(): DataEntryFixture[] {
  resetIdCounter();
  return [
    makeDataEntry({ setTag: null, category: null }),
    makeDataEntry({ setTag: null, category: null }),
    makeDataEntry({ setTag: null, category: null }),
  ];
}

// ─── Mock prisma builder ─────────────────────────────────────────────────────

/**
 * Construit un mock prisma cohérent pour tester selectDataEntry / selectMediaAsset.
 * Renvoie un objet avec les mocks exposés pour pouvoir asserter dessus.
 *
 * Usage :
 *   const mocks = buildPrismaMockForRotation();
 *   vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
 *
 * Note : vi.mock() doit être appelé AVANT l'import du module testé.
 */
export type RotationPrismaMocks = {
  prisma: Record<string, unknown>;
  mockQueryRaw: ReturnType<typeof vi.fn>;
  mockTransaction: ReturnType<typeof vi.fn>;
  mockDataCampaignFindUnique: ReturnType<typeof vi.fn>;
  mockDataEntryUsageCreate: ReturnType<typeof vi.fn>;
  mockDataEntryUsageUpsert: ReturnType<typeof vi.fn>;
  mockAccountDataLibraryCursorFindUnique: ReturnType<typeof vi.fn>;
  mockMediaLibraryFindUnique: ReturnType<typeof vi.fn>;
  mockMediaAssetFindUnique: ReturnType<typeof vi.fn>;
  mockAccountLibraryCursorFindUnique: ReturnType<typeof vi.fn>;
  mockAccountLibraryCursorUpsert: ReturnType<typeof vi.fn>;
};

export function buildPrismaMockForRotation(): RotationPrismaMocks {
  const mockQueryRaw = vi.fn();
  const mockTransaction = vi.fn();
  const mockDataCampaignFindUnique = vi.fn();
  const mockDataEntryUsageCreate = vi.fn();
  const mockDataEntryUsageUpsert = vi.fn();
  const mockAccountDataLibraryCursorFindUnique = vi.fn();
  const mockMediaLibraryFindUnique = vi.fn();
  const mockMediaAssetFindUnique = vi.fn();
  const mockAccountLibraryCursorFindUnique = vi.fn();
  const mockAccountLibraryCursorUpsert = vi.fn();

  const prisma = {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    dataCampaign: { findUnique: mockDataCampaignFindUnique },
    dataEntryUsage: {
      create: mockDataEntryUsageCreate,
      upsert: mockDataEntryUsageUpsert,
    },
    accountDataLibraryCursor: { findUnique: mockAccountDataLibraryCursorFindUnique },
    mediaLibrary: { findUnique: mockMediaLibraryFindUnique },
    mediaAsset: { findUnique: mockMediaAssetFindUnique },
    accountLibraryCursor: {
      findUnique: mockAccountLibraryCursorFindUnique,
      upsert: mockAccountLibraryCursorUpsert,
    },
  };

  return {
    prisma,
    mockQueryRaw,
    mockTransaction,
    mockDataCampaignFindUnique,
    mockDataEntryUsageCreate,
    mockDataEntryUsageUpsert,
    mockAccountDataLibraryCursorFindUnique,
    mockMediaLibraryFindUnique,
    mockMediaAssetFindUnique,
    mockAccountLibraryCursorFindUnique,
    mockAccountLibraryCursorUpsert,
  };
}

// ─── Asserts custom pour rotation ────────────────────────────────────────────

/**
 * Vérifie qu'une suite d'IDs retournés ne contient pas 2 fois consécutivement
 * la même catégorie (selon le mapping passé).
 *
 * Utile pour tester l'anti-répétition par catégorie.
 */
export function assertNoConsecutiveCategory(
  selectedIds: string[],
  categoryByEntryId: Record<string, string | null>,
): void {
  for (let i = 1; i < selectedIds.length; i++) {
    const prevCat = categoryByEntryId[selectedIds[i - 1]];
    const currCat = categoryByEntryId[selectedIds[i]];
    if (prevCat !== null && currCat !== null && prevCat === currCat) {
      throw new Error(
        `Anti-répétition catégorie KO : ${selectedIds[i - 1]} (${prevCat}) suivi de ${selectedIds[i]} (${currCat})`,
      );
    }
  }
}

/**
 * Vérifie qu'un set d'IDs forme un cycle complet (= chaque ID apparaît
 * au moins une fois avant qu'un autre ID se répète).
 *
 * Utile pour tester le mode cycle (toutes les entries doivent passer).
 */
export function assertCycleCompletion(
  selectedIds: string[],
  expectedUniqueCount: number,
): void {
  const seen = new Set<string>();
  for (const id of selectedIds) {
    seen.add(id);
    if (seen.size === expectedUniqueCount) return;
  }
  throw new Error(
    `Cycle incomplet : ${seen.size}/${expectedUniqueCount} entrées uniques après ${selectedIds.length} générations`,
  );
}

/**
 * MediaLibrary — `rotationMode` est le discriminant du mode de rotation.
 *
 * Non-régression du bug de rotation (12/08/2026) : le moteur choisissait sa
 * branche sur `setSequence.length > 0`, pas sur `rotationMode`. Une bibliothèque
 * basculée sur « Auto » dans l'UI mais dont la `setSequence` était restée en base
 * (la route PATCH la jetait silencieusement) continuait de tourner en ordre fixe
 * sur d'anciens setTags — les assets uploadés depuis n'étaient jamais servis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveRotationMode, declaredRotationMode, parseSetSequence } from "@/lib/rotation/rotationMode";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockMediaLibraryFindUnique = vi.fn();
const mockCursorFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    mediaLibrary: { findUnique: (...args: unknown[]) => mockMediaLibraryFindUnique(...args) },
    accountLibraryCursor: { findUnique: (...args: unknown[]) => mockCursorFindUnique(...args) },
  },
}));

import { selectMediaAssetBySetSequence, hasRotationHistory } from "@/lib/contentLibraryResolver";

function setupLibrary(rotationMode: string | null, sequence: string[]) {
  mockMediaLibraryFindUnique.mockResolvedValue({
    setSequence: JSON.stringify(sequence),
    maxUsageCount: null,
    rotationScope: "per_account",
    rotationMode,
  });
}

const ASSET = { id: "asset-A", url: "https://r2.test/a.mp4", filename: "a.mp4" };

describe("resolveRotationMode — table de vérité", () => {
  it('"none" gagne toujours, même avec une séquence', () => {
    expect(resolveRotationMode({ rotationMode: "none", setSequence: '["a"]' }).mode).toBe("none");
  });

  it('"auto" ignore la séquence sans l\'effacer', () => {
    const r = resolveRotationMode({ rotationMode: "auto", setSequence: '["a","b"]' });
    expect(r.mode).toBe("auto");
    expect(r.sequence).toEqual(["a", "b"]);
  });

  it('"override" avec séquence vide dégrade en auto plutôt que de ne rien servir', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveRotationMode({ rotationMode: "override", setSequence: "[]" }, "test").mode).toBe("auto");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ne journalise rien sans contexte (appelants client)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveRotationMode({ rotationMode: "override", setSequence: "[]" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("null (legacy) retombe sur l'ancienne règle dérivée de la séquence", () => {
    expect(resolveRotationMode({ rotationMode: null, setSequence: '["a"]' }).mode).toBe("override");
    expect(resolveRotationMode({ rotationMode: null, setSequence: "[]" }).mode).toBe("auto");
  });

  it("parseSetSequence tolère le JSON corrompu et les entrées vides", () => {
    expect(parseSetSequence("pas du json")).toEqual([]);
    expect(parseSetSequence('["a","","b"]')).toEqual(["a", "b"]);
    expect(parseSetSequence(null)).toEqual([]);
    expect(parseSetSequence(["a", "b"])).toEqual(["a", "b"]);
  });

  it("declaredRotationMode conserve l'intention override malgré une séquence vide", () => {
    // L'UI d'édition doit laisser l'utilisateur remplir sa séquence.
    expect(declaredRotationMode({ rotationMode: "override", setSequence: "[]" })).toBe("override");
    expect(resolveRotationMode({ rotationMode: "override", setSequence: "[]" }).mode).toBe("auto");
  });
});

describe("selectMediaAssetBySetSequence — branchement sur rotationMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCursorFindUnique.mockResolvedValue(null);
  });

  it('rotationMode="auto" + séquence non vide → découverte de groupes, PAS le curseur', async () => {
    setupLibrary("auto", ["theme-a", "theme-b"]);
    // 1er $queryRaw = découverte des groupes ; 2e = pick dans le groupe.
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "grp-neuf", category: "cat-1" }])
      .mockResolvedValueOnce([ASSET]);

    const res = await selectMediaAssetBySetSequence(
      "lib-1", "account-1", undefined, undefined, undefined, undefined, undefined, true,
    );

    // Le groupe vient de la découverte, pas de setSequence[cursor].
    expect(res?.resolvedSetTag).toBe("grp-neuf");
    expect(["theme-a", "theme-b"]).not.toContain(res?.resolvedSetTag);
  });

  it('rotationMode="override" + séquence non vide → suit la séquence', async () => {
    setupLibrary("override", ["theme-a", "theme-b"]);
    mockCursorFindUnique.mockResolvedValue({ cursor: 1 });
    mockQueryRaw.mockResolvedValueOnce([ASSET]);

    const res = await selectMediaAssetBySetSequence(
      "lib-1", "account-1", undefined, undefined, undefined, undefined, undefined, true,
    );

    expect(res?.resolvedSetTag).toBe("theme-b"); // sequence[cursor=1]
  });

  it('rotationMode="none" → aucune sélection', async () => {
    setupLibrary("none", ["theme-a"]);
    const res = await selectMediaAssetBySetSequence(
      "lib-1", "account-1", undefined, undefined, undefined, undefined, undefined, true,
    );
    expect(res).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('rotationMode="override" + séquence vide → bascule sur la découverte de groupes', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLibrary("override", []);
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "grp-1", category: null }])
      .mockResolvedValueOnce([ASSET]);

    const res = await selectMediaAssetBySetSequence(
      "lib-1", "account-1", undefined, undefined, undefined, undefined, undefined, true,
    );

    expect(res?.resolvedSetTag).toBe("grp-1");
    warn.mockRestore();
  });
});

describe("hasRotationHistory — arme l'anti-répétition", () => {
  it("curseur vierge → pas d'historique (aucune exclusion, c'est voulu)", () => {
    expect(hasRotationHistory(null)).toBe(false);
    expect(hasRotationHistory({ lastAdvancedAt: null, lastUsedCategory: null, lastUsedSetTag: null })).toBe(false);
  });

  it("lastAdvancedAt renseigné → historique", () => {
    expect(hasRotationHistory({ lastAdvancedAt: new Date(), lastUsedCategory: null, lastUsedSetTag: null })).toBe(true);
  });

  it("curseur legacy (groupe joué mais lastAdvancedAt null) → historique quand même", () => {
    // Observé en prod : `Behind The Scene / VISITE-3 / lastAdvancedAt=jamais`.
    // Traité comme « jamais joué », il désactivait toute l'anti-répétition et le
    // même groupe pouvait ressortir indéfiniment.
    expect(hasRotationHistory({ lastAdvancedAt: null, lastUsedCategory: "VISITE", lastUsedSetTag: "3" })).toBe(true);
    expect(hasRotationHistory({ lastAdvancedAt: null, lastUsedCategory: null, lastUsedSetTag: "3" })).toBe(true);
  });
});

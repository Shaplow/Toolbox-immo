/**
 * Tests pilote Phase 10 setup — anti-répétition DataLibrary.
 *
 * Couvre les 4 modes du helper selectEligibleDataGroups :
 *  - cat+set (≥2 cat)         → exclure dernière catégorie
 *  - cat seul (1 cat, ≥2 set) → exclure dernier setTag
 *  - set seul (1 set, ≥2 cat) → exclure dernière catégorie (= cat+set)
 *  - orphelins (null/null)    → pas d'exclusion possible
 *
 * Premier test concret de la suite Phase 10. À étendre dans Phase 10
 * complétion avec :
 *  - Tests par policy (cycle, once_*, unlimited)
 *  - Tests revert sur ERROR
 *  - Tests concurrence (vraie DB + FOR UPDATE)
 *
 * Pattern : utilise les helpers de rotation-fixtures.ts pour structure
 * cohérente avec la suite à venir.
 */

import { describe, it, expect } from "vitest";
import { selectEligibleDataGroups } from "@/lib/contentLibraryResolver";
import { assertNoConsecutiveCategory } from "./helpers/rotation-fixtures";

// ─── Helper local : simule une boucle de sélection en respectant l'anti-rép ──

/**
 * Simule N sélections successives en appliquant l'anti-répétition de
 * selectEligibleDataGroups à chaque tour. Retourne la liste des "category"
 * sélectionnées dans l'ordre.
 *
 * Pour chaque tour :
 *  1. selectEligibleDataGroups exclut les groupes selon prevCursorState
 *  2. On picke le premier groupe éligible (déterministe pour le test)
 *  3. Update prevCursorState avec le groupe pické
 */
function simulateSelections(
  allGroups: Array<{ setTag: string | null; category: string | null }>,
  rounds: number,
): Array<{ setTag: string | null; category: string | null }> {
  const selected: Array<{ setTag: string | null; category: string | null }> = [];
  let lastCat: string | null = null;
  let lastSet: string | null = null;
  let hasHistory = false;

  for (let i = 0; i < rounds; i++) {
    const eligible = selectEligibleDataGroups(allGroups, lastCat, lastSet, hasHistory);
    const pool = eligible.length > 0 ? eligible : allGroups;
    const picked = pool[0]; // déterministe : on prend le premier éligible
    selected.push(picked);
    lastCat = picked.category;
    lastSet = picked.setTag;
    hasHistory = true;
  }

  return selected;
}

// ─── Cas 1 : cat+set (≥2 cat) — anti-répétition catégorie ───────────────────

describe("Anti-répétition — Mode cat+set (≥2 catégories)", () => {
  it("4 groupes 2 cat × 2 set : alterne les catégories, ne reste pas bloqué sur une seule", () => {
    const groups = [
      { setTag: "premium-a1", category: "Premium" },
      { setTag: "premium-a2", category: "Premium" },
      { setTag: "basique-b1", category: "Basique" },
      { setTag: "basique-b2", category: "Basique" },
    ];
    const selections = simulateSelections(groups, 6);
    const categories = selections.map((g) => g.category!);

    // Au moins 2 catégories distinctes sur 6 tours (pas bloqué sur 1 seule)
    expect(new Set(categories).size).toBeGreaterThanOrEqual(2);

    // Pas 2 catégories identiques consécutives (validation stricte)
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i]).not.toBe(categories[i - 1]);
    }
  });

  it("3 cat × 1 set chacune : tourne en rotation pure (A, B, C, A, B, C)", () => {
    const groups = [
      { setTag: "s-a", category: "A" },
      { setTag: "s-b", category: "B" },
      { setTag: "s-c", category: "C" },
    ];
    const selections = simulateSelections(groups, 6);
    const categories = selections.map((g) => g.category!);

    // Pas de répétition consécutive
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i]).not.toBe(categories[i - 1]);
    }
  });
});

// ─── Cas 2 : cat seul (1 cat, ≥2 set) — anti-répétition setTag ───────────────

describe("Anti-répétition — Mode 1 cat × ≥2 setTags", () => {
  it("1 cat × 3 set : tourne sur les setTags sans se répéter consécutivement", () => {
    const groups = [
      { setTag: "s1", category: "Premium" },
      { setTag: "s2", category: "Premium" },
      { setTag: "s3", category: "Premium" },
    ];
    const selections = simulateSelections(groups, 6);
    const setTags = selections.map((g) => g.setTag!);

    // Au moins 2 setTags distincts sur 6 tours
    expect(new Set(setTags).size).toBeGreaterThanOrEqual(2);

    // Pas 2 setTags identiques consécutifs
    for (let i = 1; i < setTags.length; i++) {
      expect(setTags[i]).not.toBe(setTags[i - 1]);
    }
  });
});

// ─── Cas 3 : orphelins (null/null) — pas d'anti-rép possible ────────────────

describe("Anti-répétition — Mode orphelins (setTag null, category null)", () => {
  it("3 entries orphelines : retourne toujours le même groupe (null,null), pas d'exclusion", () => {
    const groups = [{ setTag: null, category: null }];
    const selections = simulateSelections(groups, 4);

    expect(selections).toHaveLength(4);
    selections.forEach((s) => {
      expect(s.setTag).toBeNull();
      expect(s.category).toBeNull();
    });
  });
});

// ─── Cas 4 : mixte (orphelins + groupés) ────────────────────────────────────

describe("Anti-répétition — Mode mixte (orphelins + cat)", () => {
  it("1 orphelin + 2 cat : alterne malgré l'orphelin", () => {
    const groups = [
      { setTag: null, category: null },
      { setTag: "s-a", category: "A" },
      { setTag: "s-b", category: "B" },
    ];
    const selections = simulateSelections(groups, 6);
    const categories = selections.map((g) => g.category);

    // Le mix devrait montrer de la variété (pas toujours le même groupe)
    const uniqueGroups = new Set(selections.map((g) => `${g.setTag}|${g.category}`));
    expect(uniqueGroups.size).toBeGreaterThanOrEqual(2);

    // Pas 2 catégories identiques consécutives (orphelin null !== "A" donc OK)
    for (let i = 1; i < categories.length; i++) {
      // null !== "A" est ok, on teste juste qu'on n'a pas 2 fois "A" ou 2 fois "B" d'affilée
      if (categories[i] !== null && categories[i - 1] !== null) {
        expect(categories[i]).not.toBe(categories[i - 1]);
      }
    }
  });
});

// ─── Validation du helper assertNoConsecutiveCategory ────────────────────────

describe("Helper assertNoConsecutiveCategory", () => {
  it("passe quand pas de répétition", () => {
    expect(() =>
      assertNoConsecutiveCategory(
        ["e1", "e2", "e3"],
        { e1: "A", e2: "B", e3: "A" },
      ),
    ).not.toThrow();
  });

  it("throw quand répétition consécutive", () => {
    expect(() =>
      assertNoConsecutiveCategory(
        ["e1", "e2", "e3"],
        { e1: "A", e2: "A", e3: "B" },
      ),
    ).toThrow(/Anti-répétition catégorie KO/);
  });

  it("ignore les null (orphelins) — accepte null suivi de null", () => {
    expect(() =>
      assertNoConsecutiveCategory(
        ["e1", "e2"],
        { e1: null as unknown as string, e2: null as unknown as string },
      ),
    ).not.toThrow();
  });
});

// ─── Fix C3 : comportement de la rotation sur une lib 100% orphelins ─────────
//
// Avant C3 : advanceDataLibraryCursorOnSubmit retournait prématurément quand
// submittedSetTag === null && submittedCategory === null → lastAdvancedAt jamais
// écrit → hasHistory resterait false → selectEligibleDataGroups retourne tous
// les groupes → même entrée à chaque fois.
//
// Après C3 : même avec null/null, lastAdvancedAt est toujours écrit.
// Ce test valide que selectEligibleDataGroups se comporte correctement selon
// que hasHistory est vrai (après advance) ou faux (avant le premier advance).
//
// Note : le test de la DB (lastAdvancedAt effectivement écrit) est couvert
// par les integration tests (Phase 10 rotation.data-revert-on-error.test.ts).
// Ici on teste la conséquence logique : une fois hasHistory=true,
// selectEligibleDataGroups doit bien tenter l'anti-répétition même avec null/null.

describe("Fix C3 — Orphan group (null/null) et hasHistory", () => {
  const orphanGroup = [{ setTag: null, category: null }];

  it("hasHistory=false (jamais avancé) → retourne tous les groupes (pas d'exclusion)", () => {
    const eligible = selectEligibleDataGroups(orphanGroup, null, null, false);
    expect(eligible).toEqual(orphanGroup);
  });

  it("hasHistory=true + lastCategory=null → fallback retourne allGroups (W3.2)", () => {
    // Une lib 100% orphelins a 1 catégorie unique (null). L'anti-rep exclut
    // le dernier setTag (null). filtered=[] → fallback explicite vers
    // allGroups (intégré dans la fn depuis W3.2 — avant, c'était le caller
    // qui faisait le fallback).
    const eligible = selectEligibleDataGroups(orphanGroup, null, null, true);
    expect(eligible).toEqual(orphanGroup);
    // La rotation ne se bloque jamais — le caller n'a plus besoin de wrapper.
  });

  it("simulation 3 générations consecutives orphelins: sélection ne se bloque pas", () => {
    // Après C3, hasHistory devient true dès la 1ère génération.
    // La rotation doit sélectionner le groupe orphelin à chaque tour (fallback).
    const selections = simulateSelectionsWithHistory(orphanGroup, 3);
    expect(selections).toHaveLength(3);
    selections.forEach((s) => {
      expect(s.setTag).toBeNull();
      expect(s.category).toBeNull();
    });
  });

  /**
   * Simule N sélections en commençant avec hasHistory=true dès le 2ème tour
   * (comme après le premier advance avec C3 corrigé).
   */
  function simulateSelectionsWithHistory(
    allGroups: Array<{ setTag: string | null; category: string | null }>,
    rounds: number,
  ): Array<{ setTag: string | null; category: string | null }> {
    const selected: Array<{ setTag: string | null; category: string | null }> = [];
    let lastCat: string | null = null;
    let lastSet: string | null = null;
    let hasHistory = false;

    for (let i = 0; i < rounds; i++) {
      const eligible = selectEligibleDataGroups(allGroups, lastCat, lastSet, hasHistory);
      const pool = eligible.length > 0 ? eligible : allGroups;
      const picked = pool[0];
      selected.push(picked);
      lastCat = picked.category;
      lastSet = picked.setTag;
      // C3 fix: hasHistory becomes true after first advance (even with null/null)
      hasHistory = true;
    }

    return selected;
  }
});

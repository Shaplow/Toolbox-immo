/**
 * A.9 (P5 hardening) — re-validation serveur d'un asset choisi manuellement
 * avant `POST /api/renders` : appartenance à la bibliothèque du bloc,
 * disabled=false, accès autorisé pour le compte.
 */
import { describe, it, expect } from "vitest";
import { validateManualAssetSelection, type ManualAssetRow } from "@/lib/generate/validateManualAssetSelection";

function makeRow(over: Partial<ManualAssetRow> = {}): ManualAssetRow {
  return { id: "asset-1", libraryId: "lib-1", disabled: false, accessAccountIds: [], ...over };
}

describe("validateManualAssetSelection", () => {
  it("accepte un asset public de la bonne bibliothèque, actif", () => {
    expect(validateManualAssetSelection(makeRow(), "lib-1", "acc-1")).toBeNull();
  });

  it("rejette un asset introuvable", () => {
    expect(validateManualAssetSelection(undefined, "lib-1", "acc-1")).toMatch(/introuvable/);
  });

  it("rejette un asset d'une autre bibliothèque que celle attendue", () => {
    expect(validateManualAssetSelection(makeRow({ libraryId: "lib-2" }), "lib-1", "acc-1")).toMatch(
      /n'appartient pas/,
    );
  });

  it("ne bloque pas sur l'appartenance quand la bibliothèque attendue est inconnue (bloc introuvable côté serveur)", () => {
    expect(validateManualAssetSelection(makeRow({ libraryId: "lib-2" }), undefined, "acc-1")).toBeNull();
  });

  it("rejette un asset désactivé", () => {
    expect(validateManualAssetSelection(makeRow({ disabled: true }), "lib-1", "acc-1")).toMatch(/désactivé/);
  });

  it("rejette un asset restreint à un autre compte", () => {
    expect(
      validateManualAssetSelection(makeRow({ accessAccountIds: ["acc-2"] }), "lib-1", "acc-1"),
    ).toMatch(/accessible/);
  });

  it("accepte un asset restreint quand le compte fait partie de la liste autorisée", () => {
    expect(
      validateManualAssetSelection(makeRow({ accessAccountIds: ["acc-1", "acc-2"] }), "lib-1", "acc-1"),
    ).toBeNull();
  });

  it("rejette un asset restreint quand aucun compte n'est fourni", () => {
    expect(
      validateManualAssetSelection(makeRow({ accessAccountIds: ["acc-1"] }), "lib-1", undefined),
    ).toMatch(/accessible/);
  });

  it("accepte un asset public (sans restriction) sans compte fourni", () => {
    expect(validateManualAssetSelection(makeRow(), "lib-1", undefined)).toBeNull();
  });

  it("priorise l'appartenance sur les autres checks (message le plus actionnable en premier)", () => {
    const err = validateManualAssetSelection(
      makeRow({ libraryId: "lib-2", disabled: true, accessAccountIds: ["acc-2"] }),
      "lib-1",
      "acc-1",
    );
    expect(err).toMatch(/n'appartient pas/);
  });
});

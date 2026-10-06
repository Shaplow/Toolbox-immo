import { describe, expect, it } from "vitest";
import { COMMON_ACCOUNT_REF, dataRef, mediaRef, parseRef, publicationRef } from "../ids";

const ASSET = "cmabc123def456ghi789jkl012";
const ACCOUNT = "cmzyx987wvu654tsr321qpo098";

describe("constructeurs de refs", () => {
  it("médias et données : <préfixe>.<id>.<compte>", () => {
    expect(mediaRef(ASSET, ACCOUNT)).toBe(`m.${ASSET}.${ACCOUNT}`);
    expect(dataRef("lib1", ACCOUNT)).toBe(`d.lib1.${ACCOUNT}`);
  });

  it("un compte null vaut « Commun » (c)", () => {
    expect(COMMON_ACCOUNT_REF).toBe("c");
    expect(mediaRef(ASSET, null)).toBe(`m.${ASSET}.c`);
    expect(dataRef("lib1", null)).toBe("d.lib1.c");
  });

  it("publication : p.<slotId>", () => {
    expect(publicationRef("slot1")).toBe("p.slot1");
  });

  it("ne lève jamais, même pour un id exotique (la ref sera refusée au parsing)", () => {
    expect(() => mediaRef("a.b", "x y")).not.toThrow();
    expect(() => dataRef("", null)).not.toThrow();
    expect(parseRef(mediaRef("a.b", ACCOUNT))).toBeNull();
    expect(parseRef(dataRef("", null))).toBeNull();
  });
});

describe("parseRef", () => {
  it("relit chaque forme (aller-retour)", () => {
    expect(parseRef(mediaRef(ASSET, ACCOUNT))).toEqual({ kind: "media", assetId: ASSET, accountId: ACCOUNT });
    expect(parseRef(mediaRef(ASSET, null))).toEqual({ kind: "media", assetId: ASSET, accountId: null });
    expect(parseRef(dataRef("lib1", ACCOUNT))).toEqual({ kind: "data", libraryId: "lib1", accountId: ACCOUNT });
    expect(parseRef(dataRef("lib1", null))).toEqual({ kind: "data", libraryId: "lib1", accountId: null });
    expect(parseRef(publicationRef("slot1"))).toEqual({ kind: "publication", slotId: "slot1" });
  });

  it("accepte les ids des seeds de test (tirets, soulignés)", () => {
    expect(parseRef("m.test-media-1.test-account-2")).toEqual({
      kind: "media",
      assetId: "test-media-1",
      accountId: "test-account-2",
    });
    expect(parseRef("p.test_slot-1")).toEqual({ kind: "publication", slotId: "test_slot-1" });
  });

  it("rejette ce qui n'est pas une ref", () => {
    for (const bad of [
      "",
      ".",
      "m",
      "m.",
      "m..",
      "m.a",
      "m.a.",
      "m..c",
      "p",
      "p.",
      "x.a.b",
      "M.a.b",
      "m.a.b.c",
      "d.a.b.c",
      "p.a.b",
      "p.a.c.d",
    ]) {
      expect(parseRef(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("rejette les caractères hors cuid et les tentatives d'évasion", () => {
    for (const bad of [
      "m.a/b.c",
      "m.a\\b.c",
      "m.a b.c",
      "m.a\nb.c",
      "m.a%2eb.c",
      "m.../etc/passwd.c",
      "m.é.c",
      "p.slot;DROP",
      "p.slot'",
      "p.\u0000",
    ]) {
      expect(parseRef(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("plafonne la longueur", () => {
    const long = "a".repeat(65);
    expect(parseRef(`p.${"a".repeat(64)}`)).not.toBeNull();
    expect(parseRef(`p.${long}`)).toBeNull();
    expect(parseRef(`m.${long}.c`)).toBeNull();
    expect(parseRef(`m.a.${long}`)).toBeNull();
    expect(parseRef(`p.${"a".repeat(100_000)}`)).toBeNull();
  });

  it("refuse tout ce qui n'est pas une chaîne (corps de requête non typé)", () => {
    expect(parseRef(undefined as unknown as string)).toBeNull();
    expect(parseRef(null as unknown as string)).toBeNull();
    expect(parseRef(42 as unknown as string)).toBeNull();
    expect(parseRef({ kind: "media" } as unknown as string)).toBeNull();
  });

  it("une ref de compte égale à « c » est toujours lue comme « Commun »", () => {
    expect(parseRef("m.a.c")).toEqual({ kind: "media", assetId: "a", accountId: null });
  });
});

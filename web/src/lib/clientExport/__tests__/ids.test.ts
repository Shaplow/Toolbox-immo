import { describe, expect, it } from "vitest";
import { COMMON_ACCOUNT_REF, dataRef, mediaRef, publicationRef } from "../ids";

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

  it("ne lève jamais, même pour un id exotique", () => {
    expect(() => mediaRef("a.b", "x y")).not.toThrow();
    expect(() => dataRef("", null)).not.toThrow();
  });

  it("distingue chaque fichier d'un même asset ou d'une même bibliothèque", () => {
    const refs = [
      mediaRef(ASSET, ACCOUNT),
      mediaRef(ASSET, "autre"),
      mediaRef(ASSET, null),
      dataRef(ASSET, ACCOUNT),
      dataRef(ASSET, null),
      publicationRef(ASSET),
    ];
    expect(new Set(refs).size).toBe(refs.length);
  });
});

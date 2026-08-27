import { describe, it, expect } from "vitest";
import {
  estimateSequenceDuration,
  estimateSingleVideoDuration,
  resolveRequiredAudioDuration,
} from "@/lib/generate/estimateOutputDuration";

describe("estimateSequenceDuration", () => {
  it("prend le min(durée, plafond) quand les deux sont connus", () => {
    const e = estimateSequenceDuration([
      { id: "a", assetDuration: 10, cap: 6 },
      { id: "b", assetDuration: 4, cap: 8 },
    ]);
    expect(e.seconds).toBe(10); // 6 + 4
    expect(e.partial).toBe(false);
  });

  it("retombe sur le plafond seul, ou la durée seule", () => {
    const e = estimateSequenceDuration([
      { id: "cap-only", cap: 5 },
      { id: "duration-only", assetDuration: 7 },
    ]);
    expect(e.seconds).toBe(12);
    expect(e.partial).toBe(false);
  });

  it("marque l'estimation partielle quand une source n'a ni durée ni plafond", () => {
    // C'est le cas du clip principal alimenté par le formulaire : avant, il
    // comptait 0 ET faisait tomber le filtre entier.
    const e = estimateSequenceDuration([
      { id: "intro", assetDuration: 3 },
      { id: "clip-formulaire" },
      { id: "outro", assetDuration: 4 },
    ]);
    expect(e.seconds).toBe(7);
    expect(e.partial).toBe(true);
    expect(e.unknownSourceIds).toEqual(["clip-formulaire"]);
  });

  it("plafonne au canvas.maxDuration", () => {
    const e = estimateSequenceDuration(
      [{ id: "a", assetDuration: 40 }, { id: "b", assetDuration: 40 }],
      50,
    );
    expect(e.seconds).toBe(50);
  });
});

describe("estimateSingleVideoDuration", () => {
  it("prend le MAX des sources, jamais la somme (un seul bloc est rendu)", () => {
    const e = estimateSingleVideoDuration([
      { id: "a", assetDuration: 12 },
      { id: "b", assetDuration: 30 },
    ]);
    expect(e.seconds).toBe(30);
  });

  it("le plafond du canvas prime et rend l'estimation complète", () => {
    const e = estimateSingleVideoDuration([{ id: "inconnu" }], 25);
    expect(e.seconds).toBe(25);
    expect(e.partial).toBe(false);
  });
});

describe("resolveRequiredAudioDuration", () => {
  it("prend le max entre minDuration et l'estimation", () => {
    expect(
      resolveRequiredAudioDuration({ minDuration: 20 }, { seconds: 45, partial: false, unknownSourceIds: [] }),
    ).toBe(45);
    expect(
      resolveRequiredAudioDuration({ minDuration: 60 }, { seconds: 45, partial: false, unknownSourceIds: [] }),
    ).toBe(60);
  });

  it("une estimation partielle sert quand même de plancher", () => {
    expect(
      resolveRequiredAudioDuration({}, { seconds: 7, partial: true, unknownSourceIds: ["clip"] }),
    ).toBe(7);
  });

  it("ne contraint rien quand la piste boucle", () => {
    expect(
      resolveRequiredAudioDuration({ minDuration: 60, loop: true }, { seconds: 45, partial: false, unknownSourceIds: [] }),
    ).toBeUndefined();
  });

  it("undefined quand aucune contrainte n'est connue", () => {
    expect(
      resolveRequiredAudioDuration({}, { seconds: 0, partial: true, unknownSourceIds: ["a"] }),
    ).toBeUndefined();
  });
});

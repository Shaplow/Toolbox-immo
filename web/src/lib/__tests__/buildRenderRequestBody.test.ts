/**
 * Body de `POST /api/renders` — `accountId` et `publicationSlotId` ne dépendent
 * plus du contexte de prefill.
 *
 * Non-régression : ces deux champs étaient lus exclusivement sur
 * `libraryPrefillContext`, qui vaut `undefined` dès que le template n'a aucun
 * binding bibliothèque et qui perd `slotId` à chaque changement de compte IG.
 * Un rendu partait alors sans compte → `recordLibraryUsage` n'écrivait aucune
 * ligne `MediaAssetUsage`, l'asset consommé restait « jamais utilisé » du point
 * de vue du compte et ressortait en tête de la rotation suivante.
 */

import { describe, it, expect } from "vitest";
import { buildRenderRequestBody, buildUsedAssets } from "@/lib/generate/buildRenderRequestBody";
import type { LibraryPrefillContext, LibraryAssetOption } from "@/types/libraryPrefill";

function makeContext(over: Partial<LibraryPrefillContext> = {}): LibraryPrefillContext {
  return {
    fieldLibraryMap: {},
    selectedAccountId: undefined,
    slotId: undefined,
    ...over,
  } as LibraryPrefillContext;
}

const BASE = { templateId: "tpl-1", listingId: "lst-1", selections: {} };

describe("buildRenderRequestBody", () => {
  it("conserve accountId et slotId même sans contexte de prefill", () => {
    const body = buildRenderRequestBody({
      ...BASE,
      accountId: "account-1",
      slotId: "slot-1",
      context: undefined,
    });
    expect(body.accountId).toBe("account-1");
    expect(body.publicationSlotId).toBe("slot-1");
    expect(body.usedAssets).toBeUndefined();
  });

  it("les paramètres explicites priment sur le contexte", () => {
    // L'utilisateur a changé de compte : le state du form fait foi.
    const body = buildRenderRequestBody({
      ...BASE,
      accountId: "account-choisi",
      slotId: "slot-1",
      context: makeContext({ selectedAccountId: "account-perime", slotId: undefined }),
    });
    expect(body.accountId).toBe("account-choisi");
    expect(body.publicationSlotId).toBe("slot-1");
  });

  it("le contexte reste un repli quand la page n'a rien fourni", () => {
    const body = buildRenderRequestBody({
      ...BASE,
      context: makeContext({ selectedAccountId: "account-ctx", slotId: "slot-ctx" }),
    });
    expect(body.accountId).toBe("account-ctx");
    expect(body.publicationSlotId).toBe("slot-ctx");
  });

  it("slotId survit à un contexte rechargé qui l'a perdu", () => {
    // POST /api/templates/[id]/prefill renvoie un contexte sans slotId.
    const body = buildRenderRequestBody({
      ...BASE,
      accountId: "account-2",
      slotId: "slot-1",
      context: makeContext({ selectedAccountId: "account-2", slotId: undefined }),
    });
    expect(body.publicationSlotId).toBe("slot-1");
  });

  it("normalise les chaînes vides en undefined", () => {
    const body = buildRenderRequestBody({ ...BASE, accountId: "", slotId: "", context: undefined });
    expect(body.accountId).toBeUndefined();
    expect(body.publicationSlotId).toBeUndefined();
  });
});

describe("buildUsedAssets", () => {
  const videoOption: LibraryAssetOption = { id: "asset-1", url: "https://r2.test/a.mp4" } as LibraryAssetOption;

  it("agrège les vidéos sélectionnées par blockId", () => {
    const ctx = makeContext({
      fieldLibraryMap: { champ_video: { type: "video", blockId: "block-1", libraryId: "lib-1" } },
      setSequencedLibraryIds: ["lib-1"],
    } as Partial<LibraryPrefillContext>);

    const used = buildUsedAssets(ctx, { champ_video: videoOption });
    expect(used?.videoAssets).toEqual({ "block-1": "asset-1" });
    expect(used?.setSequencedLibraryIds).toEqual(["lib-1"]);
  });

  it("retourne undefined quand rien n'est sélectionné", () => {
    const ctx = makeContext({
      fieldLibraryMap: { champ_video: { type: "video", blockId: "block-1", libraryId: "lib-1" } },
    } as Partial<LibraryPrefillContext>);
    expect(buildUsedAssets(ctx, { champ_video: null })).toBeUndefined();
  });
});

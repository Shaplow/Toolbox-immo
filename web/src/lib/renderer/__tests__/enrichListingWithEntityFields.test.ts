/**
 * Tests de `enrichListingWithEntityFields` — injection déclarative des champs
 * de fiche (Entity) dans listingData, résolue au rendu.
 *
 * Matrice couverte : provenance × entitySource × vide/non-vide, fiche data vs
 * tournage, absence de contexte fiche, provenance absente du listing
 * (dégradé). Plus un test de non-régression sur `enrichListingWithAssetMetadata`
 * (précédence : asset en dernier, ne doit jamais écraser une valeur déjà posée
 * par la fiche).
 */

import { describe, it, expect, vi } from "vitest";
import type { ListingData } from "@/types/listing";
import type { SchemaField } from "@/types/template";
import { PROVENANCE_KEY, type ProvenanceMap } from "@/lib/generate/provenance";

// `generateRender.ts` (importé dynamiquement plus bas pour le test de
// non-régression asset/fiche) tire transitivement `server-only` via
// `triggerAutoTranscriptionLocal` → `captionPromptStore` — package absent
// hors bundler Next.js. Stub vide, même convention que
// `lib/__tests__/applyExcludeZones.test.ts`.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: vi.fn(),
    },
  },
}));

import {
  enrichListingWithEntityFields,
  loadRenderEntityContext,
  type RenderEntityContext,
} from "@/lib/renderer/enrichListingWithEntityFields";
import { prisma } from "@/lib/prisma";

function listing(data: Record<string, unknown>, provenance?: ProvenanceMap): ListingData {
  const withProvenance = provenance ? { ...data, [PROVENANCE_KEY]: provenance } : data;
  return withProvenance as unknown as ListingData;
}

function field(key: string, overrides: Partial<SchemaField> = {}): SchemaField {
  return { key, label: key, type: "text", required: false, ...overrides };
}

const DATA_FICHE: RenderEntityContext = {
  entityFields: { prix: "450000", surface: "82" },
  shootEntityFields: null,
};

const SHOOT_FICHE: RenderEntityContext = {
  entityFields: null,
  shootEntityFields: { prix: "999999", adresse: "12 rue de la Paix" },
};

const BOTH_FICHES: RenderEntityContext = {
  entityFields: { prix: "450000" },
  shootEntityFields: { prix: "999999", adresse: "12 rue de la Paix" },
};

describe("enrichListingWithEntityFields — no-op paths", () => {
  it("entityContext null → renvoie listingData telle quelle (même référence)", () => {
    const data = listing({ prix: "" });
    const result = enrichListingWithEntityFields(data, [field("prix")], null);
    expect(result).toBe(data);
  });

  it("entityContext avec les deux fiches null → no-op (même référence)", () => {
    const data = listing({ prix: "" });
    const emptyContext: RenderEntityContext = { entityFields: null, shootEntityFields: null };
    const result = enrichListingWithEntityFields(data, [field("prix")], emptyContext);
    expect(result).toBe(data);
  });

  it("aucun champ du schéma ne matche/ne référence la fiche → no-op (même référence)", () => {
    const data = listing({ titre: "Bel appartement" });
    const result = enrichListingWithEntityFields(data, [field("titre")], DATA_FICHE);
    expect(result).toBe(data);
  });
});

describe("enrichListingWithEntityFields — règle 1 : entitySource explicite", () => {
  it("re-résout toujours live, même si listingData a déjà une valeur", () => {
    const data = listing({ prix: "ancienne_valeur" });
    const schema = [field("prix", { entitySource: { slot: "data", fieldKey: "prix" } })];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("450000");
  });

  it("cible slot=\"shoot\" → lit shootEntityFields, pas entityFields", () => {
    const data = listing({ prix: "" });
    const schema = [field("prix", { entitySource: { slot: "shoot", fieldKey: "prix" } })];
    const result = enrichListingWithEntityFields(data, schema, BOTH_FICHES);
    expect(result.prix).toBe("999999");
  });

  it("clé absente dans la fiche ciblée → pas de patch, valeur existante conservée", () => {
    const data = listing({ prix: "gardee" });
    const schema = [field("prix", { entitySource: { slot: "data", fieldKey: "inexistant" } })];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("gardee");
  });

  it("provenance \"manual\" sur la clé bloque la résolution même avec entitySource", () => {
    const data = listing({ prix: "saisie_manuelle" }, { prix: "manual" });
    const schema = [field("prix", { entitySource: { slot: "data", fieldKey: "prix" } })];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("saisie_manuelle");
  });
});

describe("enrichListingWithEntityFields — règle 2 : provenance entity/shootEntity sans entitySource déclaré", () => {
  it("provenance \"entity\" → re-résolue live par son propre nom de clé (fiche data)", () => {
    const data = listing({ prix: "ancienne" }, { prix: "entity" });
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("450000");
  });

  it("provenance \"shootEntity\" → re-résolue live depuis shootEntityFields", () => {
    const data = listing({ adresse: "ancienne" }, { adresse: "shootEntity" });
    const schema = [field("adresse")];
    const result = enrichListingWithEntityFields(data, schema, SHOOT_FICHE);
    expect(result.adresse).toBe("12 rue de la Paix");
  });

  it("provenance \"entity\" mais clé absente de la fiche → valeur existante conservée", () => {
    const data = listing({ inconnu: "gardee" }, { inconnu: "entity" });
    const schema = [field("inconnu")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.inconnu).toBe("gardee");
  });
});

describe("enrichListingWithEntityFields — règle 3 : match implicite par nom (précédence data > shoot)", () => {
  it("clé vide + match dans entityFields → remplie", () => {
    const data = listing({ prix: "" });
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("450000");
  });

  it("clé vide + match seulement dans shootEntityFields → remplie depuis la fiche tournage", () => {
    const data = listing({ adresse: undefined });
    const schema = [field("adresse")];
    const result = enrichListingWithEntityFields(data, schema, SHOOT_FICHE);
    expect(result.adresse).toBe("12 rue de la Paix");
  });

  it("match dans les deux fiches → précédence fiche data", () => {
    const data = listing({ prix: null });
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, BOTH_FICHES);
    expect(result.prix).toBe("450000");
  });

  it("clé déjà non vide → jamais écrasée par le match implicite", () => {
    const data = listing({ prix: "valeur_utilisateur" });
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("valeur_utilisateur");
  });
});

describe("enrichListingWithEntityFields — règle 4 : provenance \"manual\" jamais touchée", () => {
  it("bloque le match implicite même sur une clé vide", () => {
    const data = listing({ prix: "" }, { prix: "manual" });
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("");
  });
});

describe("enrichListingWithEntityFields — dégradé provenance absente du listing", () => {
  it("pas de clé __provenance dans listingData → traité comme non-manual, match implicite s'applique", () => {
    const data = listing({ prix: "" }); // pas de 2e argument → pas de PROVENANCE_KEY
    const schema = [field("prix")];
    const result = enrichListingWithEntityFields(data, schema, DATA_FICHE);
    expect(result.prix).toBe("450000");
  });
});

describe("loadRenderEntityContext", () => {
  it("publicationSlotId absent → NO-OP strict, aucune requête prisma", async () => {
    const result = await loadRenderEntityContext(null);
    expect(result).toBeNull();
    expect(prisma.publicationSlot.findUnique).not.toHaveBeenCalled();
  });

  it("publicationSlotId présent mais slot introuvable → null", async () => {
    vi.mocked(prisma.publicationSlot.findUnique).mockResolvedValueOnce(null as never);
    const result = await loadRenderEntityContext("slot_1");
    expect(result).toBeNull();
  });

  it("parse les champs JSON de entity/shootEntity quand présents", async () => {
    vi.mocked(prisma.publicationSlot.findUnique).mockResolvedValueOnce({
      entity: { fields: JSON.stringify({ prix: "450000" }) },
      shootEntity: null,
    } as never);
    const result = await loadRenderEntityContext("slot_1");
    expect(result).toEqual({ entityFields: { prix: "450000" }, shootEntityFields: null });
  });
});

describe("non-régression — enrichListingWithAssetMetadata garde sa précédence (asset en dernier)", () => {
  it("l'enrichissement fiche (appliqué en premier) n'est jamais écrasé par l'enrichissement asset (appliqué en dernier)", async () => {
    const { enrichListingWithAssetMetadata } = await import("@/lib/renderer/generateRender");

    const rawListing = listing({ prix: "" });
    const schema: SchemaField[] = [
      field("prix", { entitySource: { slot: "data", fieldKey: "prix" }, metadataSource: { libraryId: "lib_1", metadataKey: "prix" } }),
    ];

    const entityEnriched = enrichListingWithEntityFields(rawListing, schema, DATA_FICHE);
    expect(entityEnriched.prix).toBe("450000"); // vient de la fiche

    const assetMetadataByLibrary = new Map<string, Record<string, string | number | null>>([
      ["lib_1", { prix: 999999 }], // valeur asset — ne doit PAS gagner
    ]);
    const finalListing = enrichListingWithAssetMetadata(entityEnriched, schema, assetMetadataByLibrary);

    expect(finalListing.prix).toBe("450000");
  });

  it("l'enrichissement asset comble seulement les champs encore vides après la fiche", async () => {
    const { enrichListingWithAssetMetadata } = await import("@/lib/renderer/generateRender");

    const rawListing = listing({ prix: "", surface: "" });
    const schema: SchemaField[] = [
      field("prix", { entitySource: { slot: "data", fieldKey: "prix" }, metadataSource: { libraryId: "lib_1", metadataKey: "prix" } }),
      field("surface", { metadataSource: { libraryId: "lib_1", metadataKey: "surface" } }), // pas de fiche pour ce champ
    ];

    // Fiche sans "surface" : ce champ n'a aucune source fiche, contrairement à "prix".
    const ficheSansSurface: RenderEntityContext = { entityFields: { prix: "450000" }, shootEntityFields: null };
    const entityEnriched = enrichListingWithEntityFields(rawListing, schema, ficheSansSurface);
    const assetMetadataByLibrary = new Map<string, Record<string, string | number | null>>([
      ["lib_1", { prix: 999999, surface: 82 }],
    ]);
    const finalListing = enrichListingWithAssetMetadata(entityEnriched, schema, assetMetadataByLibrary);

    expect(finalListing.prix).toBe("450000"); // fiche gagne
    expect(finalListing.surface).toBe(82); // asset comble le vide, seul champ sans source fiche
  });
});

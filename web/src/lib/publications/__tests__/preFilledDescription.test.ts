/**
 * Tests resolvePrefilledCaption — résolution unifiée de la légende
 * pré-remplie (Vague 3 phase 3) :
 *
 *  1. mode ∉ {"preFilled", "fixed"} → null.
 *  2. descriptionFixedText non vide → modèle `{{clé}}` résolu contre les
 *     champs mergés (fiche tournage < fiche data), puis tokens système.
 *  3. descriptionFixedText vide → alias legacy descriptionSourceFieldKey
 *     (lookup direct, comportement historique).
 *  4. Résultat vide/blanc après résolution → null (jamais de wipe).
 *  5. mode "fixed" legacy (texte littéral sans `{{clé}}`) → inchangé.
 */

import { describe, it, expect } from "vitest";
import {
  resolvePrefilledCaption,
  resolvePrefilledCaptionFromEntities,
  normalizeFixedText,
  normalizeSourceFieldKey,
} from "../preFilledDescription";

describe("resolvePrefilledCaption", () => {
  describe("mode inactif", () => {
    it("retourne null si needsDescription n'est ni preFilled ni fixed", () => {
      for (const mode of ["autoGenerate", "manualWrite", "none", null, undefined]) {
        expect(
          resolvePrefilledCaption(
            { needsDescription: mode, descriptionFixedText: "Texte", descriptionSourceFieldKey: null },
            {},
          ),
        ).toBeNull();
      }
    });
  });

  describe("templating (descriptionFixedText)", () => {
    const fields = { adresse: "12 rue de la Paix", prix: "350 000 €" };

    it("résout {{clé}} contre les champs mergés", () => {
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "🏡 Nouveau bien à {{adresse}} — {{prix}}",
            descriptionSourceFieldKey: null,
          },
          fields,
        ),
      ).toBe("🏡 Nouveau bien à 12 rue de la Paix — 350 000 €");
    });

    it("clé absente du contexte → segment vide, pas d'erreur", () => {
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "Prix : {{prix_inexistant}}",
            descriptionSourceFieldKey: null,
          },
          fields,
        ),
      ).toBe("Prix : ");
    });

    it("fonctionne mode fixed (legacy) avec un texte littéral, sans dépendance au contexte", () => {
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "fixed",
            descriptionFixedText: "Visitez ce bien d'exception ✨",
            descriptionSourceFieldKey: null,
          },
          null,
        ),
      ).toBe("Visitez ce bien d'exception ✨");
    });

    it("résout les tokens système ({{maintenant:YYYY}}) après le templating", () => {
      const year = String(new Date().getFullYear());
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "Tourné en {{maintenant:YYYY}}",
            descriptionSourceFieldKey: null,
          },
          {},
        ),
      ).toBe(`Tourné en ${year}`);
    });

    it("template résolu à du vide/espaces → null (jamais de wipe)", () => {
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "{{absent}}",
            descriptionSourceFieldKey: null,
          },
          {},
        ),
      ).toBeNull();
    });

    it("accepte des champs mergés fiche tournage < fiche data (précédence appliquée par l'appelant)", () => {
      // La fusion elle-même (shootEntity < entity) vit côté appelant
      // (slotService.ts / runDescriptionForSlot.ts) — ici on vérifie juste
      // que la valeur qui "gagne" dans l'objet déjà mergé est bien celle
      // utilisée par le template.
      const mergedFields = { titre: "Depuis la fiche data" }; // entity a gagné sur shootEntity
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "{{titre}}",
            descriptionSourceFieldKey: null,
          },
          mergedFields,
        ),
      ).toBe("Depuis la fiche data");
    });
  });

  describe("alias legacy (descriptionSourceFieldKey)", () => {
    const fields = JSON.stringify({
      description: "Superbe T3 lumineux, plein sud.",
      vide: "   ",
    });

    it("utilisé seulement quand descriptionFixedText est vide/absent", () => {
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "description" },
          fields,
        ),
      ).toBe("Superbe T3 lumineux, plein sud.");
    });

    it("descriptionFixedText non vide prime sur descriptionSourceFieldKey", () => {
      expect(
        resolvePrefilledCaption(
          {
            needsDescription: "preFilled",
            descriptionFixedText: "Texte du modèle",
            descriptionSourceFieldKey: "description",
          },
          fields,
        ),
      ).toBe("Texte du modèle");
    });

    it("retourne null si aucune clé source configurée", () => {
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "   " },
          fields,
        ),
      ).toBeNull();
    });

    it("retourne null si la clé est absente ou vide/espaces (jamais de wipe)", () => {
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "inexistant" },
          fields,
        ),
      ).toBeNull();
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "vide" },
          fields,
        ),
      ).toBeNull();
    });

    it("tolère un objet déjà parsé et un JSON illisible", () => {
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "description" },
          { description: "T2 rénové" },
        ),
      ).toBe("T2 rénové");
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "description" },
          "{ pas du json",
        ),
      ).toBeNull();
      expect(
        resolvePrefilledCaption(
          { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: "description" },
          null,
        ),
      ).toBeNull();
    });
  });
});

describe("resolvePrefilledCaptionFromEntities", () => {
  const config = {
    needsDescription: "preFilled",
    descriptionFixedText: "🏡 {{adresse}} — {{prix}}",
    descriptionSourceFieldKey: null,
  };

  it("fusionne fiche tournage < fiche data (la fiche data l'emporte sur collision de clé)", () => {
    const shootFields = JSON.stringify({ adresse: "Ancienne adresse (tournage)", date: "2026-08-18" });
    const entityFields = JSON.stringify({ adresse: "12 rue de la Paix", prix: "350 000 €" });
    expect(resolvePrefilledCaptionFromEntities(config, shootFields, entityFields)).toBe(
      "🏡 12 rue de la Paix — 350 000 €",
    );
  });

  it("utilise la fiche tournage seule si aucune fiche data n'est rattachée", () => {
    const shootFields = JSON.stringify({ adresse: "Adresse du tournage", prix: "" });
    expect(resolvePrefilledCaptionFromEntities(config, shootFields, null)).toBe(
      "🏡 Adresse du tournage — ",
    );
  });

  it("tolère les deux fiches absentes (aucun champ résolu, template littéral conservé)", () => {
    expect(
      resolvePrefilledCaptionFromEntities(
        { needsDescription: "fixed", descriptionFixedText: "Texte fixe, sans clé", descriptionSourceFieldKey: null },
        null,
        null,
      ),
    ).toBe("Texte fixe, sans clé");
  });

  it("délègue toujours à resolvePrefilledCaption (mode inactif → null)", () => {
    expect(
      resolvePrefilledCaptionFromEntities(
        { needsDescription: "manualWrite", descriptionFixedText: "{{adresse}}", descriptionSourceFieldKey: null },
        null,
        JSON.stringify({ adresse: "12 rue de la Paix" }),
      ),
    ).toBeNull();
  });

  describe("4e source — dataEntryFieldsJson (fill-only, entity > shootEntity > dataEntry)", () => {
    it("entrée seule (aucune fiche rattachée) → ses champs résolvent le modèle", () => {
      expect(
        resolvePrefilledCaptionFromEntities(
          config,
          null,
          null,
          JSON.stringify({ adresse: "Depuis l'entrée data", prix: "290 000 €" }),
        ),
      ).toBe("🏡 Depuis l'entrée data — 290 000 €");
    });

    it("entrée + fiches : la fiche (entity/shootEntity) prime sur l'entrée en cas de collision", () => {
      const shootFields = JSON.stringify({ adresse: "Adresse tournage" });
      const entityFields = JSON.stringify({ prix: "350 000 €" });
      const dataFields = JSON.stringify({ adresse: "Adresse entrée (ignorée)", prix: "999 €" });
      expect(
        resolvePrefilledCaptionFromEntities(config, shootFields, entityFields, dataFields),
      ).toBe("🏡 Adresse tournage — 350 000 €");
    });

    it("valeur BLANCHE (\"\") de fiche ne masque PAS la valeur de l'entrée (fill-only, pas un spread)", () => {
      // La fiche data porte `prix: ""` (volontairement vide) — un simple
      // spread `{...dataEntry, ...shoot, ...entity}` laisserait ce "" gagner
      // et écraserait silencieusement la valeur de l'entrée.
      const entityFields = JSON.stringify({ adresse: "12 rue de la Paix", prix: "" });
      const dataFields = JSON.stringify({ prix: "350 000 €" });
      expect(
        resolvePrefilledCaptionFromEntities(config, null, entityFields, dataFields),
      ).toBe("🏡 12 rue de la Paix — 350 000 €");
    });

    it("absence d'entrée (undefined) → comportement 3-sources inchangé", () => {
      const shootFields = JSON.stringify({ adresse: "Ancienne adresse (tournage)" });
      const entityFields = JSON.stringify({ adresse: "12 rue de la Paix", prix: "350 000 €" });
      expect(resolvePrefilledCaptionFromEntities(config, shootFields, entityFields)).toBe(
        resolvePrefilledCaptionFromEntities(config, shootFields, entityFields, undefined),
      );
      expect(resolvePrefilledCaptionFromEntities(config, shootFields, entityFields)).toBe(
        "🏡 12 rue de la Paix — 350 000 €",
      );
    });

    it("mode legacy \"fixed\" (alias descriptionSourceFieldKey) : l'entrée comble le champ absent de la fiche", () => {
      const legacyConfig = {
        needsDescription: "fixed",
        descriptionFixedText: null,
        descriptionSourceFieldKey: "description",
      };
      const entityFields = JSON.stringify({ autreChamp: "peu importe" });
      const dataFields = JSON.stringify({ description: "Depuis l'entrée data tirée." });
      expect(
        resolvePrefilledCaptionFromEntities(legacyConfig, null, entityFields, dataFields),
      ).toBe("Depuis l'entrée data tirée.");
    });
  });
});

describe("normalizeFixedText", () => {
  it("non-string → null", () => {
    expect(normalizeFixedText(null)).toBeNull();
    expect(normalizeFixedText(undefined)).toBeNull();
  });

  it("chaîne vide/espaces → null", () => {
    expect(normalizeFixedText("")).toBeNull();
    expect(normalizeFixedText("   ")).toBeNull();
  });

  it("texte rempli → conserve le brut (pas de trim destructif)", () => {
    expect(normalizeFixedText("  Bonjour  ")).toBe("  Bonjour  ");
  });
});

describe("normalizeSourceFieldKey", () => {
  it("non-string ou vide/espaces → null", () => {
    expect(normalizeSourceFieldKey(null)).toBeNull();
    expect(normalizeSourceFieldKey(undefined)).toBeNull();
    expect(normalizeSourceFieldKey("   ")).toBeNull();
  });

  it("trim la clé", () => {
    expect(normalizeSourceFieldKey("  description  ")).toBe("description");
  });
});

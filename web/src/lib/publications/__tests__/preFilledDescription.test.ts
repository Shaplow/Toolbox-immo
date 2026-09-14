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
  diagnosePrefilledCaption,
  unresolvedTemplateKeys,
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

  it("la fiche data l'emporte sur le tournage en cas de collision", () => {
    expect(
      resolvePrefilledCaptionFromEntities(config, {
        shootEntityFields: JSON.stringify({ adresse: "Ancienne adresse (tournage)", date: "2026-08-18" }),
        entityFields: JSON.stringify({ adresse: "12 rue de la Paix", prix: "350 000 €" }),
      }),
    ).toBe("🏡 12 rue de la Paix — 350 000 €");
  });

  it("utilise la fiche tournage seule si aucune fiche data n'est rattachée", () => {
    expect(
      resolvePrefilledCaptionFromEntities(config, {
        shootEntityFields: JSON.stringify({ adresse: "Adresse du tournage", prix: "" }),
      }),
    ).toBe("🏡 Adresse du tournage — ");
  });

  it("tolère toutes les fiches absentes (template littéral conservé)", () => {
    expect(
      resolvePrefilledCaptionFromEntities(
        { needsDescription: "fixed", descriptionFixedText: "Texte fixe, sans clé", descriptionSourceFieldKey: null },
        {},
      ),
    ).toBe("Texte fixe, sans clé");
  });

  it("délègue toujours à resolvePrefilledCaption (mode inactif → null)", () => {
    expect(
      resolvePrefilledCaptionFromEntities(
        { needsDescription: "manualWrite", descriptionFixedText: "{{adresse}}", descriptionSourceFieldKey: null },
        { entityFields: JSON.stringify({ adresse: "12 rue de la Paix" }) },
      ),
    ).toBeNull();
  });

  /**
   * Le bien lié au TOURNAGE (`shootEntity.relatedEntityId`).
   *
   * Avant, il n'était lisible que s'il avait été recopié sur `slot.entityId` à
   * la création du reel. Un tournage qui gagnait son bien après coup laissait
   * la légende définitivement vide — et « Recalculer » relisait la même fiche
   * absente.
   */
  describe("bien du tournage", () => {
    it("comble une clé absente de la fiche et du tournage", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          shootEntityFields: JSON.stringify({ adresse: "12 rue de la Paix" }),
          shootRelatedFields: JSON.stringify({ prix: "350 000 €" }),
        }),
      ).toBe("🏡 12 rue de la Paix — 350 000 €");
    });

    it("n'écrase ni la fiche data ni le tournage", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          entityFields: JSON.stringify({ adresse: "Fiche data" }),
          shootEntityFields: JSON.stringify({ prix: "Tournage" }),
          shootRelatedFields: JSON.stringify({ adresse: "Bien (ignoré)", prix: "Bien (ignoré)" }),
        }),
      ).toBe("🏡 Fiche data — Tournage");
    });

    // Une donnée réelle sur le sujet prime sur du texte de rotation générique.
    it("passe AVANT la bibliothèque", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          shootRelatedFields: JSON.stringify({ adresse: "Le vrai bien", prix: "350 000 €" }),
          dataEntryFields: JSON.stringify({ adresse: "Texte générique", prix: "999 €" }),
        }),
      ).toBe("🏡 Le vrai bien — 350 000 €");
    });

    it("la bibliothèque comble ce que le bien ne porte pas", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          shootRelatedFields: JSON.stringify({ adresse: "Le vrai bien" }),
          dataEntryFields: JSON.stringify({ prix: "350 000 €" }),
        }),
      ).toBe("🏡 Le vrai bien — 350 000 €");
    });
  });

  /**
   * Correction de comportement : toutes les couches sont désormais fill-only.
   * Avant, les deux premières s'écrasaient par simple spread — un bien portant
   * `prix: ""` effaçait le prix du tournage et rendait une légende vide.
   */
  describe("fill-only à tous les étages", () => {
    it('une valeur vide de la fiche data ne masque plus celle du tournage', () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          entityFields: JSON.stringify({ adresse: "12 rue de la Paix", prix: "" }),
          shootEntityFields: JSON.stringify({ prix: "250 000 €" }),
        }),
      ).toBe("🏡 12 rue de la Paix — 250 000 €");
    });

    it("une valeur vide de fiche ne masque pas celle de la bibliothèque", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          entityFields: JSON.stringify({ adresse: "12 rue de la Paix", prix: "" }),
          dataEntryFields: JSON.stringify({ prix: "350 000 €" }),
        }),
      ).toBe("🏡 12 rue de la Paix — 350 000 €");
    });

    it("la fiche prime sur la bibliothèque quand elle porte une vraie valeur", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          shootEntityFields: JSON.stringify({ adresse: "Adresse tournage" }),
          entityFields: JSON.stringify({ prix: "350 000 €" }),
          dataEntryFields: JSON.stringify({ adresse: "Adresse entrée (ignorée)", prix: "999 €" }),
        }),
      ).toBe("🏡 Adresse tournage — 350 000 €");
    });

    it("l'entrée seule résout le modèle quand aucune fiche n'est rattachée", () => {
      expect(
        resolvePrefilledCaptionFromEntities(config, {
          dataEntryFields: JSON.stringify({ adresse: "Depuis l'entrée data", prix: "290 000 €" }),
        }),
      ).toBe("🏡 Depuis l'entrée data — 290 000 €");
    });

    it('mode legacy "fixed" : l\'entrée comble le champ absent de la fiche', () => {
      expect(
        resolvePrefilledCaptionFromEntities(
          {
            needsDescription: "fixed",
            descriptionFixedText: null,
            descriptionSourceFieldKey: "description",
          },
          {
            entityFields: JSON.stringify({ autreChamp: "peu importe" }),
            dataEntryFields: JSON.stringify({ description: "Depuis l'entrée data tirée." }),
          },
        ),
      ).toBe("Depuis l'entrée data tirée.");
    });
  });
});

/**
 * Le diagnostic existe parce que tout échec de légende était attribué en bloc
 * à la bibliothèque de données, y compris quand aucune n'était configurée.
 */
describe("diagnosePrefilledCaption", () => {
  const config = {
    needsDescription: "preFilled",
    descriptionFixedText: "🏡 {{adresse}} — {{prix}}",
    descriptionSourceFieldKey: null,
  };

  it("null quand la légende se résout", () => {
    expect(
      diagnosePrefilledCaption(config, { adresse: "12 rue de la Paix", prix: "350 000 €" }),
    ).toBeNull();
  });

  /**
   * Le diagnostic ne parle que des ÉCHECS. Un modèle qui porte du texte fixe
   * (« 🏡 », un tiret) se résout même avec toutes ses clés vides : il produit
   * « 🏡  — », inutile mais non vide. C'est `unresolvedTemplateKeys` qui couvre
   * ce cas-là — et c'est le plus fréquent en pratique.
   */
  it("nomme les clés absentes quand le modèle N'A QUE des clés", () => {
    const keyOnly = { ...config, descriptionFixedText: "{{adresse}}" };
    expect(diagnosePrefilledCaption(keyOnly, {})).toEqual({
      reason: "unresolved_keys",
      keys: ["adresse"],
    });
  });

  it("un modèle avec du texte fixe résout, mais les clés manquantes restent signalées", () => {
    const merged = { adresse: "12 rue de la Paix" };
    expect(diagnosePrefilledCaption(config, merged)).toBeNull();
    expect(unresolvedTemplateKeys(config, merged)).toEqual(["prix"]);
  });

  it("ne signale aucune clé quand tout résout", () => {
    expect(
      unresolvedTemplateKeys(config, { adresse: "12 rue de la Paix", prix: "350 000 €" }),
    ).toEqual([]);
  });

  it("une valeur vide compte comme absente", () => {
    expect(unresolvedTemplateKeys(config, { adresse: "12 rue", prix: "" })).toEqual(["prix"]);
  });

  it("mode inactif", () => {
    expect(
      diagnosePrefilledCaption({ ...config, needsDescription: "manualWrite" }, {}),
    ).toEqual({ reason: "mode_off" });
  });

  it("recette sans modèle de légende", () => {
    expect(
      diagnosePrefilledCaption(
        { needsDescription: "preFilled", descriptionFixedText: null, descriptionSourceFieldKey: null },
        { adresse: "12 rue de la Paix" },
      ),
    ).toEqual({ reason: "no_template" });
  });

  it("modèle qui se résout à du vide alors que ses clés sont pleines", () => {
    expect(
      diagnosePrefilledCaption(
        { needsDescription: "preFilled", descriptionFixedText: "   ", descriptionSourceFieldKey: null },
        {},
      ),
    ).toEqual({ reason: "no_template" });
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

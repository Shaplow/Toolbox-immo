/**
 * Tests du libellé automatique de fiche — fige :
 *  - le rendu d'un modèle `{{clé}}` contre les champs custom
 *  - le NETTOYAGE (séparateurs orphelins), sans lequel le repli ne se
 *    déclencherait jamais : « {{a}}, {{b}} » vide rend « , » — non vide
 *  - le repli daté, en heure de Paris
 *  - l'absence totale de blocage (jamais de throw, jamais de chaîne vide)
 */

import { describe, it, expect } from "vitest";
import {
  MAX_ENTITY_LABEL,
  findUnknownTemplateKeys,
  hasLabelTemplate,
  renderLabelTemplate,
  resolveEntityLabel,
} from "@/lib/entityLabel";
import type { CustomField } from "@/lib/customFields";

const BIEN = { name: "Bien", labelTemplate: "{{adresse}}, {{ville}}" };
// 12:00 UTC — même jour à Paris quel que soit l'offset.
const NOW = new Date("2026-09-09T12:00:00Z");

describe("hasLabelTemplate", () => {
  it("null, undefined et blancs → pas de modèle", () => {
    expect(hasLabelTemplate({ name: "Bien", labelTemplate: null })).toBe(false);
    expect(hasLabelTemplate({ name: "Bien" })).toBe(false);
    expect(hasLabelTemplate({ name: "Bien", labelTemplate: "   " })).toBe(false);
  });

  it("modèle non vide → true", () => {
    expect(hasLabelTemplate(BIEN)).toBe(true);
  });
});

describe("renderLabelTemplate", () => {
  it("rend les champs dans l'ordre du modèle", () => {
    expect(
      renderLabelTemplate(BIEN, { adresse: "12 rue des Lilas", ville: "Lyon" }),
    ).toBe("12 rue des Lilas, Lyon");
  });

  it("accepte les fields en JSON brut (colonne Prisma)", () => {
    expect(renderLabelTemplate(BIEN, '{"adresse":"12 rue des Lilas","ville":"Lyon"}')).toBe(
      "12 rue des Lilas, Lyon",
    );
  });

  it("JSON invalide ou tableau → traité comme vide, jamais de throw", () => {
    expect(renderLabelTemplate(BIEN, "{pas du json")).toBe("");
    expect(renderLabelTemplate(BIEN, "[1,2]")).toBe("");
    expect(renderLabelTemplate(BIEN, null)).toBe("");
  });

  it("sans modèle → chaîne vide", () => {
    expect(renderLabelTemplate({ name: "Bien" }, { adresse: "X" })).toBe("");
  });

  // ── Nettoyage : le cœur du repli ────────────────────────────────────────
  it("tous les champs vides → chaîne vide, PAS « , »", () => {
    expect(renderLabelTemplate(BIEN, {})).toBe("");
    expect(renderLabelTemplate(BIEN, { adresse: "", ville: "" })).toBe("");
  });

  it("second champ vide → pas de virgule en fin", () => {
    expect(renderLabelTemplate(BIEN, { adresse: "12 rue des Lilas" })).toBe("12 rue des Lilas");
  });

  it("premier champ vide → pas de virgule en tête", () => {
    expect(renderLabelTemplate(BIEN, { ville: "Lyon" })).toBe("Lyon");
  });

  it("trou au milieu → séparateurs fusionnés", () => {
    const type = { name: "Bien", labelTemplate: "{{a}}, {{b}}, {{c}}" };
    expect(renderLabelTemplate(type, { a: "A", c: "C" })).toBe("A, C");
  });

  it("valeur multi-ligne (textarea) → aplatie sur une ligne", () => {
    const type = { name: "Bien", labelTemplate: "{{notes}}" };
    expect(renderLabelTemplate(type, { notes: "ligne 1\n\nligne 2" })).toBe("ligne 1 ligne 2");
  });

  it("clé absente du schéma → vide, jamais « undefined »", () => {
    const type = { name: "Bien", labelTemplate: "{{inconnue}}" };
    expect(renderLabelTemplate(type, { adresse: "X" })).toBe("");
  });

  it("modèle constant (aucune variable) → rendu tel quel, pas de repli", () => {
    expect(renderLabelTemplate({ name: "Bien", labelTemplate: "Bien" }, {})).toBe("Bien");
  });

  it("condition {{#if}} honorée", () => {
    const type = {
      name: "Bien",
      labelTemplate: "{{#if type == vente}}Vente{{else}}Location{{/if}} — {{ville}}",
    };
    expect(renderLabelTemplate(type, { type: "vente", ville: "Lyon" })).toBe("Vente — Lyon");
    expect(renderLabelTemplate(type, { type: "loc", ville: "Lyon" })).toBe("Location — Lyon");
  });

  it("token système daté résolu — forme `{{maintenant:preset}}`", () => {
    const type = { name: "Bien", labelTemplate: "Lot {{maintenant:month_year}}" };
    const out = renderLabelTemplate(type, {}, { now: NOW });
    expect(out).toContain("2026");
    expect(out).not.toContain("{{");
  });

  it("`{{maintenant}}` NU est une variable, donc vidé — comportement du moteur", () => {
    // Documenté volontairement : le `:` est ce qui fait survivre le token à
    // resolveTextTemplate. Sans lui, la clé est consommée comme un champ.
    const type = { name: "Bien", labelTemplate: "Lot {{maintenant}}" };
    expect(renderLabelTemplate(type, {}, { now: NOW })).toBe("Lot");
  });

  it("rendu très long → tronqué, suffixé, jamais de throw", () => {
    const type = { name: "Bien", labelTemplate: "{{notes}}" };
    const out = renderLabelTemplate(type, { notes: "x".repeat(5000) });
    expect(out.length).toBeLessThanOrEqual(MAX_ENTITY_LABEL);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("resolveEntityLabel — repli", () => {
  it("champs vides → « <Type> du <date> »", () => {
    expect(resolveEntityLabel(BIEN, {}, { now: NOW })).toBe("Bien du 09/09/2026");
  });

  it("sans modèle du tout → repli aussi (l'appelant décide de s'en servir)", () => {
    expect(resolveEntityLabel({ name: "Tournage" }, {}, { now: NOW })).toBe("Tournage du 09/09/2026");
  });

  it("rendu non vide → le modèle gagne", () => {
    expect(resolveEntityLabel(BIEN, { adresse: "12 rue des Lilas", ville: "Lyon" }, { now: NOW })).toBe(
      "12 rue des Lilas, Lyon",
    );
  });

  it("frontière de minuit : la date est celle de Paris, pas d'UTC", () => {
    // 22h30 UTC le 9 = 00h30 le 10 à Paris (CEST, +2).
    const nuit = new Date("2026-09-09T22:30:00Z");
    expect(resolveEntityLabel(BIEN, {}, { now: nuit })).toBe("Bien du 10/09/2026");
  });

  it("ne retourne jamais une chaîne vide", () => {
    for (const fields of [{}, null, undefined, "", "{}", "[]"] as const) {
      expect(resolveEntityLabel(BIEN, fields, { now: NOW }).length).toBeGreaterThan(0);
    }
  });
});

describe("findUnknownTemplateKeys", () => {
  const schema: CustomField[] = [
    { key: "adresse", label: "Adresse", type: "text" },
    { key: "ville", label: "Ville", type: "text" },
  ];

  it("toutes les clés connues → aucune", () => {
    expect(findUnknownTemplateKeys("{{adresse}}, {{ville}}", schema)).toEqual([]);
  });

  it("clé absente du schéma → signalée", () => {
    expect(findUnknownTemplateKeys("{{adresse}} {{prix}}", schema)).toEqual(["prix"]);
  });

  it("dédupliquée", () => {
    expect(findUnknownTemplateKeys("{{prix}} {{prix}}", schema)).toEqual(["prix"]);
  });

  it("modèle vide → aucune", () => {
    expect(findUnknownTemplateKeys("", schema)).toEqual([]);
    expect(findUnknownTemplateKeys(null, schema)).toEqual([]);
  });

  it("`{{maintenant:preset}}` n'est pas une variable, donc jamais signalé", () => {
    expect(findUnknownTemplateKeys("Lot {{maintenant:month_year}}", schema)).toEqual([]);
  });
});

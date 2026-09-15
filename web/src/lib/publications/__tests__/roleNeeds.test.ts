/**
 * Les rôles dont une recette a réellement besoin.
 *
 * Le bug d'origine : l'inbox admin comptait « Sans vidéaste » toute publication
 * au statut `PLANNED` sans vidéaste. Or une recette auto naît `PLANNED` et n'a
 * personne à envoyer filmer — l'alerte était fausse par construction, sur toute
 * la production automatique.
 */
import { describe, it, expect } from "vitest";
import { needsMonteur, needsVideaste } from "@/lib/publications/roleNeeds";

describe("needsVideaste", () => {
  it("seule une recette à rushs suppose quelqu'un qui filme", () => {
    expect(needsVideaste({ source: "manual_rushes" })).toBe(true);
    expect(needsVideaste({ source: "auto_template" })).toBe(false);
    expect(needsVideaste({ source: "external_upload" })).toBe(false);
  });

  it("une recette absente ou sans source ne réclame personne", () => {
    expect(needsVideaste(null)).toBe(false);
    expect(needsVideaste(undefined)).toBe(false);
    expect(needsVideaste({})).toBe(false);
  });

  it("ni le brief ni la cover monteur ne font apparaître un besoin de vidéaste", () => {
    // Ce sont des travaux de montage : personne ne se déplace pour autant.
    expect(needsVideaste({ source: "auto_template", needsBrief: true })).toBe(false);
    expect(needsVideaste({ source: "auto_template", coverMode: "monteurUpload" })).toBe(false);
  });
});

describe("needsMonteur", () => {
  it("les rushs impliquent un montage", () => {
    expect(needsMonteur({ source: "manual_rushes" })).toBe(true);
  });

  it("une recette auto ordinaire n'a pas de monteur", () => {
    expect(needsMonteur({ source: "auto_template", needsBrief: false, coverMode: "none" })).toBe(
      false,
    );
    expect(needsMonteur({ source: "external_upload" })).toBe(false);
  });

  /**
   * Les deux échappatoires, et elles ne sont pas théoriques : `steps.ts` donne
   * l'étape « Cover (monteur) » au MONTEUR dès `coverMode === "monteurUpload"`,
   * et rend l'étape Montage visible dès qu'il y a un brief. Masquer le champ
   * dans ces deux cas laisserait une étape sans personne pour la faire.
   */
  it("un brief ou une cover à uploader ramènent le monteur, même sur une recette auto", () => {
    expect(needsMonteur({ source: "auto_template", needsBrief: true })).toBe(true);
    expect(needsMonteur({ source: "auto_template", coverMode: "monteurUpload" })).toBe(true);
  });

  it("une cover automatique ne réclame pas de monteur", () => {
    expect(needsMonteur({ source: "auto_template", coverMode: "auto" })).toBe(false);
  });

  it("une recette absente ne réclame personne", () => {
    expect(needsMonteur(null)).toBe(false);
  });
});

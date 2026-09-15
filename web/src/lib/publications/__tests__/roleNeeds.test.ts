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

  it("la cover monteur ne fait pas apparaître un besoin de vidéaste", () => {
    // C'est du travail de montage : personne ne se déplace pour autant.
    expect(needsVideaste({ source: "auto_template", coverMode: "monteurUpload" })).toBe(false);
  });
});

describe("needsMonteur", () => {
  it("les rushs impliquent un montage", () => {
    expect(needsMonteur({ source: "manual_rushes" })).toBe(true);
  });

  it("une recette auto ordinaire n'a pas de monteur", () => {
    expect(needsMonteur({ source: "auto_template", coverMode: "none" })).toBe(false);
    expect(needsMonteur({ source: "external_upload" })).toBe(false);
  });

  /**
   * L'échappatoire, et elle n'est pas théorique : `steps.ts` donne l'étape
   * « Cover (monteur) » au MONTEUR dès `coverMode === "monteurUpload"`. Masquer
   * le champ laisserait une étape sans personne pour la faire.
   *
   * (`needsBrief` couvrait un second cas ; il est parti avec le drapeau de
   * recette — le brief ne dit plus qui monte.)
   */
  it("une cover à uploader ramène le monteur, même sur une recette auto", () => {
    expect(needsMonteur({ source: "auto_template", coverMode: "monteurUpload" })).toBe(true);
  });

  it("une cover automatique ne réclame pas de monteur", () => {
    expect(needsMonteur({ source: "auto_template", coverMode: "auto" })).toBe(false);
  });

  it("une recette absente ne réclame personne", () => {
    expect(needsMonteur(null)).toBe(false);
  });
});

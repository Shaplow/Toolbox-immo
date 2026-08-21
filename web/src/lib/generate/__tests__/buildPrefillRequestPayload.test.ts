/**
 * B.1 (P6 fix) — ne transmettre au POST prefill que les clés tracées en
 * provenance, pour ne pas geler "manual" des valeurs jamais éditées
 * (defaults, valeurs déjà seedées sans provenance suivie côté client) au
 * changement de compte.
 */
import { describe, it, expect } from "vitest";
import { buildTrackedInitialValues } from "@/lib/generate/buildPrefillRequestPayload";
import type { ProvenanceMap } from "@/lib/generate/provenance";

describe("buildTrackedInitialValues", () => {
  it("garde uniquement les clés présentes dans provenance", () => {
    const values = { prix: "350000", surface: "80", untouchedDefault: "42" };
    const provenance: ProvenanceMap = { prix: "entity", surface: "manual" };
    expect(buildTrackedInitialValues(values, provenance)).toEqual({
      prix: "350000",
      surface: "80",
    });
  });

  it("retire une valeur de default jamais éditée (aucune provenance connue)", () => {
    const values = { champ_avec_default: "valeur_par_defaut" };
    const provenance: ProvenanceMap = {};
    expect(buildTrackedInitialValues(values, provenance)).toEqual({});
  });

  it("garde une clé manual même si sa valeur a été vidée entre-temps", () => {
    const values = { commentaire: "" };
    const provenance: ProvenanceMap = { commentaire: "manual" };
    // La clé reste transmise (avec sa valeur vide) — le filtrage porte sur la
    // provenance, pas sur le contenu : buildSlotPrefill gère déjà isEmptyValue.
    expect(buildTrackedInitialValues(values, provenance)).toEqual({ commentaire: "" });
  });

  it("renvoie un objet vide quand rien n'est tracé", () => {
    expect(buildTrackedInitialValues({ a: "1", b: "2" }, {})).toEqual({});
  });

  it("ne renvoie pas de clé de provenance sans valeur correspondante", () => {
    const values = { a: "1" };
    const provenance: ProvenanceMap = { a: "manual", b: "entity" };
    expect(buildTrackedInitialValues(values, provenance)).toEqual({ a: "1" });
  });
});

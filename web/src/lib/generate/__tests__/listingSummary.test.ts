/**
 * « Mes générations » titre chaque génération par le bien (pas par le template)
 * et cherche dans les valeurs saisies — pour qu'un client retrouve une ancienne
 * affiche vitrine et n'en change que le bandeau.
 */
import { describe, it, expect } from "vitest";
import { summarizeListingValues } from "@/lib/generate/listingSummary";

const VITRINE = {
  rue: "12 rue de la Paix",
  arrondissement: "11e",
  prix: "450000",
  surface: "62",
  pieces: "3",
  photo_appartement: "https://pub-abc.r2.dev/uploads/2026/photo.jpg",
  bandeau: "sous-promesse",
  is_copro: true,
  __provenance: { rue: "manual", prix: "manual" },
};

describe("summarizeListingValues", () => {
  it("titre une affiche Vitrine par son adresse, son quartier et son prix", () => {
    const { summary } = summarizeListingValues(JSON.stringify(VITRINE));
    expect(summary).toBe("12 rue de la Paix · 11e · 450 000 €");
  });

  it("cherche dans toutes les valeurs saisies, jamais dans les URL de médias ni la provenance", () => {
    const { searchText } = summarizeListingValues(JSON.stringify(VITRINE));
    expect(searchText).toContain("12 rue de la Paix");
    expect(searchText).toContain("sous-promesse");
    // Le prix se retrouve tapé brut comme formaté.
    expect(searchText).toContain("450000");
    expect(searchText).toContain("450 000 €");
    expect(searchText).not.toContain("r2.dev");
    expect(searchText).not.toContain("manual");
  });

  it("met la référence mandat en tête quand le template la demande", () => {
    const { summary } = summarizeListingValues(
      JSON.stringify({ ...VITRINE, reference_mandat: "M-2041" }),
    );
    expect(summary).toBe("M-2041 · 12 rue de la Paix · 11e");
  });

  it("compare des mots entiers de la clé, pas des sous-chaînes", () => {
    // `nombre_pieces` ne doit pas passer pour un « nom », `subtitle` pour un « title ».
    const { summary } = summarizeListingValues(
      JSON.stringify({ nombre_pieces: "4", subtitle: "Coup de cœur", ville: "Lyon" }),
    );
    expect(summary).toBe("Lyon");
  });

  it("laisse une saisie de prix libre telle quelle", () => {
    const { summary } = summarizeListingValues(JSON.stringify({ prix: "450 000 € FAI" }));
    expect(summary).toBe("450 000 € FAI");
  });

  it("formate un prix numérique", () => {
    const { summary } = summarizeListingValues(JSON.stringify({ price: 1250000 }));
    expect(summary).toBe("1 250 000 €");
  });

  it("garde les longs textes pour la recherche, pas pour le libellé", () => {
    const description = "Superbe appartement traversant, parquet ancien, moulures, vue dégagée sur cour.";
    const { summary, searchText } = summarizeListingValues(
      JSON.stringify({ titre: description, ville: "Paris" }),
    );
    expect(summary).toBe("Paris");
    expect(searchText).toContain("moulures");
  });

  it("se rabat sur les premières valeurs courtes quand aucune clé n'est reconnue", () => {
    const { summary } = summarizeListingValues(
      JSON.stringify({ accroche: "Rare", etage: "3e", ascenseur: "oui" }),
    );
    expect(summary).toBe("Rare · 3e");
  });

  it("renvoie un résumé vide pour un formulaire sans texte", () => {
    expect(
      summarizeListingValues(JSON.stringify({ photo: "/uploads/a.jpg", ok: true, n: null })),
    ).toEqual({ summary: null, searchText: "" });
  });

  it("tolère un JSON invalide ou qui n'est pas un objet", () => {
    expect(summarizeListingValues("{pas du json")).toEqual({ summary: null, searchText: "" });
    expect(summarizeListingValues("[1,2]")).toEqual({ summary: null, searchText: "" });
    expect(summarizeListingValues("null")).toEqual({ summary: null, searchText: "" });
  });
});

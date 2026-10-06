import { describe, expect, it } from "vitest";
import type { ExportLinkSummary, ExportPreview } from "@/lib/clientExport/types";
import {
  DURATION_OPTIONS,
  EMPTY_VOLUME,
  buildCreateRequest,
  computeExportModel,
  defaultSelection,
  describeExpiry,
  describeLinkActivity,
  describeLinkContent,
  describeLinkCreation,
  describeLinkValidity,
  describeMissingFiles,
  describeUnavailablePublications,
  exportLinkUrl,
  formatCommon,
  formatVolume,
  linkActions,
  linkTitle,
  parseDuration,
  pluralFr,
  setAccounts,
  setContent,
  setLibraries,
  type ExportDrawerSelection,
} from "../clientExportModel";

const MO = 1024 ** 2;
const GO = 1024 ** 3;

/** L'espace fine insécable de Intl fr-FR n'a pas à polluer les attendus. */
const norm = (text: string) => text.replace(/[  ]/g, " ");

/**
 * Trois comptes ; une bibliothèque vidéo vide (v2), une réservée au seul compte
 * a3 (v3), une bibliothèque son avec des communs, une bibliothèque de données.
 */
function makePreview(overrides: Partial<ExportPreview> = {}): ExportPreview {
  return {
    accounts: [
      { id: "a1", name: "Sarah", handle: "sarah_immo" },
      { id: "a2", name: "Marc", handle: "marc_immo" },
      { id: "a3", name: "Léa", handle: "lea_immo" },
    ],
    libraries: [
      {
        id: "v1",
        name: "Behind the scene",
        type: "video",
        perAccount: { a1: { files: 100, bytes: 100 * GO }, a2: { files: 28, bytes: 60 * GO } },
        common: null,
      },
      { id: "v2", name: "Rushs vides", type: "video", perAccount: {}, common: null },
      {
        id: "v3",
        name: "Visites",
        type: "video",
        perAccount: { a3: { files: 10, bytes: 5 * GO } },
        common: null,
      },
      {
        id: "s1",
        name: "Musiques",
        type: "audio",
        perAccount: { a1: { files: 2, bytes: 10 * MO } },
        common: { files: 40, bytes: 300 * MO },
      },
      {
        id: "d1",
        name: "Biens",
        type: "data",
        perAccount: { a1: { files: 120, bytes: 0 }, a2: { files: 90, bytes: 0 } },
        common: { files: 5, bytes: 0 },
      },
    ],
    publications: {
      perAccount: { a1: { files: 7, bytes: 3 * GO } },
      unavailable: { a1: 2, a2: 1 },
    },
    missingFiles: 0,
    ...overrides,
  };
}

function compute(preview: ExportPreview, selection: ExportDrawerSelection) {
  return computeExportModel(preview, selection);
}

const row = (model: ReturnType<typeof compute>, key: string) => {
  const found = model.rows.find((r) => r.key === key);
  if (!found) throw new Error(`ligne ${key} introuvable`);
  return found;
};

describe("computeExportModel — sélection par défaut", () => {
  const preview = makePreview();
  const model = compute(preview, defaultSelection(preview));

  it("somme les volumes par type, communs une seule fois", () => {
    expect(row(model, "video").volume).toEqual({ files: 138, bytes: 165 * GO, entries: 0 });
    // 2 fichiers réservés à a1 + 40 communs : les 40 ne sont pas multipliés par 3 comptes.
    expect(row(model, "audio").volume).toEqual({ files: 42, bytes: 310 * MO, entries: 0 });
    expect(row(model, "data").volume).toEqual({ files: 0, bytes: 0, entries: 215 });
    expect(row(model, "publications").volume).toEqual({ files: 7, bytes: 3 * GO, entries: 0 });
  });

  it("le total additionne les lignes cochées", () => {
    expect(model.total).toEqual({
      files: 138 + 42 + 7,
      bytes: 165 * GO + 310 * MO + 3 * GO,
      entries: 215,
    });
    expect(model.blocker).toBeNull();
  });

  it("coche tout ce qui est disponible, groupes compris", () => {
    expect(model.rows.every((r) => r.available && r.checked)).toBe(true);
    expect(model.groups.map((g) => [g.type, g.state])).toEqual([
      ["video", true],
      ["audio", true],
      ["data", true],
    ]);
  });

  it("masque les bibliothèques vides pour la sélection de comptes", () => {
    const video = model.groups.find((g) => g.type === "video");
    expect(video?.libraries.map((l) => l.id)).toEqual(["v1", "v3"]);
  });

  it("annonce les communs d'une bibliothèque son ou données", () => {
    const audio = model.groups.find((g) => g.type === "audio")?.libraries[0];
    expect(audio).toMatchObject({ id: "s1", common: 40, volume: { files: 42 } });
    const data = model.groups.find((g) => g.type === "data")?.libraries[0];
    expect(data).toMatchObject({ id: "d1", common: 5, volume: { entries: 215 } });
    const video = model.groups.find((g) => g.type === "video")?.libraries[0];
    expect(video?.common).toBe(0);
  });

  it("compte, par ligne publications, les non exportables des comptes cochés", () => {
    expect(row(model, "publications").unavailable).toBe(3);
  });

  it("calcule le volume de chaque compte sans les communs", () => {
    const a1 = model.accounts.find((a) => a.id === "a1");
    expect(a1?.volume).toEqual({
      files: 100 + 2 + 7,
      bytes: 100 * GO + 10 * MO + 3 * GO,
      entries: 120,
    });
    const a3 = model.accounts.find((a) => a.id === "a3");
    expect(a3?.volume).toEqual({ files: 10, bytes: 5 * GO, entries: 0 });
  });

  it("envoie les comptes dans l'ordre de l'aperçu et les bibliothèques visibles seulement", () => {
    expect(model.payload).toEqual({
      accountIds: ["a1", "a2", "a3"],
      // v2 est cochée (par défaut) mais masquée parce que vide : elle ne part pas.
      mediaLibraryIds: ["v1", "v3", "s1"],
      dataLibraryIds: ["d1"],
      includePublications: true,
    });
  });
});

describe("computeExportModel — comptes", () => {
  const preview = makePreview();

  it("décocher un compte retire son volume et masque ce qui devient vide", () => {
    const selection = setAccounts(defaultSelection(preview), ["a3"], false);
    const model = compute(preview, selection);

    expect(row(model, "video").volume.files).toBe(128);
    expect(model.groups.find((g) => g.type === "video")?.libraries.map((l) => l.id)).toEqual(["v1"]);
    expect(model.payload.accountIds).toEqual(["a1", "a2"]);
    expect(model.payload.mediaLibraryIds).toEqual(["v1", "s1"]);
    // Le compte décoché garde son volume affiché : c'est ce qu'il ajouterait s'on le recochait.
    const a3 = model.accounts.find((a) => a.id === "a3");
    expect(a3).toMatchObject({ checked: false, volume: { files: 10 } });
  });

  it("recocher un compte rend ses bibliothèques, restées cochées", () => {
    const off = setAccounts(defaultSelection(preview), ["a3"], false);
    const back = compute(preview, setAccounts(off, ["a3"], true));
    expect(back.payload.mediaLibraryIds).toEqual(["v1", "v3", "s1"]);
  });

  it("éteint un contenu qui n'a plus rien à exporter, sans oublier l'intention", () => {
    // Seul a2 reste : il n'a aucune publication exportable.
    const onlyA2 = setAccounts(defaultSelection(preview), ["a1", "a3"], false);
    const model = compute(preview, onlyA2);
    const publications = row(model, "publications");
    expect(publications).toMatchObject({ available: false, checked: false, unavailable: 1 });
    expect(model.payload.includePublications).toBe(false);

    // On recoche a1 : la ligne se rallume d'elle-même.
    const back = compute(preview, setAccounts(onlyA2, ["a1"], true));
    expect(row(back, "publications")).toMatchObject({ available: true, checked: true });
    expect(back.payload.includePublications).toBe(true);
  });

  it("sans compte, seuls les communs restent disponibles et la création est bloquée", () => {
    const none = setAccounts(defaultSelection(preview), ["a1", "a2", "a3"], false);
    const model = compute(preview, none);
    expect(model.blocker).toBe("no_account");
    expect(row(model, "video").available).toBe(false);
    expect(row(model, "audio")).toMatchObject({ available: true, volume: { files: 40 } });
    expect(buildCreateRequest(model, 7, "")).toBeNull();
  });

  it("sans compte coché, chaque compte garde le volume qu'il apporterait en le recochant", () => {
    const none = setAccounts(defaultSelection(preview), ["a1", "a2", "a3"], false);
    const model = compute(preview, none);
    // La ligne « Vidéos » est éteinte (rien pour zéro compte), mais Sarah n'en
    // devient pas « vide » pour autant : 100 vidéos, 2 sons, 120 fiches, 7 publications.
    expect(model.accounts.find((a) => a.id === "a1")?.volume).toEqual({
      files: 100 + 2 + 7,
      bytes: 100 * GO + 10 * MO + 3 * GO,
      entries: 120,
    });
  });
});

describe("computeExportModel — contenus et bibliothèques", () => {
  const preview = makePreview();

  it("un contenu décoché sort du total, des groupes et du corps de la requête", () => {
    const selection = setContent(defaultSelection(preview), "audio", false);
    const model = compute(preview, selection);

    expect(row(model, "audio")).toMatchObject({ checked: false, available: true });
    expect(model.groups.map((g) => g.type)).toEqual(["video", "data"]);
    expect(model.payload.mediaLibraryIds).toEqual(["v1", "v3"]);
    expect(model.total.files).toBe(138 + 7);
    const a1 = model.accounts.find((a) => a.id === "a1");
    expect(a1?.volume.files).toBe(100 + 7);
  });

  it("une bibliothèque décochée passe le groupe en « indeterminate »", () => {
    const selection = setLibraries(defaultSelection(preview), ["v1"], false);
    const model = compute(preview, selection);
    const video = model.groups.find((g) => g.type === "video");

    expect(video?.state).toBe("indeterminate");
    expect(video?.libraries.map((l) => [l.id, l.checked])).toEqual([
      ["v1", false],
      ["v3", true],
    ]);
    expect(row(model, "video").volume.files).toBe(10);
    expect(model.payload.mediaLibraryIds).toEqual(["v3", "s1"]);
  });

  it("décocher toutes les bibliothèques d'un type laisse la ligne cochée mais vide", () => {
    const selection = setLibraries(defaultSelection(preview), ["v1", "v3"], false);
    const model = compute(preview, selection);

    expect(model.groups.find((g) => g.type === "video")?.state).toBe(false);
    // La ligne reste allumée : l'éteindre ferait disparaître le groupe, et avec lui
    // le moyen de recocher les bibliothèques.
    expect(row(model, "video")).toMatchObject({ checked: true, available: true });
    expect(isEmpty(row(model, "video").volume)).toBe(true);
    expect(model.blocker).toBeNull();
  });

  it("bloque la création quand plus rien n'est coché", () => {
    let selection = defaultSelection(preview);
    selection = setLibraries(selection, ["v1", "v3", "s1", "d1"], false);
    selection = setContent(selection, "publications", false);
    expect(compute(preview, selection).blocker).toBe("no_content");
  });

  it("signale un client sans rien à exporter", () => {
    const empty = makePreview({
      libraries: [],
      publications: { perAccount: {}, unavailable: {} },
    });
    const model = compute(empty, defaultSelection(empty));
    expect(model.blocker).toBe("nothing_available");
    expect(model.rows.every((r) => !r.available && !r.checked)).toBe(true);
  });

  it("ne fait pas d'une bibliothèque de données un volume en fichiers", () => {
    const model = compute(preview, defaultSelection(preview));
    const data = model.rows.find((r) => r.key === "data");
    expect(data?.volume.files).toBe(0);
    expect(data?.volume.entries).toBe(215);
  });
});

function isEmpty(volume: { files: number; entries: number }) {
  return volume.files === 0 && volume.entries === 0;
}

describe("buildCreateRequest", () => {
  const preview = makePreview();
  const model = compute(preview, defaultSelection(preview));

  it("assemble le corps attendu par l'API", () => {
    expect(buildCreateRequest(model, 14, "  Fin de contrat  ")).toEqual({
      label: "Fin de contrat",
      expiresInDays: 14,
      accountIds: ["a1", "a2", "a3"],
      mediaLibraryIds: ["v1", "v3", "s1"],
      dataLibraryIds: ["d1"],
      includePublications: true,
    });
  });

  it("envoie un libellé vide comme null", () => {
    expect(buildCreateRequest(model, 7, "   ")?.label).toBeNull();
  });
});

describe("durées et adresse", () => {
  it("propose les cinq durées autorisées, 7 jours compris", () => {
    expect(DURATION_OPTIONS.map((o) => o.label)).toEqual([
      "1 jour",
      "3 jours",
      "7 jours",
      "14 jours",
      "30 jours",
    ]);
    expect(parseDuration("14")).toBe(14);
    expect(parseDuration("n'importe quoi")).toBe(7);
  });

  it("compose l'adresse à partager", () => {
    expect(exportLinkUrl("https://toolboximmo.com", "abc123")).toBe(
      "https://toolboximmo.com/export/abc123",
    );
  });
});

describe("formatage des volumes", () => {
  it("écrit fichiers, taille et fiches, au pluriel français", () => {
    expect(norm(formatVolume({ files: 1243, bytes: 1.5 * GO, entries: 210 }))).toBe(
      "1 243 fichiers · 1,5 Go · 210 fiches",
    );
    expect(formatVolume({ files: 1, bytes: 0, entries: 0 })).toBe("1 fichier");
    expect(formatVolume({ files: 0, bytes: 0, entries: 1 })).toBe("1 fiche");
  });

  it("omet la taille quand aucune n'est connue, et les octets sans fichiers", () => {
    expect(formatVolume({ files: 5, bytes: 0, entries: 0 })).toBe("5 fichiers");
    expect(formatVolume({ files: 0, bytes: 99, entries: 3 })).toBe("3 fiches");
  });

  it("dit « Rien à exporter » pour un volume vide", () => {
    expect(formatVolume(EMPTY_VOLUME)).toBe("Rien à exporter");
  });

  it("accorde « dont M communs » avec les fichiers (sons) ou les fiches (données)", () => {
    expect(formatCommon({ type: "audio", common: 12 })).toBe("dont 12 communs");
    expect(formatCommon({ type: "audio", common: 1 })).toBe("dont 1 commun");
    expect(formatCommon({ type: "data", common: 3 })).toBe("dont 3 communes");
    expect(formatCommon({ type: "data", common: 1 })).toBe("dont 1 commune");
  });

  it("n'annonce rien quand il n'y a pas de communs, ni pour la vidéo", () => {
    expect(formatCommon({ type: "audio", common: 0 })).toBeNull();
    expect(formatCommon({ type: "video", common: 5 })).toBeNull();
  });

  it("garde 0 et 1 au singulier", () => {
    expect(pluralFr(0, "fichier", "fichiers")).toBe("0 fichier");
    expect(pluralFr(1, "fichier", "fichiers")).toBe("1 fichier");
    expect(pluralFr(2, "fichier", "fichiers")).toBe("2 fichiers");
  });

  it("accorde les avertissements", () => {
    expect(describeUnavailablePublications(1)).toBe(
      "1 publication non exportable (image ou vidéo introuvable)",
    );
    expect(describeUnavailablePublications(3)).toBe(
      "3 publications non exportables (image ou vidéo introuvable)",
    );
    expect(describeMissingFiles(1)).toBe("1 fichier introuvable dans le stockage ne sera pas inclus.");
    expect(describeMissingFiles(14)).toBe(
      "14 fichiers introuvables dans le stockage ne seront pas inclus.",
    );
  });
});

// ─── Carte des liens ─────────────────────────────────────────────────────────

const NOW = new Date("2026-10-06T12:00:00.000Z");

function makeLink(overrides: Partial<ExportLinkSummary> = {}): ExportLinkSummary {
  return {
    id: "l1",
    label: null,
    status: "active",
    createdAt: "2026-10-06T10:00:00.000Z",
    expiresAt: "2026-10-13T10:00:00.000Z",
    revokedAt: null,
    createdBy: { id: "u1", name: "Mathis" },
    accountIds: ["a1", "a2", "a3"],
    libraries: { video: 2, audio: 1, data: 1 },
    includePublications: true,
    firstOpenedAt: null,
    lastOpenedAt: null,
    downloadStartedAt: null,
    downloadCompletedAt: null,
    startCount: 0,
    lastReport: null,
    ...overrides,
  };
}

describe("lignes de la carte des liens", () => {
  it("titre : le libellé, sinon « Lien du <date> » (année seulement si ce n'est pas la courante)", () => {
    expect(linkTitle(makeLink({ label: "  Fin de contrat " }), NOW)).toBe("Fin de contrat");
    expect(linkTitle(makeLink(), NOW)).toBe("Lien du 6 oct.");
    expect(linkTitle(makeLink({ createdAt: "2025-12-20T12:00:00.000Z" }), NOW)).toBe(
      "Lien du 20 déc. 2025",
    );
  });

  it("création : date et auteur", () => {
    expect(describeLinkCreation(makeLink())).toBe("Créé le 6 oct. 2026 par Mathis");
    expect(describeLinkCreation(makeLink({ createdBy: null }))).toBe("Créé le 6 oct. 2026");
  });

  it("contenu : comptes, bibliothèques par type, publications", () => {
    expect(describeLinkContent(makeLink())).toBe(
      "3 comptes · 2 biblio. vidéo · 1 son · 1 données · publications",
    );
    expect(
      describeLinkContent(
        makeLink({
          accountIds: ["a1"],
          libraries: { video: 0, audio: 2, data: 0 },
          includePublications: false,
        }),
      ),
    ).toBe("1 compte · 2 sons");
  });

  it("validité : expire, expiré, révoqué", () => {
    expect(describeLinkValidity(makeLink(), NOW)).toBe("Expire le 13 oct.");
    expect(describeLinkValidity(makeLink({ status: "expired" }), NOW)).toBe("Expiré le 13 oct.");
    expect(
      describeLinkValidity(
        makeLink({ status: "revoked", revokedAt: "2026-10-07T09:00:00.000Z" }),
        NOW,
      ),
    ).toBe("Révoqué le 7 oct.");
  });

  it("dit jusqu'à quand le lien créé est valable", () => {
    expect(describeExpiry("2026-10-13T12:32:00.000Z", NOW)).toBe(
      "Valable jusqu'au 13 oct. à 14:32.",
    );
  });

  it("actions : régénérer, prolonger, révoquer selon le statut", () => {
    expect(linkActions("active")).toEqual(["rotate", "extend", "revoke"]);
    expect(linkActions("expired")).toEqual(["extend", "revoke"]);
    expect(linkActions("revoked")).toEqual([]);
  });
});

describe("activité d'un lien", () => {
  const report = { files: 812, bytes: 163 * GO, skipped: 0, failed: 0, missing: 0 };

  it("jamais ouvert, puis ouvert (la dernière ouverture)", () => {
    expect(describeLinkActivity(makeLink(), NOW)).toBe("Jamais ouvert");
    expect(
      describeLinkActivity(
        makeLink({
          firstOpenedAt: "2026-10-07T08:00:00.000Z",
          lastOpenedAt: "2026-10-08T12:32:00.000Z",
        }),
        NOW,
      ),
    ).toBe("Ouvert le 8 oct. à 14:32");
  });

  it("téléchargement lancé, avec le nombre de reprises (le premier lancement n'en est pas une)", () => {
    const started = makeLink({ downloadStartedAt: "2026-10-08T12:32:00.000Z", startCount: 1 });
    expect(describeLinkActivity(started, NOW)).toBe("Téléchargement lancé le 8 oct. à 14:32");
    expect(describeLinkActivity({ ...started, startCount: 2 }, NOW)).toBe(
      "Téléchargement lancé le 8 oct. à 14:32 · 1 reprise",
    );
    expect(describeLinkActivity({ ...started, startCount: 4 }, NOW)).toBe(
      "Téléchargement lancé le 8 oct. à 14:32 · 3 reprises",
    );
  });

  it("terminé, avec fichiers, volume et échecs", () => {
    const done = makeLink({
      downloadStartedAt: "2026-10-08T12:32:00.000Z",
      downloadCompletedAt: "2026-10-08T15:10:00.000Z",
      startCount: 1,
      lastReport: report,
    });
    expect(describeLinkActivity(done, NOW)).toBe("Terminé le 8 oct. à 17:10 · 812 fichiers · 163 Go");
    expect(
      describeLinkActivity({ ...done, lastReport: { ...report, failed: 3 } }, NOW),
    ).toBe("Terminé le 8 oct. à 17:10 · 812 fichiers · 163 Go · 3 en échec");
  });

  it("n'affiche pas un volume faux après une reprise", () => {
    const resumed = makeLink({
      downloadStartedAt: "2026-10-08T12:32:00.000Z",
      downloadCompletedAt: "2026-10-09T09:00:00.000Z",
      startCount: 2,
      // Octets écrits pendant la seule dernière session.
      lastReport: { ...report, bytes: 20 * GO },
    });
    expect(describeLinkActivity(resumed, NOW)).toBe("Terminé le 9 oct. à 11:00 · 812 fichiers");
  });

  it("terminé sans bilan : la date seule", () => {
    const done = makeLink({
      downloadStartedAt: "2026-10-08T12:32:00.000Z",
      downloadCompletedAt: "2026-10-08T15:10:00.000Z",
      startCount: 1,
    });
    expect(describeLinkActivity(done, NOW)).toBe("Terminé le 8 oct. à 17:10");
  });

  it("un téléchargement relancé après un « terminé » repasse en « lancé »", () => {
    const relaunched = makeLink({
      downloadStartedAt: "2026-10-10T12:00:00.000Z",
      downloadCompletedAt: "2026-10-08T15:10:00.000Z",
      startCount: 2,
      lastReport: report,
    });
    expect(describeLinkActivity(relaunched, NOW)).toBe(
      "Téléchargement lancé le 10 oct. à 14:00 · 1 reprise",
    );
  });
});

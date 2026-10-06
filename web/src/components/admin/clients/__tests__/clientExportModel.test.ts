import { describe, expect, it } from "vitest";
import { createExportLinkSchema } from "@/lib/clientExport/schemas";
import type { ExportLinkSummary, ExportPreview, ExportReport } from "@/lib/clientExport/types";
import {
  CONTENT_KEYS,
  CREATE_LINK_LABEL,
  DURATION_OPTIONS,
  EMPTY_VOLUME,
  LINK_ACTION_LABELS,
  ROTATE_HINT,
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
  unavailableNeedsAction,
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
      // Par compte PUIS par motif, comme le serveur : 2 posts image chez a1, une
      // vidéo résolue mais absente du stockage chez a2.
      unavailable: { a1: { image_post: 2 }, a2: { missing: 1 } },
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

  it("compte, par ligne publications, les non exportables des comptes cochés, par motif", () => {
    expect(row(model, "publications").unavailable).toEqual({ image_post: 2, missing: 1 });
    // Les autres lignes n'ont pas de publications non exportables.
    expect(row(model, "video").unavailable).toEqual({});
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
    expect(publications).toMatchObject({
      available: false,
      checked: false,
      unavailable: { missing: 1 },
    });
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

describe("computeExportModel — publications non exportables", () => {
  const preview = makePreview({
    publications: {
      perAccount: { a1: { files: 7, bytes: 3 * GO } },
      unavailable: {
        a1: { image_post: 2, missing: 1 },
        a2: { image_post: 1, no_video: 4 },
        a3: { not_on_r2: 2 },
      },
    },
    // Médias de la médiathèque : un compte à part, qui n'entre jamais dans les publications.
    missingFiles: 5,
  });

  it("somme par motif, sur les comptes cochés seulement", () => {
    const all = compute(preview, defaultSelection(preview));
    expect(row(all, "publications").unavailable).toEqual({
      image_post: 3,
      no_video: 4,
      not_on_r2: 2,
      missing: 1,
    });

    const withoutA2 = compute(preview, setAccounts(defaultSelection(preview), ["a2"], false));
    expect(row(withoutA2, "publications").unavailable).toEqual({
      image_post: 2,
      not_on_r2: 2,
      missing: 1,
    });

    const none = compute(preview, setAccounts(defaultSelection(preview), ["a1", "a2", "a3"], false));
    expect(row(none, "publications").unavailable).toEqual({});
  });

  it("n'y mêle pas les médias introuvables : l'alerte a son propre compteur", () => {
    // Un fichier introuvable n'est plus compté deux fois : `missingFiles` ne
    // porte que les médias, `unavailable` que les publications.
    const model = compute(preview, defaultSelection(preview));
    expect(row(model, "publications").unavailable.missing).toBe(1);
    expect(preview.missingFiles).toBe(5);
  });

  it("ne confond pas un post image (normal) avec ce qui demande une action", () => {
    expect(unavailableNeedsAction({ image_post: 3 })).toBe(false);
    expect(unavailableNeedsAction({})).toBe(false);
    expect(unavailableNeedsAction({ image_post: 3, missing: 1 })).toBe(true);
    expect(unavailableNeedsAction({ no_video: 1 })).toBe(true);
    expect(unavailableNeedsAction({ not_on_r2: 1 })).toBe(true);
    // Un compteur à zéro n'est pas un défaut.
    expect(unavailableNeedsAction({ image_post: 2, missing: 0 })).toBe(false);
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

// ─── Contrat avec la route de création ───────────────────────────────────────
//
// Le corps que le tiroir envoie doit passer le schéma que la route applique
// (`.strict()`) : un champ ajouté côté UI sans mise à jour du schéma ferait
// échouer chaque création avec « Unrecognized key(s) in object » dans un toast.
// Ce contrat n'était couvert que par l'e2e, dont la suite dérive.

/** null = accepté ; sinon les problèmes que la route renverrait. */
function schemaIssues(body: unknown): string[] | null {
  const parsed = createExportLinkSchema.safeParse(body);
  return parsed.success
    ? null
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(corps)"} : ${issue.message}`);
}

/** Toutes les parties d'une liste (2^n), pour parcourir chaque sélection possible. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((all, item) => [...all, ...all.map((subset) => [...subset, item])], [[]]);
}

describe("buildCreateRequest ↔ createExportLinkSchema", () => {
  const preview = makePreview();
  const allAccountIds = preview.accounts.map((account) => account.id);

  it("le corps de la sélection par défaut passe le schéma de la route", () => {
    const model = compute(preview, defaultSelection(preview));
    const request = buildCreateRequest(model, 7, "");
    expect(request).not.toBeNull();
    expect(schemaIssues(request)).toBeNull();
  });

  it("chaque durée proposée, et un libellé saisi, passent le schéma", () => {
    const model = compute(preview, defaultSelection(preview));
    for (const option of DURATION_OPTIONS) {
      const request = buildCreateRequest(model, parseDuration(option.value), "  Fin de contrat ");
      expect(schemaIssues(request), `durée ${option.value}`).toBeNull();
    }
  });

  it("une sélection vide est refusée par le schéma, comme par le tiroir", () => {
    // Aucun compte : le tiroir ne construit pas de requête, et le schéma refuserait celle-ci.
    const noAccount = compute(preview, setAccounts(defaultSelection(preview), allAccountIds, false));
    expect(buildCreateRequest(noAccount, 7, "")).toBeNull();
    const noAccountIssues = schemaIssues({ label: null, expiresInDays: 7, ...noAccount.payload });
    expect(noAccountIssues?.some((issue) => issue.startsWith("accountIds"))).toBe(true);

    // Des comptes, mais plus aucun contenu.
    let selection = setLibraries(defaultSelection(preview), ["v1", "v3", "s1", "d1"], false);
    selection = setContent(selection, "publications", false);
    const noContent = compute(preview, selection);
    expect(noContent.payload.accountIds.length).toBeGreaterThan(0);
    expect(buildCreateRequest(noContent, 7, "")).toBeNull();
    expect(schemaIssues({ label: null, expiresInDays: 7, ...noContent.payload })).not.toBeNull();
  });

  it("« Créer le lien » est actif exactement quand la route accepterait le corps", () => {
    const libraryIds = preview.libraries.map((library) => library.id);
    const mismatches: string[] = [];
    let accepted = 0;
    let refused = 0;

    // 8 parties de comptes × 32 de bibliothèques × 16 de contenus : toutes les sélections possibles.
    for (const accounts of subsets(allAccountIds)) {
      for (const libraries of subsets(libraryIds)) {
        for (const contents of subsets(CONTENT_KEYS)) {
          const selection: ExportDrawerSelection = {
            contents: {
              video: contents.includes("video"),
              audio: contents.includes("audio"),
              data: contents.includes("data"),
              publications: contents.includes("publications"),
            },
            accountIds: new Set(accounts),
            libraryIds: new Set(libraries),
          };
          const model = compute(preview, selection);
          const enabled = buildCreateRequest(model, 7, "") !== null;
          const issues = schemaIssues({ label: null, expiresInDays: 7, ...model.payload });
          if (issues === null) accepted += 1;
          else refused += 1;
          if (enabled !== (issues === null)) {
            mismatches.push(
              `${JSON.stringify({ accounts, libraries, contents })} : bouton ${enabled ? "actif" : "bloqué"}, route ${issues === null ? "accepte" : `refuse (${issues.join(", ")})`}`,
            );
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
    // Le parcours n'est pas vide de sens : il couvre des sélections des deux sortes.
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
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

  it("dit les publications non exportables par motif, au pluriel français", () => {
    expect(describeUnavailablePublications({ image_post: 2, missing: 1 })).toBe(
      "2 posts image (non inclus) · 1 vidéo introuvable dans le stockage",
    );
    expect(describeUnavailablePublications({ image_post: 1 })).toBe("1 post image (non inclus)");
    expect(describeUnavailablePublications({ missing: 2 })).toBe(
      "2 vidéos introuvables dans le stockage",
    );
    expect(describeUnavailablePublications({ no_video: 1, not_on_r2: 1 })).toBe(
      "1 publication sans vidéo finale · 1 vidéo hébergée hors du stockage",
    );
    expect(describeUnavailablePublications({ no_video: 3, not_on_r2: 2 })).toBe(
      "3 publications sans vidéo finale · 2 vidéos hébergées hors du stockage",
    );
  });

  it("garde un ordre stable : le post image d'abord, les défauts ensuite", () => {
    expect(
      describeUnavailablePublications({ missing: 1, not_on_r2: 1, no_video: 1, image_post: 1 }),
    ).toBe(
      "1 post image (non inclus) · 1 publication sans vidéo finale · 1 vidéo hébergée hors du stockage · 1 vidéo introuvable dans le stockage",
    );
  });

  it("n'écrit rien quand il n'y a aucune publication non exportable", () => {
    expect(describeUnavailablePublications({})).toBeNull();
    expect(describeUnavailablePublications({ image_post: 0, missing: 0 })).toBeNull();
  });

  it("accorde l'alerte des fichiers de la médiathèque introuvables", () => {
    expect(describeMissingFiles(1)).toBe(
      "1 fichier de la médiathèque introuvable dans le stockage ne sera pas inclus.",
    );
    expect(describeMissingFiles(14)).toBe(
      "14 fichiers de la médiathèque introuvables dans le stockage ne seront pas inclus.",
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

  it("contenu : comptes, bibliothèques par type (jamais lues comme des fichiers), publications", () => {
    expect(describeLinkContent(makeLink())).toBe(
      "3 comptes · 2 biblio. vidéo · 1 biblio. son · 1 biblio. données · publications",
    );
    // « biblio. » ne prend pas de s : c'est une abréviation.
    expect(
      describeLinkContent(
        makeLink({
          accountIds: ["a1"],
          libraries: { video: 0, audio: 2, data: 3 },
          includePublications: false,
        }),
      ),
    ).toBe("1 compte · 2 biblio. son · 3 biblio. données");
    expect(
      describeLinkContent(
        makeLink({
          accountIds: ["a1", "a2"],
          libraries: { video: 1, audio: 0, data: 0 },
          includePublications: true,
        }),
      ),
    ).toBe("2 comptes · 1 biblio. vidéo · publications");
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

  it("deux actions de la carte ne portent jamais le même libellé", () => {
    // « Nouveau lien » nommait à la fois le bouton d'en-tête (créer un AUTRE lien) et
    // l'item de ligne (régénérer l'adresse, qui coupe l'ancienne) : un admin qui
    // avait perdu une adresse créait un second lien, le premier restant actif.
    const labels = [CREATE_LINK_LABEL, ...Object.values(LINK_ACTION_LABELS)];
    expect(new Set(labels.map((label) => label.toLowerCase())).size).toBe(labels.length);
    expect(LINK_ACTION_LABELS.rotate).toBe("Régénérer l'adresse");
  });

  it("garde les poignées que l'e2e vise", () => {
    expect(LINK_ACTION_LABELS.extend).toBe("Prolonger de 7 jours");
    expect(LINK_ACTION_LABELS.revoke).toBe("Révoquer");
  });

  it("les aides renvoient à l'item de menu réel, pas à « Nouveau lien »", () => {
    expect(ROTATE_HINT).toBe("« Régénérer l'adresse » dans le menu ⋯ du lien");
    expect(ROTATE_HINT).toContain(LINK_ACTION_LABELS.rotate);
    expect(ROTATE_HINT).not.toContain(CREATE_LINK_LABEL);
  });
});

describe("activité d'un lien", () => {
  // Paris est à UTC+2 : 14:32 et 17:10 le 8 oct., 14:00 et 14:20 le 10 oct.
  const T0 = "2026-10-08T12:32:00.000Z";
  const T1 = "2026-10-08T15:10:00.000Z";
  const T2 = "2026-10-10T12:00:00.000Z";
  const T3 = "2026-10-10T12:20:00.000Z";

  const everything: ExportReport = { files: 812, bytes: 163 * GO, skipped: 0, failed: 0, missing: 0 };
  const nothing: ExportReport = { files: 0, bytes: 0, skipped: 0, failed: 0, missing: 0 };

  type PageEvent =
    | { type: "started"; at: string }
    | { type: "completed" | "stopped"; at: string; report: ExportReport };

  const started = (at: string): PageEvent => ({ type: "started", at });
  const completed = (at: string, report: Partial<ExportReport> = {}): PageEvent => ({
    type: "completed",
    at,
    report: { ...everything, ...report },
  });
  const stopped = (at: string, report: Partial<ExportReport>): PageEvent => ({
    type: "stopped",
    at,
    report: { ...nothing, ...report },
  });

  /**
   * Rejoue des événements de la page publique comme `recordExportEvent` les écrit
   * (contrat d'`ExportLinkSummary`) : un lancement pose `downloadStartedAt` (le
   * DERNIER) et remet le bilan à null ; seule une fin SANS échec pose
   * `downloadCompletedAt` ; tout bilan remplace le précédent. Les tests ne
   * décrivent ainsi que des états que le serveur produit réellement.
   */
  function replay(events: PageEvent[]): ExportLinkSummary {
    return events.reduce<ExportLinkSummary>((link, event) => {
      if (event.type === "started") {
        return {
          ...link,
          startCount: link.startCount + 1,
          downloadStartedAt: event.at,
          lastReport: null,
        };
      }
      return {
        ...link,
        lastReport: event.report,
        downloadCompletedAt:
          event.type === "completed" && event.report.failed === 0
            ? event.at
            : link.downloadCompletedAt,
      };
    }, makeLink());
  }

  const activity = (events: PageEvent[]) => describeLinkActivity(replay(events), NOW);

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

  it("lancé sans bilan (en cours, ou onglet fermé) : le nombre de reprises, le premier lancement n'en est pas une", () => {
    expect(activity([started(T0)])).toBe("Téléchargement lancé le 8 oct. à 14:32");
    // Le lancement remet le bilan de la session précédente à null : « lancé », pas « incomplet ».
    expect(activity([started(T0), stopped(T1, { files: 40 }), started(T2)])).toBe(
      "Téléchargement lancé le 10 oct. à 14:00 · 1 reprise",
    );
    // `downloadStartedAt` est le DERNIER lancement.
    expect(activity([started(T0), started(T1), started(T2), started(T3)])).toBe(
      "Téléchargement lancé le 10 oct. à 14:20 · 3 reprises",
    );
  });

  it("terminé sans échec : la fin, les fichiers et le volume (une seule session)", () => {
    expect(activity([started(T0), completed(T1)])).toBe(
      "Terminé le 8 oct. à 17:10 · 812 fichiers · 163 Go",
    );
  });

  it("terminé sans volume quand le bilan ne compte qu'une part du livré", () => {
    // Reprise : les octets du bilan sont ceux de la dernière session seulement.
    expect(
      activity([
        started(T0),
        stopped(T1, { files: 40, bytes: 8 * GO }),
        started(T2),
        completed(T3, { skipped: 40, bytes: 155 * GO }),
      ]),
    ).toBe("Terminé le 10 oct. à 14:20 · 812 fichiers");

    // Premier lancement dans un dossier déjà garni (autre lien, mêmes fichiers) : des fichiers sautés.
    expect(activity([started(T0), completed(T1, { skipped: 5, bytes: 2 * GO })])).toBe(
      "Terminé le 8 oct. à 17:10 · 812 fichiers",
    );

    // Rien écrit : aucun octet à annoncer.
    expect(activity([started(T0), completed(T1, { skipped: 812, bytes: 0 })])).toBe(
      "Terminé le 8 oct. à 17:10 · 812 fichiers",
    );
  });

  it("terminé avec des échecs : incomplet, jamais « lancé » ni « terminé »", () => {
    const line = activity([started(T0), completed(T1, { files: 809, failed: 3 })]);
    expect(line).toBe("Téléchargement incomplet · 809 fichiers · 3 en échec · lancé le 8 oct. à 14:32");
    expect(line).not.toContain("Terminé");
  });

  it("arrêté : incomplet, avec ce qui est déjà chez le client", () => {
    expect(activity([started(T0), stopped(T1, { files: 40, bytes: 8 * GO })])).toBe(
      "Téléchargement incomplet · 40 fichiers · lancé le 8 oct. à 14:32",
    );
    expect(activity([started(T0), stopped(T1, { files: 40, failed: 2 })])).toBe(
      "Téléchargement incomplet · 40 fichiers · 2 en échec · lancé le 8 oct. à 14:32",
    );
    expect(activity([started(T0), stopped(T1, { files: 0 })])).toBe(
      "Téléchargement incomplet · 0 fichier · lancé le 8 oct. à 14:32",
    );
  });

  it("relancé après un terminé : « lancé », le bilan terminé n'est plus celui de la session courante", () => {
    expect(activity([started(T0), completed(T1), started(T2)])).toBe(
      "Téléchargement lancé le 10 oct. à 14:00 · 1 reprise",
    );
  });

  it("relancé après un terminé puis arrêté : le bilan arrêté ne se lit pas sous « Terminé »", () => {
    const line = activity([
      started(T0),
      completed(T1),
      started(T2),
      stopped(T3, { files: 3, bytes: GO }),
    ]);
    expect(line).toBe("Téléchargement incomplet · 3 fichiers · lancé le 10 oct. à 14:00");
    expect(line).not.toContain("Terminé");
    expect(line).not.toContain("812");
  });

  it("échecs réessayés jusqu'au bout : terminé, sans volume (reprise)", () => {
    expect(
      activity([
        started(T0),
        completed(T1, { files: 809, failed: 3 }),
        started(T2),
        completed(T3, { skipped: 809, bytes: 2 * GO }),
      ]),
    ).toBe("Terminé le 10 oct. à 14:20 · 812 fichiers");
  });

  it("lancement jamais enregistré (la page n'a pas pu l'envoyer) : le bilan suffit", () => {
    expect(activity([completed(T1)])).toBe("Terminé le 8 oct. à 17:10 · 812 fichiers · 163 Go");
    // Sans lancement connu, aucune date de lancement à donner.
    expect(activity([stopped(T1, { files: 40 })])).toBe("Téléchargement incomplet · 40 fichiers");
  });

  it("fin et lancement au même instant : terminé", () => {
    const sameInstant = makeLink({
      downloadStartedAt: T1,
      downloadCompletedAt: T1,
      startCount: 1,
      lastReport: everything,
    });
    expect(describeLinkActivity(sameInstant, NOW)).toBe(
      "Terminé le 8 oct. à 17:10 · 812 fichiers · 163 Go",
    );
  });

  it("terminé dont le bilan stocké est illisible : la date seule", () => {
    // `parseReport` rend null quand le JSON de `lastReport` n'est pas un objet.
    const unreadable = makeLink({
      downloadStartedAt: T0,
      downloadCompletedAt: T1,
      startCount: 1,
    });
    expect(describeLinkActivity(unreadable, NOW)).toBe("Terminé le 8 oct. à 17:10");
  });
});

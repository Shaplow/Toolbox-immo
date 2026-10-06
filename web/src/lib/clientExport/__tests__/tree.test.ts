import { describe, expect, it } from "vitest";
import { dataRef, mediaRef, publicationRef } from "../ids";
import { nameKey, sanitizeFsaSegment } from "../naming";
import {
  COMMON_FOLDER,
  MAX_FOLDER_SEGMENT,
  MAX_RELATIVE_PATH,
  PUBLICATIONS_FOLDER,
  buildExportTree,
} from "../tree";
import type {
  DataExportItem,
  ExportItem,
  MediaExportItem,
  PublicationExportItem,
  TreeAccount,
  TreeLibrary,
} from "../types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SARAH: TreeAccount = { id: "acc-sarah", name: "Sarah", handle: "sarah.immo" };

const VIDEO: TreeLibrary = { id: "lib-video", name: "Behind the scene", type: "video" };
const AUDIO: TreeLibrary = { id: "lib-audio", name: "Musiques", type: "audio" };
const DATA: TreeLibrary = { id: "lib-data", name: "Prix m²", type: "data" };

function media(
  assetId: string,
  over: Partial<Omit<MediaExportItem, "kind" | "assetId" | "ref">> = {},
): MediaExportItem {
  const accountId = over.accountId === undefined ? SARAH.id : over.accountId;
  return {
    kind: "media",
    ref: mediaRef(assetId, accountId),
    assetId,
    accountId,
    libraryId: VIDEO.id,
    libraryType: "video",
    folder: null,
    filename: `${assetId}.mov`,
    r2Key: `content-library/${VIDEO.id}/${assetId}.mov`,
    url: `/uploads/${assetId}.mov`,
    edited: false,
    sizeBytes: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function data(libraryId: string, accountId: string | null, entryCount = 3): DataExportItem {
  return { kind: "data", ref: dataRef(libraryId, accountId), accountId, libraryId, entryCount };
}

function publication(
  slotId: string,
  over: Partial<Omit<PublicationExportItem, "kind" | "slotId" | "ref">> = {},
): PublicationExportItem {
  return {
    kind: "publication",
    ref: publicationRef(slotId),
    accountId: SARAH.id,
    slotId,
    source: "version",
    r2Key: `publications/${slotId}/montage.mp4`,
    localUrl: null,
    fileName: null,
    sizeBytes: 5000,
    date: "2026-10-04T10:00:00.000Z",
    label: "Visite",
    entityLabel: null,
    ...over,
  };
}

type Input = Parameters<typeof buildExportTree>[0];

function tree(partial: Partial<Input> & { items: ExportItem[] }) {
  return buildExportTree({
    clientName: "Agence Dupont",
    accounts: [SARAH],
    libraries: [VIDEO, AUDIO, DATA],
    ...partial,
  });
}

const joined = (result: ReturnType<typeof buildExportTree>) => result.files.map((f) => f.path.join("/"));

/** PRNG déterministe (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── Arbre de base ────────────────────────────────────────────────────────────

describe("buildExportTree — arbre de base", () => {
  const items: ExportItem[] = [
    media("m1", { folder: "Cuisine", filename: "rush-01.mov", sizeBytes: 100 }),
    media("m2", { filename: "intro.mp4", sizeBytes: null }),
    media("m3", { accountId: null, libraryId: AUDIO.id, libraryType: "audio", filename: "song.mp3", sizeBytes: 7 }),
    data(DATA.id, SARAH.id),
    publication("slot1", { label: "Visite Villa", entityLabel: "12 rue des Lilas", fileName: "Montage final.mov" }),
  ];

  it("range par compte, bibliothèque, Dossier, et met le dossier racine en tête de chaque chemin", () => {
    const result = tree({ items });
    expect(result.rootName).toBe("Agence Dupont");
    expect(joined(result)).toEqual([
      "Agence Dupont/Commun/Musiques/song.mp3",
      "Agence Dupont/Sarah/Behind the scene/Cuisine/rush-01.mov",
      "Agence Dupont/Sarah/Behind the scene/intro.mp4",
      "Agence Dupont/Sarah/Prix m²/Prix m².xlsx",
      "Agence Dupont/Sarah/Publications/2026-10-04 - Visite Villa - 12 rue des Lilas.mov",
    ]);
    for (const file of result.files) expect(file.path[0]).toBe(result.rootName);
  });

  it("renseigne ref, kind et taille (null pour les données et les tailles inconnues)", () => {
    const byRef = new Map(tree({ items }).files.map((f) => [f.ref, f]));
    expect(byRef.get(mediaRef("m1", SARAH.id))).toMatchObject({ kind: "media", size: 100 });
    expect(byRef.get(mediaRef("m2", SARAH.id))).toMatchObject({ kind: "media", size: null });
    expect(byRef.get(mediaRef("m3", null))).toMatchObject({ kind: "media", size: 7 });
    expect(byRef.get(dataRef(DATA.id, SARAH.id))).toMatchObject({ kind: "data", size: null });
    expect(byRef.get(publicationRef("slot1"))).toMatchObject({ kind: "publication", size: 5000 });
  });

  it("une entrée vide donne un arbre vide", () => {
    expect(tree({ items: [] })).toEqual({ rootName: "Agence Dupont", files: [] });
  });

  it("trie les fichiers par chemin complet (localeCompare « fr »)", () => {
    const result = tree({
      items: [
        media("m1", { filename: "b.mov" }),
        media("m2", { filename: "A.mov" }),
        media("m3", { filename: "é.mov" }),
        media("m4", { filename: "a.mov" }),
        media("m5", { folder: "Zèbre", filename: "x.mov" }),
        media("m6", { folder: "apple", filename: "x.mov" }),
      ],
    });
    const paths = joined(result);
    const collator = new Intl.Collator("fr");
    expect(paths).toEqual([...paths].sort((a, b) => collator.compare(a, b)));
  });

  it("n'a pas de dossier pour un compte sans élément", () => {
    const julie: TreeAccount = { id: "acc-julie", name: "Julie", handle: "julie.immo" };
    const result = tree({ accounts: [SARAH, julie], items: [media("m1")] });
    expect(new Set(result.files.map((f) => f.path[1]))).toEqual(new Set(["Sarah"]));
  });
});

describe("buildExportTree — dossier racine", () => {
  it("assainit le nom du client et le tronque à 40", () => {
    expect(tree({ clientName: "Agence/Dupont: SARL", items: [] }).rootName).toBe("Agence_Dupont_ SARL");
    expect(tree({ clientName: "A".repeat(60), items: [] }).rootName).toBe("A".repeat(40));
    expect(tree({ clientName: "aux", items: [] }).rootName).toBe("_aux");
  });

  it("repli « Export » quand il ne reste rien", () => {
    expect(tree({ clientName: "", items: [] }).rootName).toBe("Export");
    expect(tree({ clientName: " ... ", items: [] }).rootName).toBe("Export");
    expect(tree({ clientName: "\u200D", items: [] }).rootName).toBe("Export");
  });
});

// ─── Comptes ──────────────────────────────────────────────────────────────────

describe("buildExportTree — dossiers de compte", () => {
  const accountFolders = (result: ReturnType<typeof buildExportTree>) => [...new Set(result.files.map((f) => f.path[1]))].sort();

  it("deux comptes qui ne diffèrent que par la casse deviennent « Nom (@handle) »", () => {
    const upper: TreeAccount = { id: "acc-1", name: "Sarah", handle: "sarah1" };
    const lower: TreeAccount = { id: "acc-2", name: "sarah", handle: "sarah2" };
    const julie: TreeAccount = { id: "acc-3", name: "Julie", handle: "julie" };
    const result = tree({
      accounts: [upper, lower, julie],
      items: [
        media("m1", { accountId: upper.id }),
        media("m2", { accountId: lower.id }),
        media("m3", { accountId: julie.id }),
      ],
    });
    expect(accountFolders(result)).toEqual(["Julie", "Sarah (@sarah1)", "sarah (@sarah2)"]);
  });

  it("un homonyme sans élément ne force pas le suffixe", () => {
    const upper: TreeAccount = { id: "acc-1", name: "Sarah", handle: "sarah1" };
    const lower: TreeAccount = { id: "acc-2", name: "sarah", handle: "sarah2" };
    const result = tree({ accounts: [upper, lower], items: [media("m1", { accountId: upper.id })] });
    expect(accountFolders(result)).toEqual(["Sarah"]);
  });

  it("un compte nommé « Commun » (toute casse) ne prend pas le dossier réservé", () => {
    const a: TreeAccount = { id: "acc-1", name: "Commun", handle: "commun.immo" };
    const b: TreeAccount = { id: "acc-2", name: "commun", handle: "commun2" };
    const result = tree({
      accounts: [a, b],
      items: [
        media("m1", { accountId: a.id }),
        media("m2", { accountId: b.id }),
        media("m3", { accountId: null, libraryId: AUDIO.id, libraryType: "audio" }),
      ],
    });
    expect(accountFolders(result)).toEqual(["Commun", "Commun (@commun.immo)", "commun (@commun2)"]);
    // « Commun » tout court n'abrite que les éléments communs.
    const underCommon = result.files.filter((f) => f.path[1] === COMMON_FOLDER);
    expect(underCommon.map((f) => f.ref)).toEqual([mediaRef("m3", null)]);
  });

  it("un seul compte nommé « Commun » prend quand même « Nom (@handle) »", () => {
    const solo: TreeAccount = { id: "acc-1", name: "COMMUN", handle: "mon.compte" };
    const result = tree({
      accounts: [solo],
      items: [
        media("m1", { accountId: solo.id }),
        media("m2", { accountId: null, libraryId: AUDIO.id, libraryType: "audio" }),
      ],
    });
    expect(accountFolders(result)).toEqual(["COMMUN (@mon.compte)", "Commun"]);
  });

  it("une collision résiduelle ne fait jamais dépasser 40 caractères", () => {
    const a: TreeAccount = { id: "acc-1", name: "A".repeat(60), handle: "h1" };
    const b: TreeAccount = { id: "acc-2", name: "A".repeat(60), handle: "h2" };
    // Son nom nu est exactement le « Nom (@h1) » que le premier compte reçoit.
    const c: TreeAccount = { id: "acc-3", name: `${"A".repeat(34)} (@h1)`, handle: "h3" };
    const result = tree({
      accounts: [a, b, c],
      items: [media("m1", { accountId: a.id }), media("m2", { accountId: b.id }), media("m3", { accountId: c.id })],
    });
    const folders = accountFolders(result);
    expect(new Set(folders.map(nameKey)).size).toBe(3);
    for (const folder of folders) expect(folder.length).toBeLessThanOrEqual(MAX_FOLDER_SEGMENT);
  });

  it("deux comptes de même nom long gardent « (@handle) » entier dans 40 caractères", () => {
    const a: TreeAccount = { id: "acc-1", name: "A".repeat(60), handle: "h1" };
    const b: TreeAccount = { id: "acc-2", name: "A".repeat(60), handle: "h2" };
    const result = tree({
      accounts: [a, b],
      items: [media("m1", { accountId: a.id }), media("m2", { accountId: b.id })],
    });
    expect(accountFolders(result)).toEqual([`${"A".repeat(34)} (@h1)`, `${"A".repeat(34)} (@h2)`]);
    for (const folder of accountFolders(result)) expect(folder.length).toBeLessThanOrEqual(MAX_FOLDER_SEGMENT);
  });

  it("deux comptes dont les noms ne diffèrent qu'au-delà de 40 caractères entrent en collision", () => {
    const base = "B".repeat(45);
    const a: TreeAccount = { id: "acc-1", name: `${base}1`, handle: "h1" };
    const b: TreeAccount = { id: "acc-2", name: `${base}2`, handle: "h2" };
    const result = tree({
      accounts: [a, b],
      items: [media("m1", { accountId: a.id }), media("m2", { accountId: b.id })],
    });
    expect(accountFolders(result).every((folder) => /\(@h[12]\)$/.test(folder))).toBe(true);
  });

  it("départage une collision résiduelle dans un ordre qui ne dépend que des données", () => {
    // « Sarah » et « sarah » deviennent « Sarah (@x) » et « sarah (@x2) » ; un troisième
    // compte s'appelle littéralement « Sarah (@x) ».
    const a: TreeAccount = { id: "acc-1", name: "Sarah", handle: "x" };
    const b: TreeAccount = { id: "acc-2", name: "sarah", handle: "x2" };
    const c: TreeAccount = { id: "acc-3", name: "Sarah (@x)", handle: "y" };
    const items = [media("m1", { accountId: a.id }), media("m2", { accountId: b.id }), media("m3", { accountId: c.id })];
    const forward = tree({ accounts: [a, b, c], items });
    const backward = tree({ accounts: [c, b, a], items: [...items].reverse() });
    expect(forward).toEqual(backward);
    const folderOf = (accountId: string) => forward.files.find((f) => f.ref === mediaRef(`m${accountId.slice(-1)}`, accountId))?.path[1];
    expect(folderOf(a.id)).toBe("Sarah (@x)");
    expect(folderOf(c.id)).toBe("Sarah (@x) (2)");
    expect(folderOf(b.id)).toBe("sarah (@x2)");
  });

  it("un compte sans nom prend « @handle »", () => {
    const noName: TreeAccount = { id: "acc-1", name: "...", handle: "sarah.immo" };
    expect(accountFolders(tree({ accounts: [noName], items: [media("m1", { accountId: noName.id })] }))).toEqual([
      "@sarah.immo",
    ]);
  });

  it("emojis à ZWJ : le séquence est supprimée, les emojis restent", () => {
    const family: TreeAccount = { id: "acc-1", name: "\u{1F469}\u200D\u{1F469}\u200D\u{1F467} Dupont", handle: "d" };
    const result = tree({ accounts: [family], items: [media("m1", { accountId: family.id })] });
    expect(accountFolders(result)).toEqual(["\u{1F469}\u{1F469}\u{1F467} Dupont"]);
  });

  it("un compte absent de `accounts` mais cité par un élément garde un dossier", () => {
    const result = tree({ accounts: [], items: [media("m1", { accountId: "acc-fantome" })] });
    expect(accountFolders(result)).toEqual(["Compte"]);
  });
});

// ─── Bibliothèques ────────────────────────────────────────────────────────────

describe("buildExportTree — dossiers de bibliothèque", () => {
  it("« Publications » est réservé : une bibliothèque qui s'appelle ainsi est dédoublonnée", () => {
    const clash: TreeLibrary = { id: "lib-pub", name: "Publications", type: "video" };
    const result = tree({
      libraries: [clash],
      items: [media("m1", { libraryId: clash.id }), publication("slot1")],
    });
    expect(joined(result)).toEqual([
      "Agence Dupont/Sarah/Publications (2)/m1.mov",
      "Agence Dupont/Sarah/Publications/2026-10-04 - Visite.mp4",
    ]);
    expect(PUBLICATIONS_FOLDER).toBe("Publications");
  });

  it("deux bibliothèques homonymes (toute casse) : vidéo, puis son, puis données", () => {
    const a: TreeLibrary = { id: "lib-a", name: "Musiques", type: "audio" };
    const b: TreeLibrary = { id: "lib-b", name: "musiques", type: "video" };
    const c: TreeLibrary = { id: "lib-c", name: "MUSIQUES", type: "data" };
    const items = [
      media("m1", { libraryId: a.id, libraryType: "audio" }),
      media("m2", { libraryId: b.id, libraryType: "video" }),
      data(c.id, SARAH.id),
    ];
    const result = tree({ libraries: [a, b, c], items });
    const folderOf = (ref: string) => result.files.find((f) => f.ref === ref)?.path[2];
    expect(folderOf(mediaRef("m2", SARAH.id))).toBe("musiques");
    expect(folderOf(mediaRef("m1", SARAH.id))).toBe("Musiques (2)");
    expect(folderOf(dataRef(c.id, SARAH.id))).toBe("MUSIQUES (3)");
  });

  it("le nom d'une bibliothèque est le même sous chaque compte et sous « Commun »", () => {
    const julie: TreeAccount = { id: "acc-julie", name: "Julie", handle: "julie" };
    const result = tree({
      accounts: [SARAH, julie],
      items: [
        media("m1", { libraryId: AUDIO.id, libraryType: "audio" }),
        media("m2", { accountId: julie.id, libraryId: AUDIO.id, libraryType: "audio" }),
        media("m3", { accountId: null, libraryId: AUDIO.id, libraryType: "audio" }),
      ],
    });
    expect(new Set(result.files.map((f) => f.path[2]))).toEqual(new Set(["Musiques"]));
  });

  it("deux bibliothèques qui ne diffèrent qu'après 40 caractères restent sous 40 avec leur numéro", () => {
    const a: TreeLibrary = { id: "lib-a", name: `${"L".repeat(45)}1`, type: "video" };
    const b: TreeLibrary = { id: "lib-b", name: `${"L".repeat(45)}2`, type: "video" };
    const result = tree({
      libraries: [a, b],
      items: [media("m1", { libraryId: a.id }), media("m2", { libraryId: b.id })],
    });
    expect(result.files.map((f) => f.path[2]).sort()).toEqual([`${"L".repeat(36)} (2)`, "L".repeat(40)]);
  });

  it("calcule les noms sur TOUTES les bibliothèques reçues : un nom ne change pas quand l'une est vide", () => {
    const first: TreeLibrary = { id: "lib-1", name: "Intro", type: "video" };
    const second: TreeLibrary = { id: "lib-2", name: "intro", type: "audio" };
    const onlySecond = tree({
      libraries: [first, second],
      items: [media("m1", { libraryId: second.id, libraryType: "audio" })],
    });
    expect(onlySecond.files[0].path[2]).toBe("intro (2)");
  });

  it("une bibliothèque citée par un élément sans avoir été déclarée garde un dossier", () => {
    const result = tree({ libraries: [], items: [media("m1", { libraryId: "lib-fantome" })] });
    expect(joined(result)).toEqual(["Agence Dupont/Sarah/Bibliothèque/m1.mov"]);
  });

  it("assainit, tronque à 40 et neutralise les noms réservés", () => {
    const long: TreeLibrary = { id: "lib-long", name: "L".repeat(60), type: "video" };
    const con: TreeLibrary = { id: "lib-con", name: "CON", type: "audio" };
    const result = tree({
      libraries: [long, con],
      items: [media("m1", { libraryId: long.id }), media("m2", { libraryId: con.id, libraryType: "audio" })],
    });
    expect(result.files.map((f) => f.path[2]).sort()).toEqual(["L".repeat(40), "_CON"]);
  });
});

// ─── Dossiers et fichiers ─────────────────────────────────────────────────────

describe("buildExportTree — Dossiers", () => {
  it("un Dossier reçoit son nom une seule fois, quel que soit le nombre de fichiers", () => {
    const result = tree({
      items: [
        media("m1", { folder: "Cuisine / Salon", filename: "a.mov" }),
        media("m2", { folder: "Cuisine / Salon", filename: "b.mov" }),
        media("m3", { folder: "Cuisine / Salon", filename: "c.mov" }),
      ],
    });
    expect(new Set(result.files.map((f) => f.path[3]))).toEqual(new Set(["Cuisine _ Salon"]));
  });

  it("des Dossiers qui ne diffèrent que par la casse sont départagés", () => {
    const result = tree({
      items: [media("m1", { folder: "cuisine" }), media("m2", { folder: "Cuisine" })],
    });
    const folderOf = (ref: string) => result.files.find((f) => f.ref === ref)?.path[3];
    expect(folderOf(mediaRef("m2", SARAH.id))).toBe("Cuisine");
    expect(folderOf(mediaRef("m1", SARAH.id))).toBe("cuisine (2)");
  });

  it("deux Dossiers qui ne diffèrent qu'après 40 caractères restent sous 40 avec leur numéro", () => {
    const result = tree({
      items: [media("m1", { folder: `${"D".repeat(45)}1` }), media("m2", { folder: `${"D".repeat(45)}2` })],
    });
    expect(result.files.map((f) => f.path[3]).sort()).toEqual([`${"D".repeat(36)} (2)`, "D".repeat(40)]);
  });

  it("un Dossier et un fichier de la racine ne peuvent pas porter le même nom", () => {
    const result = tree({
      items: [
        media("m1", { folder: "Cuisine.mp4", filename: "dedans.mov" }),
        media("m2", { filename: "cuisine.mp4" }),
      ],
    });
    // Le Dossier, nommé en premier, garde son nom ; le fichier de la racine cède.
    expect(new Set(joined(result))).toEqual(
      new Set([
        "Agence Dupont/Sarah/Behind the scene/Cuisine.mp4/dedans.mov",
        "Agence Dupont/Sarah/Behind the scene/cuisine (2).mp4",
      ]),
    );
  });

  it("un Dossier sans nom exploitable devient « Dossier »", () => {
    const result = tree({ items: [media("m1", { folder: "..." }), media("m2", { folder: "   " })] });
    expect(result.files.map((f) => f.path.length).sort()).toEqual([4, 5]);
    expect(result.files.find((f) => f.path.length === 5)?.path[3]).toBe("Dossier");
  });

  it("noms réservés et caractères interdits dans un Dossier", () => {
    const result = tree({ items: [media("m1", { folder: "nul" }), media("m2", { folder: "Été\u200D 2026" })] });
    expect(new Set(result.files.map((f) => f.path[3]))).toEqual(new Set(["_nul", "Été 2026"]));
  });

  it("un Dossier est propre à chaque bibliothèque et à chaque compte", () => {
    const julie: TreeAccount = { id: "acc-julie", name: "Julie", handle: "julie" };
    const result = tree({
      accounts: [SARAH, julie],
      items: [
        media("m1", { folder: "Cuisine", filename: "x.mov" }),
        media("m2", { folder: "cuisine", filename: "x.mov", accountId: julie.id }),
      ],
    });
    // Aucun homonyme entre deux dossiers de comptes différents : pas de « (2) ».
    expect(joined(result)).toEqual([
      "Agence Dupont/Julie/Behind the scene/cuisine/x.mov",
      "Agence Dupont/Sarah/Behind the scene/Cuisine/x.mov",
    ]);
  });
});

describe("buildExportTree — fichiers médias", () => {
  it("garde le nom d'origine, extension comprise, caractères accentués compris", () => {
    const result = tree({ items: [media("m1", { filename: "Visite Été 2026.MOV" })] });
    expect(result.files[0].path.at(-1)).toBe("Visite Été 2026.MOV");
  });

  it("neutralise aux.mp4 et les noms réservés (toute casse, texte qui suit le premier point)", () => {
    const result = tree({
      items: [
        media("m1", { filename: "aux.mp4" }),
        media("m2", { filename: "Aux. Coulisses.mov" }),
        media("m3", { filename: "COM1.mov" }),
        media("m4", { filename: "desktop.ini" }),
        media("m5", { filename: "raccourci.lnk" }),
      ],
    });
    expect(result.files.map((f) => f.path.at(-1)).sort()).toEqual(
      ["_COM1.mov", "_Aux. Coulisses.mov", "_aux.mp4", "_desktop.ini", "raccourci.lnk_"].sort(),
    );
  });

  it("emojis à ZWJ et caractères invisibles disparaissent du nom", () => {
    const result = tree({ items: [media("m1", { filename: "Visite\u200D \u{1F3E0}\uFEFF.mov" })] });
    expect(result.files[0].path.at(-1)).toBe("Visite \u{1F3E0}.mov");
    for (const segment of result.files[0].path) expect(segment).not.toMatch(/[\u200D\uFEFF]/);
  });

  it("départage les homonymes sans tenir compte de la casse, du plus ancien au plus récent", () => {
    const result = tree({
      items: [
        media("zzz", { folder: "A", filename: "IMG_0001.MOV", createdAt: "2026-01-03T00:00:00.000Z" }),
        media("aaa", { folder: "A", filename: "IMG_0001.MOV", createdAt: "2026-01-02T00:00:00.000Z" }),
        media("mmm", { folder: "A", filename: "img_0001.mov", createdAt: "2026-01-04T00:00:00.000Z" }),
        media("bbb", { folder: "B", filename: "IMG_0001.MOV", createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    const nameOf = (assetId: string) => result.files.find((f) => f.ref === mediaRef(assetId, SARAH.id))?.path.at(-1);
    expect(nameOf("aaa")).toBe("IMG_0001.MOV");
    expect(nameOf("zzz")).toBe("IMG_0001 (2).MOV");
    expect(nameOf("mmm")).toBe("img_0001 (3).mov");
    // Un autre Dossier ne partage pas les noms pris.
    expect(nameOf("bbb")).toBe("IMG_0001.MOV");
  });

  it("à date égale, l'ordre est celui des ids", () => {
    const forward = tree({ items: [media("a1", { filename: "x.mov" }), media("b1", { filename: "x.mov" })] });
    const backward = tree({ items: [media("b1", { filename: "x.mov" }), media("a1", { filename: "x.mov" })] });
    expect(forward).toEqual(backward);
    expect(forward.files.find((f) => f.ref === mediaRef("a1", SARAH.id))?.path.at(-1)).toBe("x.mov");
    expect(forward.files.find((f) => f.ref === mediaRef("b1", SARAH.id))?.path.at(-1)).toBe("x (2).mov");
  });

  it("un média réservé à deux comptes apparaît dans les deux dossiers", () => {
    const julie: TreeAccount = { id: "acc-julie", name: "Julie", handle: "julie" };
    const result = tree({
      accounts: [SARAH, julie],
      items: [media("m1", { filename: "x.mov" }), media("m1", { filename: "x.mov", accountId: julie.id })],
    });
    expect(joined(result)).toEqual([
      "Agence Dupont/Julie/Behind the scene/x.mov",
      "Agence Dupont/Sarah/Behind the scene/x.mov",
    ]);
  });

  describe("extension", () => {
    const nameOf = (item: MediaExportItem) => tree({ items: [item] }).files[0].path.at(-1);

    it("média édité : MP4, quelle que soit l'extension d'origine", () => {
      expect(nameOf(media("m1", { filename: "rush.mov", edited: true }))).toBe("rush.mp4");
      expect(nameOf(media("m1", { filename: "rush.MOV", edited: true }))).toBe("rush.mp4");
      expect(nameOf(media("m1", { filename: "rush", edited: true, r2Key: "k/m1.mov" }))).toBe("rush.mp4");
      expect(nameOf(media("m1", { filename: "rush.mov", edited: false }))).toBe("rush.mov");
    });

    it("sans extension : celle de la clé R2, sinon « bin »", () => {
      expect(nameOf(media("m1", { filename: "rush", r2Key: "content-library/lib/m1.mov" }))).toBe("rush.mov");
      expect(nameOf(media("m1", { filename: "rush", r2Key: "content-library/lib/m1" }))).toBe("rush.bin");
      // Un point dans un dossier de la clé n'est pas une extension.
      expect(nameOf(media("m1", { filename: "rush", r2Key: "content-library/v1.2/m1" }))).toBe("rush.bin");
      expect(nameOf(media("m1", { filename: "rush", r2Key: "" }))).toBe("rush.bin");
    });

    it("nom vide ou sans radical : « fichier »", () => {
      expect(nameOf(media("m1", { filename: "" }))).toBe("fichier.mov");
      expect(nameOf(media("m1", { filename: "///", r2Key: "k/m1.wav" }))).toBe("___.wav");
    });

    it("garde la casse de l'extension et ignore les espaces de fin ; un caractère interdit devient « _ »", () => {
      expect(nameOf(media("m1", { filename: "Clip.MP4 " }))).toBe("Clip.MP4");
      expect(nameOf(media("m1", { filename: "a.m:p4" }))).toBe("a.m_p4");
    });
  });
});

describe("buildExportTree — données", () => {
  it("un .xlsx portant le nom du dossier de la bibliothèque, sous le compte", () => {
    const result = tree({ items: [data(DATA.id, SARAH.id)] });
    expect(result.files).toEqual([
      {
        ref: dataRef(DATA.id, SARAH.id),
        kind: "data",
        path: ["Agence Dupont", "Sarah", "Prix m²", "Prix m².xlsx"],
        size: null,
      },
    ]);
  });

  it("fiches communes : sous « Commun »", () => {
    const result = tree({ items: [data(DATA.id, null)] });
    expect(result.files[0].path).toEqual(["Agence Dupont", "Commun", "Prix m²", "Prix m².xlsx"]);
  });

  it("le nom suit le dossier assaini et dédoublonné de la bibliothèque", () => {
    const clash: TreeLibrary = { id: "lib-clash", name: "aux", type: "data" };
    const other: TreeLibrary = { id: "lib-other", name: "AUX", type: "audio" };
    const result = tree({
      libraries: [clash, other],
      items: [data(clash.id, SARAH.id), media("m1", { libraryId: other.id, libraryType: "audio" })],
    });
    // Le son est nommé avant les données : « AUX » garde le nom, « aux » cède, et le
    // .xlsx porte le nom définitif du dossier.
    expect(new Set(joined(result))).toEqual(
      new Set(["Agence Dupont/Sarah/_AUX/m1.mov", "Agence Dupont/Sarah/_aux (2)/_aux (2).xlsx"]),
    );
  });
});

// ─── Publications ─────────────────────────────────────────────────────────────

describe("buildExportTree — publications", () => {
  const nameOf = (item: PublicationExportItem) => tree({ items: [item] }).files[0].path.at(-1);

  it("<YYYY-MM-DD> - <libellé> - <fiche>.<ext> sous <compte>/Publications", () => {
    const result = tree({
      items: [publication("slot1", { label: "Visite Villa", entityLabel: "12 rue des Lilas", fileName: "Montage.mov" })],
    });
    expect(result.files[0].path).toEqual([
      "Agence Dupont",
      "Sarah",
      "Publications",
      "2026-10-04 - Visite Villa - 12 rue des Lilas.mov",
    ]);
  });

  it("la date est le jour à Paris, pas le jour UTC", () => {
    // 22:30 UTC le 4 octobre = 00:30 le 5 à Paris (heure d'été).
    expect(nameOf(publication("s1", { date: "2026-10-04T22:30:00.000Z" }))).toBe("2026-10-05 - Visite.mp4");
    // 23:30 UTC le 31 décembre = 00:30 le 1er janvier à Paris (heure d'hiver).
    expect(nameOf(publication("s2", { date: "2026-12-31T23:30:00.000Z" }))).toBe("2027-01-01 - Visite.mp4");
    expect(nameOf(publication("s3", { date: "2026-07-01T21:59:00.000Z" }))).toBe("2026-07-01 - Visite.mp4");
  });

  it("une date illisible donne « Sans date »", () => {
    expect(nameOf(publication("s1", { date: "pas une date" }))).toBe("Sans date - Visite.mp4");
  });

  it("extension : celle du nom de fichier, sinon de la clé R2, sinon mp4", () => {
    expect(nameOf(publication("s1", { fileName: "Reel.MOV" }))).toBe("2026-10-04 - Visite.MOV");
    expect(nameOf(publication("s1", { fileName: null, r2Key: "publications/s1/out.mov" }))).toBe("2026-10-04 - Visite.mov");
    expect(nameOf(publication("s1", { fileName: "sans-extension", r2Key: "publications/s1/out.mov" }))).toBe(
      "2026-10-04 - Visite.mov",
    );
    expect(nameOf(publication("s1", { fileName: null, r2Key: "publications/s1/out" }))).toBe("2026-10-04 - Visite.mp4");
  });

  it("n'ajoute pas la fiche quand elle répète le libellé", () => {
    expect(nameOf(publication("s1", { label: "Villa Lilas", entityLabel: "villa lilas" }))).toBe("2026-10-04 - Villa Lilas.mp4");
  });

  it("assainit le libellé sans prendre un libellé « Aux » pour un nom réservé (la date est en tête)", () => {
    expect(nameOf(publication("s1", { label: "Aux. Coulisses / Salon: 2" }))).toBe("2026-10-04 - Aux. Coulisses _ Salon_ 2.mp4");
    expect(nameOf(publication("s1", { label: "\u200D" }))).toBe("2026-10-04 - Publication.mp4");
  });

  it("des publications du même jour et du même libellé : la première garde le nom nu, les suivantes la fin de leur slotId", () => {
    const items = [
      publication("slotAAAAAAcd1234", { date: "2026-10-04T10:00:00.000Z" }),
      publication("slotBBBBBBef5678", { date: "2026-10-04T12:00:00.000Z" }),
      publication("slotCCCCCCgh9012", { date: "2026-10-04T14:00:00.000Z" }),
    ];
    const names = (list: ExportItem[]) =>
      Object.fromEntries(tree({ items: list }).files.map((f) => [f.ref, f.path.at(-1)]));
    expect(names(items)).toEqual({
      [publicationRef("slotAAAAAAcd1234")]: "2026-10-04 - Visite.mp4",
      [publicationRef("slotBBBBBBef5678")]: "2026-10-04 - Visite - ef5678.mp4",
      [publicationRef("slotCCCCCCgh9012")]: "2026-10-04 - Visite - gh9012.mp4",
    });
    // Stable : l'ordre de l'entrée ne change rien.
    expect(names([...items].reverse())).toEqual(names(items));
  });

  it("l'ordre est (date, slotId) : le plus ancien garde le nom nu, même si son id est le plus grand", () => {
    const early = publication("zzzzzz", { date: "2026-10-04T08:00:00.000Z" });
    const late = publication("aaaaaa", { date: "2026-10-04T18:00:00.000Z" });
    const names = Object.fromEntries(tree({ items: [late, early] }).files.map((f) => [f.ref, f.path.at(-1)]));
    expect(names[early.ref]).toBe("2026-10-04 - Visite.mp4");
    expect(names[late.ref]).toBe("2026-10-04 - Visite - aaaaaa.mp4");
  });

  it("départage par slotId à date identique", () => {
    const names = Object.fromEntries(
      tree({ items: [publication("slot-b"), publication("slot-a")] }).files.map((f) => [f.ref, f.path.at(-1)]),
    );
    expect(names[publicationRef("slot-a")]).toBe("2026-10-04 - Visite.mp4");
    expect(names[publicationRef("slot-b")]).toBe("2026-10-04 - Visite - slot-b.mp4");
  });

  it("une collision résiduelle (même fin de slotId) retombe sur « (2) »", () => {
    const result = tree({
      items: [publication("aaa-123456"), publication("bbb-123456"), publication("ccc-123456")],
    });
    expect(result.files.map((f) => f.path.at(-1))).toEqual([
      "2026-10-04 - Visite - 123456 (2).mp4",
      "2026-10-04 - Visite - 123456.mp4",
      "2026-10-04 - Visite.mp4",
    ]);
  });

  it("deux comptes ont chacun leurs Publications", () => {
    const julie: TreeAccount = { id: "acc-julie", name: "Julie", handle: "julie" };
    const result = tree({
      accounts: [SARAH, julie],
      items: [publication("s1"), publication("s2", { accountId: julie.id })],
    });
    expect(joined(result)).toEqual([
      "Agence Dupont/Julie/Publications/2026-10-04 - Visite.mp4",
      "Agence Dupont/Sarah/Publications/2026-10-04 - Visite.mp4",
    ]);
  });

  it("la taille de la publication est reprise", () => {
    expect(tree({ items: [publication("s1", { sizeBytes: null })] }).files[0].size).toBeNull();
    expect(tree({ items: [publication("s1", { sizeBytes: 123 })] }).files[0].size).toBe(123);
  });
});

// ─── Entrée atypique ──────────────────────────────────────────────────────────

describe("buildExportTree — entrée atypique", () => {
  it("écarte les refs en double", () => {
    const item = media("m1");
    const result = tree({ items: [item, { ...item }, item] });
    expect(result.files).toHaveLength(1);
  });

  it("ne modifie pas l'entrée", () => {
    const items = [media("m2"), media("m1")];
    const accounts = [SARAH];
    const libraries = [VIDEO, AUDIO];
    const snapshot = JSON.stringify({ items, accounts, libraries });
    buildExportTree({ clientName: "X", accounts, libraries, items });
    expect(JSON.stringify({ items, accounts, libraries })).toBe(snapshot);
  });
});

// ─── Budget de chemin ─────────────────────────────────────────────────────────

describe("buildExportTree — budget de chemin", () => {
  it("plafonne chaque dossier à 40 caractères et tout le chemin à 200, extension conservée", () => {
    const long: TreeAccount = { id: "acc-long", name: "C".repeat(80), handle: "long" };
    const library: TreeLibrary = { id: "lib-long", name: "D".repeat(80), type: "video" };
    const result = buildExportTree({
      clientName: "A".repeat(80),
      accounts: [long],
      libraries: [library],
      items: [
        media("m1", {
          accountId: long.id,
          libraryId: library.id,
          folder: "E".repeat(80),
          filename: `${"F".repeat(250)}.mov`,
        }),
      ],
    });
    const [file] = result.files;
    expect(file.path.slice(0, 4).map((segment) => segment.length)).toEqual([40, 40, 40, 40]);
    expect(file.path.at(-1)).toHaveLength(36);
    expect(file.path.at(-1)?.endsWith(".mov")).toBe(true);
    expect(file.path.join("/")).toHaveLength(MAX_RELATIVE_PATH);
  });

  it("un homonyme tronqué garde son « (2) » et l'extension, sans dépasser le budget", () => {
    const stem = "G".repeat(250);
    const result = tree({
      items: [
        media("m1", { folder: "H".repeat(80), filename: `${stem}.mov`, createdAt: "2026-01-01T00:00:00.000Z" }),
        media("m2", { folder: "H".repeat(80), filename: `${stem}.mov`, createdAt: "2026-01-02T00:00:00.000Z" }),
      ],
    });
    const names = result.files.map((f) => f.path.at(-1) as string).sort();
    expect(names.every((name) => name.endsWith(".mov"))).toBe(true);
    expect(names.some((name) => name.endsWith(" (2).mov"))).toBe(true);
    for (const file of result.files) expect(file.path.join("/").length).toBeLessThanOrEqual(MAX_RELATIVE_PATH);
  });

  it("un chemin court laisse jusqu'à 100 caractères au nom de fichier", () => {
    const result = tree({ items: [publication("s1", { label: "L".repeat(300) })] });
    const name = result.files[0].path.at(-1) as string;
    expect(name).toHaveLength(100);
    expect(name.endsWith(".mp4")).toBe(true);
    expect(name.startsWith("2026-10-04 - L")).toBe(true);
  });

  it("la fin du slotId survit à la troncature d'un libellé long", () => {
    const result = tree({
      items: [
        publication("s-aaaaaa", { label: "L".repeat(300), date: "2026-10-04T08:00:00.000Z" }),
        publication("s-bbbbbb", { label: "L".repeat(300), date: "2026-10-04T09:00:00.000Z" }),
      ],
    });
    const names = result.files.map((f) => f.path.at(-1) as string);
    expect(names).toHaveLength(2);
    expect(new Set(names.map(nameKey)).size).toBe(2);
    expect(names.some((name) => name.endsWith(" - bbbbbb.mp4"))).toBe(true);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(100);
  });

  it("un nom en CJK reste sous 255 octets, « .crswap » compris, avec son extension", () => {
    const result = tree({
      items: [
        media("m1", { folder: "\u6f22".repeat(40), filename: `${"\u6f22".repeat(90)}.mov` }),
        media("m2", { folder: "\u6f22".repeat(40), filename: `${"\u6f22".repeat(90)}.mov` }),
      ],
    });
    for (const file of result.files) {
      const name = file.path.at(-1) as string;
      expect(name.endsWith(".mov") || name.endsWith(" (2).mov")).toBe(true);
      expect(new TextEncoder().encode(name).length + 7).toBeLessThanOrEqual(255);
    }
    expect(new Set(result.files.map((f) => nameKey(f.path.at(-1) as string))).size).toBe(2);
  });

  it("la fin du slotId survit aussi à un libellé en CJK, sous 255 octets", () => {
    const label = "\u6f22".repeat(90);
    const result = tree({
      items: [
        publication("s-aaaaaa", { label, date: "2026-10-04T08:00:00.000Z" }),
        publication("s-bbbbbb", { label, date: "2026-10-04T09:00:00.000Z" }),
      ],
    });
    const names = result.files.map((f) => f.path.at(-1) as string);
    for (const name of names) expect(new TextEncoder().encode(name).length + 7).toBeLessThanOrEqual(255);
    expect(names.some((name) => name.endsWith(" - bbbbbb.mp4"))).toBe(true);
    expect(new Set(names.map(nameKey)).size).toBe(2);
  });

  it("un emoji n'est jamais coupé en deux par la troncature", () => {
    const result = tree({ items: [media("m1", { folder: "\u{1F600}".repeat(30), filename: `${"\u{1F600}".repeat(60)}.mov` })] });
    for (const segment of result.files[0].path) {
      expect(segment).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(result.files[0].path.join("/").length).toBeLessThanOrEqual(MAX_RELATIVE_PATH);
  });
});

// ─── Déterminisme et invariants (jeu de données aléatoire) ────────────────────

describe("buildExportTree — déterminisme et invariants", () => {
  const NAMES = [
    "Sarah", "sarah", "SARAH", "Commun", "commun", "Publications", "aux", "CON", "Aux. Coulisses", "Cuisine", "cuisine",
    "Salon/Séjour", "Été 2026", "\u{1F469}\u200D\u{1F469}\u200D\u{1F467} Famille", "x".repeat(70), "Y".repeat(41), "...", "",
    "Villa: Lilas?", "  espaces  ", "nul.txt", "Prix m²", "Musiques", "\u6f22".repeat(60),
  ];
  const FILES = [
    "IMG_0001.MOV", "img_0001.mov", "aux.mp4", "Aux. Coulisses.mov", "desktop.ini", "raccourci.lnk", "rush", "",
    `${"z".repeat(300)}.mov`, "Visite\u200D.mov", "a.m:p4", "Cuisine.mp4", "cuisine.MP4", "Clip.MP4 ", "../évasion.mov",
    `${"\u6f22".repeat(90)}.mov`, `${"\u{1F600}".repeat(70)}.mp4`,
  ];

  function dataset(seed: number) {
    const random = prng(seed);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];

    const accounts: TreeAccount[] = Array.from({ length: 5 }, (_, i) => ({
      id: `acc-${i}`,
      name: pick(NAMES),
      handle: `handle.${i}`,
    }));
    const libraries: TreeLibrary[] = Array.from({ length: 6 }, (_, i) => ({
      id: `lib-${i}`,
      name: pick(NAMES),
      type: (["video", "audio", "data"] as const)[i % 3],
    }));

    const items: ExportItem[] = [];
    for (let i = 0; i < 260; i += 1) {
      const library = pick(libraries.filter((l) => l.type !== "data"));
      const accountId = library.type === "audio" && random() < 0.3 ? null : pick(accounts).id;
      items.push(
        media(`asset${i}`, {
          accountId,
          libraryId: library.id,
          libraryType: library.type as "video" | "audio",
          folder: random() < 0.3 ? null : pick(NAMES),
          filename: pick(FILES),
          r2Key: `k/asset${i}${random() < 0.5 ? ".mov" : ""}`,
          edited: random() < 0.2,
          createdAt: `2026-01-0${1 + Math.floor(random() * 3)}T00:00:00.000Z`,
          sizeBytes: random() < 0.2 ? null : Math.floor(random() * 1e6),
        }),
      );
    }
    for (const library of libraries.filter((l) => l.type === "data")) {
      for (const account of accounts) if (random() < 0.7) items.push(data(library.id, account.id));
      items.push(data(library.id, null));
    }
    for (let i = 0; i < 40; i += 1) {
      items.push(
        publication(`slot${String(i).padStart(2, "0")}-${pick(["aaaaaa", "bbbbbb"])}`, {
          accountId: pick(accounts).id,
          label: pick(NAMES),
          entityLabel: random() < 0.5 ? null : pick(NAMES),
          date: `2026-10-0${1 + Math.floor(random() * 3)}T${random() < 0.5 ? "08" : "23"}:30:00.000Z`,
          fileName: random() < 0.5 ? null : pick(FILES),
        }),
      );
    }
    return { accounts, libraries, items };
  }

  it("la même entrée dans n'importe quel ordre donne exactement la même sortie", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { accounts, libraries, items } = dataset(seed);
      const reference = buildExportTree({ clientName: "Agence Dupont", accounts, libraries, items });
      const random = prng(seed * 1000);
      for (let round = 0; round < 6; round += 1) {
        const again = buildExportTree({
          clientName: "Agence Dupont",
          accounts: shuffled(accounts, random),
          libraries: shuffled(libraries, random),
          items: shuffled(items, random),
        });
        expect(again).toEqual(reference);
      }
    }
  });

  it("respecte tous les invariants sur des données hostiles", () => {
    // Le jeu de données doit réellement provoquer les collisions qu'on prétend tester.
    const seen = { disambiguatedAccount: false, numberedFile: false, numberedFolder: false, slotSuffix: false };
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const { accounts, libraries, items } = dataset(seed);
      const result = buildExportTree({ clientName: "Agence Dupont", accounts, libraries, items });
      const context = `seed ${seed}`;

      // Chaque ref d'entrée sort exactement une fois.
      expect(result.files.map((f) => f.ref).sort(), context).toEqual(items.map((i) => i.ref).sort());

      const fileKeys = new Set<string>();
      const folderKeys = new Set<string>();
      for (const file of result.files) {
        const path = file.path.join("/");
        const label = `${context} ${path}`;

        for (const segment of file.path) {
          // 255 octets UTF-8 au plus sur ext4 et APFS, avec « .crswap » (7) à côté pendant l'écriture.
          expect(new TextEncoder().encode(segment).length + 7, label).toBeLessThanOrEqual(255);
          const isFile = segment === file.path.at(-1);
          seen.disambiguatedAccount ||= /\(@handle\.\d\)$/.test(segment);
          seen.numberedFile ||= isFile && / \(\d+\)(\.\w+)?$/.test(segment);
          seen.numberedFolder ||= !isFile && / \(\d+\)$/.test(segment);
          seen.slotSuffix ||= isFile && / - (aaaaaa|bbbbbb)\.mp4$/.test(segment);
        }

        // Budget : dossiers ≤ 40, chemin complet ≤ 200.
        expect(path.length, label).toBeLessThanOrEqual(MAX_RELATIVE_PATH);
        for (const folder of file.path.slice(0, -1)) expect(folder.length, label).toBeLessThanOrEqual(MAX_FOLDER_SEGMENT);
        expect(file.path.at(-1)?.length, label).toBeLessThanOrEqual(100);

        // Chaque segment est déjà propre : Chrome l'acceptera, et il est idempotent.
        for (const segment of file.path) {
          expect(segment.length, label).toBeGreaterThan(0);
          expect(sanitizeFsaSegment(segment, "x"), label).toBe(segment);
        }

        // Pas d'écrasement : deux fichiers ne partagent jamais un chemin, casse ignorée.
        const key = file.path.map(nameKey).join("/");
        expect(fileKeys.has(key), label).toBe(false);
        fileKeys.add(key);
        for (let depth = 1; depth < file.path.length; depth += 1) {
          folderKeys.add(file.path.slice(0, depth).map(nameKey).join("/"));
        }
      }
      // Pas de fichier qui porte le nom d'un dossier.
      for (const key of fileKeys) expect(folderKeys.has(key), `${context} ${key}`).toBe(false);

      // Les noms de bibliothèque sont uniques pour tout l'export et jamais « Publications ».
      const libraryFolderOf = new Map<string, string>();
      for (const item of items) {
        if (item.kind === "publication") continue;
        const file = result.files.find((f) => f.ref === item.ref);
        const folder = file?.path[2] as string;
        const known = libraryFolderOf.get(item.libraryId);
        if (known !== undefined) expect(folder, context).toBe(known);
        libraryFolderOf.set(item.libraryId, folder);
      }
      const names = [...libraryFolderOf.values()];
      expect(new Set(names.map(nameKey)).size, context).toBe(names.length);
      expect(names.map(nameKey), context).not.toContain(nameKey(PUBLICATIONS_FOLDER));

      // Aucun compte ne prend le dossier réservé « Commun », et lui seul abrite les éléments communs.
      for (const item of items) {
        const file = result.files.find((f) => f.ref === item.ref);
        if (item.accountId === null) expect(file?.path[1], context).toBe(COMMON_FOLDER);
        else expect(nameKey(file?.path[1] as string), context).not.toBe(nameKey(COMMON_FOLDER));
      }
    }
    expect(seen).toEqual({ disambiguatedAccount: true, numberedFile: true, numberedFolder: true, slotSuffix: true });
  });
});

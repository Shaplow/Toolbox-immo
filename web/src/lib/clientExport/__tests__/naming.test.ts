import { describe, expect, it } from "vitest";
import {
  cleanFsaText,
  dedupeName,
  nameKey,
  sanitizeFsaFileName,
  sanitizeFsaSegment,
  splitExtension,
  truncateFileName,
  truncateSegment,
} from "../naming";

/** PRNG déterministe (mulberry32) : un test qui échoue doit échouer de la même façon. */
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

describe("sanitizeFsaSegment — caractères", () => {
  it("garde accents, emojis et espaces simples", () => {
    expect(sanitizeFsaSegment("Agence Dupont & Fils", "x")).toBe("Agence Dupont & Fils");
    expect(sanitizeFsaSegment("Été à la plage 🏖\uFE0F", "x")).toBe("Été à la plage 🏖\uFE0F");
  });

  it("normalise en NFC", () => {
    expect(sanitizeFsaSegment("Cafe\u0301", "x")).toBe("Café");
    expect(sanitizeFsaSegment("Cafe\u0301", "x")).toBe(sanitizeFsaSegment("Café", "x"));
  });

  it("supprime le ZWJ des emojis, le BOM, les marques de direction et les espaces de largeur nulle", () => {
    expect(sanitizeFsaSegment("\u{1F468}\u200D\u{1F469}\u200D\u{1F467} Famille", "x")).toBe(
      "\u{1F468}\u{1F469}\u{1F467} Famille",
    );
    expect(sanitizeFsaSegment("\uFEFFSarah\u200E", "x")).toBe("Sarah");
    expect(sanitizeFsaSegment("Vi\u200Bsite\u2060", "x")).toBe("Visite");
  });

  it("supprime les contrôles, les moitiés de paire orphelines et les non-caractères", () => {
    expect(sanitizeFsaSegment("a\u0000b\u001fc\u007fd", "x")).toBe("abcd");
    expect(sanitizeFsaSegment("ab\uD800cd", "x")).toBe("abcd");
    expect(sanitizeFsaSegment("ab\uDC00", "x")).toBe("ab");
    expect(sanitizeFsaSegment("a\uFFFFb\uFDD0c", "x")).toBe("abc");
  });

  it("garde une vraie paire de substitution entière", () => {
    expect(sanitizeFsaSegment("a\u{1F600}b", "x")).toBe("a\u{1F600}b");
  });

  it("remplace retours à la ligne et tabulations par une espace (ils séparent des mots)", () => {
    expect(sanitizeFsaSegment("Agence\nDupont", "x")).toBe("Agence Dupont");
    expect(sanitizeFsaSegment("a\t\tb", "x")).toBe("a b");
    expect(sanitizeFsaSegment("a\r\nb", "x")).toBe("a b");
  });

  it("remplace les caractères interdits par « _ »", () => {
    expect(sanitizeFsaSegment('a"b*c/d:e<f>g?h\\i|j', "x")).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFsaSegment("Cuisine/Salon", "x")).toBe("Cuisine_Salon");
  });

  it("réduit les espaces, y compris insécables", () => {
    expect(sanitizeFsaSegment("a    b", "x")).toBe("a b");
    expect(sanitizeFsaSegment("a \u00A0 b", "x")).toBe("a b");
    expect(sanitizeFsaSegment("a \u200B b", "x")).toBe("a b");
  });
});

describe("sanitizeFsaSegment — extrémités", () => {
  it("retire espaces, points et « ~ » aux deux bouts", () => {
    expect(sanitizeFsaSegment("  .. nom ~ .. ", "x")).toBe("nom");
    expect(sanitizeFsaSegment("~tilde~", "x")).toBe("tilde");
    expect(sanitizeFsaSegment(".hidden", "x")).toBe("hidden");
    expect(sanitizeFsaSegment("fin.", "x")).toBe("fin");
  });

  it("garde points et « ~ » à l'intérieur", () => {
    expect(sanitizeFsaSegment("a.b~c", "x")).toBe("a.b~c");
    expect(sanitizeFsaSegment("v1.2 final", "x")).toBe("v1.2 final");
  });

  it("ne bascule pas en temps quadratique sur une suite de points", () => {
    const started = Date.now();
    expect(sanitizeFsaSegment(`a${".".repeat(200_000)}`, "x")).toBe("a");
    expect(sanitizeFsaSegment(`${" .".repeat(100_000)}a`, "x")).toBe("x");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("sanitizeFsaSegment — repli", () => {
  it("renvoie le repli quand il ne reste rien", () => {
    for (const empty of [null, undefined, "", "   ", ".", "..", "...", " . ", "~", "\u200D\uFEFF", "\u0000"]) {
      expect(sanitizeFsaSegment(empty, "Export"), JSON.stringify(empty)).toBe("Export");
    }
    expect(sanitizeFsaSegment("...", "@sarah.immo")).toBe("@sarah.immo");
  });

  it("assainit aussi le repli", () => {
    expect(sanitizeFsaSegment("", "a/b")).toBe("a_b");
    expect(sanitizeFsaSegment("", "con")).toBe("_con");
  });

  it("un repli vide est rendu tel quel, un repli inutilisable devient « _ »", () => {
    expect(sanitizeFsaSegment("...", "")).toBe("");
    expect(sanitizeFsaSegment("...", "...")).toBe("_");
  });
});

describe("sanitizeFsaSegment — noms réservés", () => {
  it.each([
    ["con", "_con"],
    ["CON", "_CON"],
    ["Aux", "_Aux"],
    ["aux.mp4", "_aux.mp4"],
    ["Aux. Coulisses", "_Aux. Coulisses"],
    ["nul.tar.gz", "_nul.tar.gz"],
    ["prn", "_prn"],
    ["COM1", "_COM1"],
    ["com9.txt", "_com9.txt"],
    ["COM0", "_COM0"],
    ["lpt3", "_lpt3"],
    ["LPT9.log", "_LPT9.log"],
    ["clock$", "_clock$"],
    ["CONIN$", "_CONIN$"],
    ["conout$.log", "_conout$.log"],
    ["COM¹", "_COM¹"],
    ["aux .txt", "_aux .txt"],
    ["con.", "_con"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeFsaSegment(input, "x")).toBe(expected);
  });

  it("laisse les noms qui ne font que commencer comme un nom réservé", () => {
    for (const name of ["console", "auxiliaire", "com10", "com", "lpt", "confidentiel.mp4", "a.aux", "my con", "nullité"]) {
      expect(sanitizeFsaSegment(name, "x"), name).toBe(name);
    }
  });

  it("préfixe desktop.ini et thumbs.db (nom entier, sans casse)", () => {
    expect(sanitizeFsaSegment("desktop.ini", "x")).toBe("_desktop.ini");
    expect(sanitizeFsaSegment("Thumbs.DB", "x")).toBe("_Thumbs.DB");
    expect(sanitizeFsaSegment("my-desktop.ini", "x")).toBe("my-desktop.ini");
    expect(sanitizeFsaSegment("desktop.ini.txt", "x")).toBe("desktop.ini.txt");
  });

  it("suffixe les extensions que Windows exécute (.lnk .scf .url .local)", () => {
    expect(sanitizeFsaSegment("raccourci.lnk", "x")).toBe("raccourci.lnk_");
    expect(sanitizeFsaSegment("Lien.URL", "x")).toBe("Lien.URL_");
    expect(sanitizeFsaSegment("x.scf", "x")).toBe("x.scf_");
    expect(sanitizeFsaSegment("x.local", "x")).toBe("x.local_");
    expect(sanitizeFsaSegment("x.lnk.txt", "x")).toBe("x.lnk.txt");
    expect(sanitizeFsaSegment("lnk", "x")).toBe("lnk");
  });
});

describe("sanitizeFsaSegment — invariants (fuzz déterministe)", () => {
  const ALPHABET = [
    "a", "B", "é", "e\u0301", "😀", "\u{1F468}\u200D\u{1F469}", "\uD800", "\uDC00", " ", " ", ".", "~", "/", "\\",
    ":", "*", "?", '"', "<", ">", "|", "\u200D", "\uFEFF", "\u200E", "\u0000", "\n", "\t", "\u00A0", "\uFFFF",
    "aux", "con", "nul", "com1", "lpt2", "clock$", "conin$", "desktop.ini", "thumbs.db", ".lnk", ".url", ".scf", "_", "-", "(", ")",
  ];

  it("ne produit jamais un nom que Chrome refuserait, et reste idempotent", () => {
    const random = prng(20261006);
    for (let i = 0; i < 4000; i += 1) {
      const length = Math.floor(random() * 12);
      let raw = "";
      for (let j = 0; j < length; j += 1) raw += ALPHABET[Math.floor(random() * ALPHABET.length)];

      const out = sanitizeFsaSegment(raw, "Export");
      const context = JSON.stringify(raw);

      expect(out.length, context).toBeGreaterThan(0);
      expect(out, context).not.toMatch(/["*/:<>?\\|]/);
      expect(out, context).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/u);
      expect(out, context).not.toMatch(/^[ .~]|[ .~]$/);
      expect(out, context).not.toMatch(/\s{2,}|[^\S ]/);
      expect(out, context).toBe(out.normalize("NFC"));

      const head = out.split(".")[0].trimEnd().toLowerCase();
      expect(head, context).not.toMatch(/^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/);
      expect(out.toLowerCase(), context).not.toMatch(/^(desktop\.ini|thumbs\.db)$/);
      expect(out, context).not.toMatch(/\.(lnk|scf|url|local)$/i);

      expect(sanitizeFsaSegment(out, "Export"), context).toBe(out);
    }
  });
});

describe("cleanFsaText", () => {
  it("nettoie les caractères mais laisse les noms réservés (le nom entier décide)", () => {
    expect(cleanFsaText("aux")).toBe("aux");
    expect(cleanFsaText("desktop.ini")).toBe("desktop.ini");
    expect(cleanFsaText(" a/b ")).toBe("a_b");
    expect(cleanFsaText(null)).toBe("");
    expect(cleanFsaText("...")).toBe("");
  });

  it("borne le coût d'une entrée démesurée", () => {
    expect(cleanFsaText("a".repeat(1_000_000)).length).toBeLessThanOrEqual(1024);
  });
});

describe("sanitizeFsaFileName", () => {
  it("révèle un nom réservé seulement sur le nom entier", () => {
    expect(sanitizeFsaFileName("aux", "mp4", "fichier")).toEqual({ stem: "_aux", ext: "mp4" });
    expect(sanitizeFsaFileName("Aux. Coulisses", "mov", "fichier")).toEqual({ stem: "_Aux. Coulisses", ext: "mov" });
    expect(sanitizeFsaFileName("desktop", "ini", "fichier")).toEqual({ stem: "_desktop", ext: "ini" });
    expect(sanitizeFsaFileName("Thumbs", "db", "fichier")).toEqual({ stem: "_Thumbs", ext: "db" });
  });

  it("neutralise l'extension d'un raccourci", () => {
    expect(sanitizeFsaFileName("Rapport", "lnk", "fichier")).toEqual({ stem: "Rapport", ext: "lnk_" });
  });

  it("nettoie le radical avant de lui coller l'extension", () => {
    expect(sanitizeFsaFileName("Intro. ", "mov", "fichier")).toEqual({ stem: "Intro", ext: "mov" });
    expect(sanitizeFsaFileName("a/b", "mp4", "fichier")).toEqual({ stem: "a_b", ext: "mp4" });
  });

  it("réduit l'extension à des lettres, chiffres, « _ » et « - »", () => {
    expect(sanitizeFsaFileName("clip", "m:p4", "fichier").ext).toBe("mp4");
    expect(sanitizeFsaFileName("clip", " mp 4 ", "fichier").ext).toBe("mp4");
    expect(sanitizeFsaFileName("clip", "***", "fichier")).toEqual({ stem: "clip", ext: "" });
    expect(sanitizeFsaFileName("clip", "", "fichier")).toEqual({ stem: "clip", ext: "" });
    expect(sanitizeFsaFileName("clip", null, "fichier")).toEqual({ stem: "clip", ext: "" });
  });

  it("repli quand le radical est vide", () => {
    expect(sanitizeFsaFileName("", "mp4", "fichier")).toEqual({ stem: "fichier", ext: "mp4" });
    expect(sanitizeFsaFileName("...", "mp4", "fichier")).toEqual({ stem: "fichier", ext: "mp4" });
    expect(sanitizeFsaFileName(null, null, "fichier")).toEqual({ stem: "fichier", ext: "" });
  });

  it("garde un radical qui contient des points", () => {
    expect(sanitizeFsaFileName("my.video.final", "mov", "fichier")).toEqual({ stem: "my.video.final", ext: "mov" });
  });
});

describe("nameKey", () => {
  it("ignore la casse", () => {
    expect(nameKey("Sarah")).toBe(nameKey("sarah"));
    expect(nameKey("SARAH")).toBe(nameKey("sarah"));
    expect(nameKey("É")).toBe(nameKey("é"));
  });

  it("ignore la forme Unicode (APFS)", () => {
    expect(nameKey("Café")).toBe(nameKey("Cafe\u0301"));
  });

  it("replie ß et ı comme le font les systèmes de fichiers", () => {
    expect(nameKey("Straße")).toBe(nameKey("STRASSE"));
    expect(nameKey("ı")).toBe(nameKey("I"));
  });

  it("garde distincts des noms qui le sont", () => {
    expect(nameKey("Sarah")).not.toBe(nameKey("Sara"));
    expect(nameKey("a b")).not.toBe(nameKey("ab"));
    expect(nameKey("Sarah (2)")).not.toBe(nameKey("Sarah"));
  });
});

describe("splitExtension", () => {
  it.each([
    ["rush-01.mov", "rush-01", "mov"],
    ["IMG_0123.MOV", "IMG_0123", "MOV"],
    ["archive.tar.gz", "archive.tar", "gz"],
    ["README", "README", ""],
    ["", "", ""],
    ["fichier.", "fichier.", ""],
    [".", ".", ""],
    ["..", "..", ""],
  ])("%j → radical %j, extension %j", (input, stem, ext) => {
    expect(splitExtension(input)).toEqual({ stem, ext });
  });

  it("un nom commençant par un point n'a pas d'extension", () => {
    expect(splitExtension(".bashrc")).toEqual({ stem: ".bashrc", ext: "" });
    expect(splitExtension("..hidden")).toEqual({ stem: "..hidden", ext: "" });
  });

  it("mais les points de tête ne cachent pas une vraie extension (fichiers de ressources macOS)", () => {
    expect(splitExtension("._IMG_0001.MOV")).toEqual({ stem: "._IMG_0001", ext: "MOV" });
  });

  it("n'appelle pas extension un bout de phrase", () => {
    expect(splitExtension("Mr. Smith")).toEqual({ stem: "Mr. Smith", ext: "" });
    expect(splitExtension("2024.01.12 vacances")).toEqual({ stem: "2024.01.12 vacances", ext: "" });
    expect(splitExtension("a.uneextensiontroplongue")).toEqual({ stem: "a.uneextensiontroplongue", ext: "" });
  });
});

describe("truncateSegment", () => {
  it("ne touche pas un nom qui tient", () => {
    expect(truncateSegment("Cuisine", 40)).toBe("Cuisine");
    expect(truncateSegment("Cuisine", 7)).toBe("Cuisine");
  });

  it("tronque à la limite", () => {
    expect(truncateSegment("abcdefghij", 4)).toBe("abcd");
  });

  it("ne laisse ni point, ni espace, ni « ~ » final", () => {
    expect(truncateSegment("abc def", 4)).toBe("abc");
    expect(truncateSegment("abc.def", 4)).toBe("abc");
    expect(truncateSegment("abc~~def", 5)).toBe("abc");
    expect(truncateSegment("abc. . ~ def", 8)).toBe("abc");
    expect(truncateSegment("fin.", 10)).toBe("fin");
  });

  it("ne coupe pas un emoji en deux", () => {
    expect(truncateSegment("ab\u{1F600}cd", 3)).toBe("ab");
    expect(truncateSegment("ab\u{1F600}cd", 4)).toBe("ab\u{1F600}");
    expect(truncateSegment("\u{1F600}abc", 1)).toBe("_");
  });

  it("ne rend jamais un nom vide à partir d'un nom non vide", () => {
    expect(truncateSegment("....", 3)).toBe("_");
    expect(truncateSegment(" abc", 1)).toBe("_");
    expect(truncateSegment("", 5)).toBe("");
  });

  it("traite une limite < 1 comme 1", () => {
    expect(truncateSegment("abc", 0)).toBe("a");
    expect(truncateSegment("abc", -5)).toBe("a");
  });
});

describe("truncateFileName", () => {
  it("garde l'extension entière et tronque le radical", () => {
    expect(truncateFileName("abcdefghij", "mp4", 8)).toBe("abcd.mp4");
    expect(truncateFileName("abcdefghij", "mp4", 8)).toHaveLength(8);
  });

  it("ne touche pas un nom qui tient", () => {
    expect(truncateFileName("abc", "mp4", 50)).toBe("abc.mp4");
    expect(truncateFileName("abc", "", 50)).toBe("abc");
  });

  it("ne laisse pas de point ou d'espace avant l'extension", () => {
    expect(truncateFileName("ab. cd", "x", 5)).toBe("ab.x");
    expect(truncateFileName("abcdefgh ", "mp4", 9)).toBe("abcde.mp4");
  });

  it("garde au moins un caractère de radical, quitte à dépasser", () => {
    expect(truncateFileName("abcdef", "longextension", 5)).toBe("a.longextension");
    expect(truncateFileName("", "mp4", 20)).toBe("_.mp4");
  });

  it("sans extension, tronque le nom entier", () => {
    expect(truncateFileName("abcdef", "", 3)).toBe("abc");
  });
});

describe("plafond en octets UTF-8", () => {
  const bytes = (value: string) => new TextEncoder().encode(value).length;

  it("truncateSegment ne dépasse pas 240 octets (CJK, emojis) et ne coupe aucun caractère", () => {
    const cjk = truncateSegment("\u6f22".repeat(100), 100);
    expect(cjk).toBe("\u6f22".repeat(80));
    expect(bytes(cjk)).toBe(240);

    const emoji = truncateSegment("\u{1F600}".repeat(100), 200);
    expect(emoji).toBe("\u{1F600}".repeat(60));
    expect(bytes(emoji)).toBe(240);
  });

  it("ne touche pas un nom courant, accents compris", () => {
    expect(truncateSegment("\u00e9".repeat(100), 100)).toBe("\u00e9".repeat(100));
    expect(truncateSegment("Visite Villa \u00c9t\u00e9 2026", 40)).toBe("Visite Villa \u00c9t\u00e9 2026");
  });

  it("truncateFileName garde l'extension dans le même plafond", () => {
    const name = truncateFileName("\u6f22".repeat(100), "mov", 100);
    expect(name).toBe(`${"\u6f22".repeat(78)}.mov`);
    expect(bytes(name)).toBeLessThanOrEqual(240);
  });

  it("dedupeName avec `max` garde le suffixe dans le plafond", () => {
    const taken = new Set<string>();
    const first = dedupeName(`${"\u6f22".repeat(78)}.mov`, taken, { isFile: true, max: 100 });
    const second = dedupeName(first, taken, { isFile: true, max: 100 });
    expect(second).toBe(`${"\u6f22".repeat(77)} (2).mov`);
    expect(bytes(second)).toBeLessThanOrEqual(240);
  });
});

describe("dedupeName", () => {
  it("rend le nom tel quel s'il est libre, et le réserve", () => {
    const taken = new Set<string>();
    expect(dedupeName("Cuisine", taken)).toBe("Cuisine");
    expect(taken.has(nameKey("Cuisine"))).toBe(true);
  });

  it("numérote les homonymes, sans tenir compte de la casse", () => {
    const taken = new Set<string>();
    expect(dedupeName("Sarah", taken)).toBe("Sarah");
    expect(dedupeName("sarah", taken)).toBe("sarah (2)");
    expect(dedupeName("SARAH", taken)).toBe("SARAH (3)");
    expect(dedupeName("Sarah", taken)).toBe("Sarah (4)");
  });

  it("place le numéro AVANT l'extension d'un fichier", () => {
    const taken = new Set<string>();
    expect(dedupeName("rush.mov", taken, { isFile: true })).toBe("rush.mov");
    expect(dedupeName("rush.mov", taken, { isFile: true })).toBe("rush (2).mov");
    expect(dedupeName("RUSH.MOV", taken, { isFile: true })).toBe("RUSH (3).MOV");
    expect(dedupeName("README", taken, { isFile: true })).toBe("README");
    expect(dedupeName("README", taken, { isFile: true })).toBe("README (2)");
  });

  it("un dossier garde son « extension » : le numéro se met à la fin", () => {
    const taken = new Set<string>();
    dedupeName("Cuisine.mp4", taken);
    expect(dedupeName("Cuisine.mp4", taken)).toBe("Cuisine.mp4 (2)");
  });

  it("saute les numéros déjà pris", () => {
    const taken = new Set([nameKey("a"), nameKey("a (2)")]);
    expect(dedupeName("a", taken)).toBe("a (3)");
  });

  it("le résultat est réservé : un dossier et un fichier ne peuvent pas porter le même nom", () => {
    const taken = new Set<string>();
    expect(dedupeName("Cuisine.mp4", taken)).toBe("Cuisine.mp4");
    expect(dedupeName("cuisine.mp4", taken, { isFile: true })).toBe("cuisine (2).mp4");
  });

  it("tient dans `max`, suffixe compris", () => {
    const taken = new Set<string>();
    const long = "x".repeat(40);
    expect(dedupeName(long, taken, { max: 40 })).toBe(long);
    const second = dedupeName(long, taken, { max: 40 });
    expect(second).toHaveLength(40);
    expect(second.endsWith(" (2)")).toBe(true);

    const file = `${"y".repeat(56)}.mp4`;
    expect(dedupeName(file, taken, { isFile: true, max: 60 })).toBe(file);
    const copy = dedupeName(file, taken, { isFile: true, max: 60 });
    expect(copy).toHaveLength(60);
    expect(copy.endsWith(" (2).mp4")).toBe(true);
    expect(copy.startsWith("y".repeat(52))).toBe(true);
  });

  it("reste linéaire pour des milliers d'homonymes", () => {
    const taken = new Set<string>();
    const seen = new Set<string>();
    const started = Date.now();
    for (let i = 0; i < 10_000; i += 1) seen.add(dedupeName("video.mp4", taken, { isFile: true }));
    expect(seen.size).toBe(10_000);
    expect(seen.has("video (10000).mp4")).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reste correct si l'ensemble a été modifié entre deux appels", () => {
    const taken = new Set<string>();
    dedupeName("a", taken);
    expect(dedupeName("a", taken)).toBe("a (2)");
    taken.add(nameKey("a (3)"));
    expect(dedupeName("a", taken)).toBe("a (4)");
  });
});

import { describe, expect, it } from "vitest";
import type { EngineActiveFile, EngineProgress } from "@/lib/clientExport/downloadEngine";
import type { ExportSkipReason, ManifestFile } from "@/lib/clientExport/types";
import {
  COMMON_FOLDER_NAME,
  EMPTY_REPORT,
  computeProgressView,
  formatCount,
  formatDuration,
  formatRate,
  fullPath,
  groupByAccount,
  isExportBrowserSupported,
  plural,
  reportFromProgress,
  shortPath,
  skipReasonLabel,
  smoothRate,
} from "../exportModel";

/** Intl FR sépare les milliers par une espace fine insécable : on compare avec une espace simple. */
const plain = (text: string) => text.replace(/\s/g, " ");

function file(path: string[], size: number | null): ManifestFile {
  return { ref: `m.${path.join(".")}`, kind: "media", path, size };
}

function progress(overrides: Partial<EngineProgress> = {}): EngineProgress {
  return {
    totalFiles: 10,
    totalBytes: 1000,
    doneFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    missingFiles: 0,
    writtenBytes: 0,
    completedBytes: 0,
    active: [],
    bytesPerSecond: 0,
    ...overrides,
  };
}

function active(overrides: Partial<EngineActiveFile> = {}): EngineActiveFile {
  return { ref: "m.a", path: ["Agence", "Sarah", "a.mov"], received: 0, size: 100, phase: "downloading", ...overrides };
}

describe("formatCount / plural", () => {
  it("sépare les milliers à la française", () => {
    expect(plain(formatCount(1243))).toBe("1 243");
    expect(formatCount(12)).toBe("12");
  });

  it("garde le singulier jusqu'à 1 inclus (« 0 fichier »)", () => {
    expect(plural(0, "fichier", "fichiers")).toBe("0 fichier");
    expect(plural(1, "fichier", "fichiers")).toBe("1 fichier");
    expect(plural(2, "fichier", "fichiers")).toBe("2 fichiers");
    expect(plain(plural(1243, "fichier", "fichiers"))).toBe("1 243 fichiers");
  });
});

describe("formatRate", () => {
  it("passe par formatMaxSize (virgule FR)", () => {
    expect(formatRate(13_002_342)).toBe("12,4 Mo/s");
    expect(formatRate(0)).toBe("0 o/s");
  });

  it("ne descend jamais sous zéro", () => {
    expect(formatRate(-5)).toBe("0 o/s");
  });
});

describe("formatDuration", () => {
  it("annonce « moins d'une minute » sous 45 s", () => {
    expect(formatDuration(0)).toBe("moins d'une minute");
    expect(formatDuration(44)).toBe("moins d'une minute");
  });

  it("arrondit aux minutes", () => {
    expect(formatDuration(45)).toBe("1 min");
    expect(formatDuration(89)).toBe("1 min");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(3000)).toBe("50 min");
  });

  it("passe en heures dès 60 minutes (sans fausse précision)", () => {
    expect(formatDuration(3590)).toBe("1 h");
    expect(formatDuration(3900)).toBe("1 h 5 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(47 * 3600)).toBe("47 h");
  });

  it("se résume en jours au-delà de 48 h", () => {
    expect(formatDuration(48 * 3600)).toBe("plus de 2 jours");
    expect(formatDuration(100 * 3600)).toBe("plus de 4 jours");
  });

  it("rend une chaîne vide pour une valeur inexploitable", () => {
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });
});

describe("groupByAccount", () => {
  it("regroupe par dossier de premier niveau, en gardant l'ordre du manifeste", () => {
    const groups = groupByAccount([
      file(["Agence", "Sarah", "Behind", "a.mov"], 100),
      file(["Agence", "Paul", "Behind", "b.mov"], 50),
      file(["Agence", "Sarah", "Behind", "c.mov"], 25),
    ]);
    expect(groups.map((g) => [g.name, g.files, g.bytes])).toEqual([
      ["Sarah", 2, 125],
      ["Paul", 1, 50],
    ]);
  });

  it("range « Commun » en dernier et le marque", () => {
    const groups = groupByAccount([
      file(["Agence", COMMON_FOLDER_NAME, "Sons", "a.mp3"], 10),
      file(["Agence", "Sarah", "Behind", "a.mov"], 100),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Sarah", COMMON_FOLDER_NAME]);
    expect(groups.map((g) => g.common)).toEqual([false, true]);
  });

  it("compte pour 0 octet un fichier de taille inconnue (.xlsx)", () => {
    const [group] = groupByAccount([
      file(["Agence", "Sarah", "Fiches", "Fiches.xlsx"], null),
      file(["Agence", "Sarah", "Behind", "a.mov"], 100),
    ]);
    expect(group).toMatchObject({ name: "Sarah", files: 2, bytes: 100 });
  });

  it("range à part un chemin trop court pour contenir un compte", () => {
    const groups = groupByAccount([file(["Agence", "orphelin.mov"], 10)]);
    expect(groups.map((g) => g.name)).toEqual(["Autres fichiers"]);
  });

  it("rend une liste vide sans fichier", () => {
    expect(groupByAccount([])).toEqual([]);
  });
});

describe("skipReasonLabel", () => {
  it("traduit chaque raison du contrat", () => {
    expect(skipReasonLabel("missing")).toBe("fichier introuvable");
    expect(skipReasonLabel("not_on_r2")).toBe("vidéo indisponible");
    expect(skipReasonLabel("no_video")).toBe("vidéo indisponible");
    expect(skipReasonLabel("image_post")).toBe("publication image");
  });

  it("ne montre jamais « undefined » pour une raison inconnue", () => {
    expect(skipReasonLabel("nouvelle_raison" as ExportSkipReason)).toBe("indisponible");
  });
});

describe("shortPath / fullPath", () => {
  const path = ["Agence", "Sarah", "Behind the scene", "Cuisine", "rush-01.mov"];

  it("garde la fin du chemin", () => {
    expect(shortPath(path)).toBe("Cuisine / rush-01.mov");
    expect(shortPath(["Agence", "a.mov"])).toBe("Agence / a.mov");
  });

  it("retire le dossier racine du chemin complet", () => {
    expect(fullPath(path)).toBe("Sarah / Behind the scene / Cuisine / rush-01.mov");
  });
});

describe("computeProgressView", () => {
  it("ajoute aux fichiers terminés la part déjà reçue des fichiers en cours", () => {
    const view = computeProgressView(
      progress({
        completedBytes: 100,
        active: [
          active({ received: 50, size: 200 }),
          active({ ref: "m.b", received: 80, size: 80, phase: "finalizing" }),
        ],
      }),
      0,
    );
    expect(view.doneBytes).toBe(230);
    expect(view.fraction).toBeCloseTo(0.23);
  });

  it("ignore les fichiers de taille inconnue (absents du total)", () => {
    const view = computeProgressView(progress({ completedBytes: 100, active: [active({ received: 999, size: null })] }), 0);
    expect(view.doneBytes).toBe(100);
  });

  it("ne compte jamais plus que la taille attendue d'un fichier", () => {
    const view = computeProgressView(progress({ active: [active({ received: 500, size: 200 })] }), 0);
    expect(view.doneBytes).toBe(200);
  });

  it("plafonne au total et à 100 %", () => {
    const view = computeProgressView(progress({ completedBytes: 990, active: [active({ received: 100, size: 100 })] }), 0);
    expect(view.doneBytes).toBe(1000);
    expect(view.fraction).toBe(1);
  });

  it("se rabat sur les fichiers quand aucune taille n'est connue", () => {
    const view = computeProgressView(progress({ totalBytes: 0, totalFiles: 4, doneFiles: 1 }), 0);
    expect(view.fraction).toBe(0.25);
  });

  it("estime le temps restant d'après le débit fourni", () => {
    const view = computeProgressView(progress({ completedBytes: 230 }), 10);
    expect(view.etaSeconds).toBe(77);
  });

  it("n'annonce aucune estimation sans débit ni octets restants", () => {
    expect(computeProgressView(progress({ completedBytes: 100 }), 0).etaSeconds).toBeNull();
    expect(computeProgressView(progress({ completedBytes: 1000 }), 50).etaSeconds).toBeNull();
  });
});

describe("smoothRate", () => {
  it("prend le premier échantillon tel quel", () => {
    expect(smoothRate(null, 500)).toBe(500);
  });

  it("amortit les variations brusques", () => {
    expect(smoothRate(10, 20)).toBeCloseTo(12);
    expect(smoothRate(10, 20, 0.5)).toBeCloseTo(15);
  });

  it("décroît quand le débit tombe à zéro (blocage)", () => {
    let rate: number | null = 100;
    for (let i = 0; i < 20; i++) rate = smoothRate(rate, 0);
    expect(rate).toBeLessThan(2);
  });
});

describe("reportFromProgress", () => {
  it("rend un bilan vide sans progression", () => {
    expect(reportFromProgress(null)).toEqual(EMPTY_REPORT);
  });

  it("reprend les compteurs de la progression", () => {
    expect(
      reportFromProgress(
        progress({ doneFiles: 7, writtenBytes: 700, skippedFiles: 2, failedFiles: 1, missingFiles: 3 }),
      ),
    ).toEqual({ files: 7, bytes: 700, skipped: 2, failed: 1, missing: 3 });
  });
});

describe("isExportBrowserSupported", () => {
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const SAFARI_IPAD =
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

  it("accepte Chrome ou Edge sur ordinateur", () => {
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: CHROME_MAC })).toBe(true);
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: CHROME_MAC, uaDataMobile: false })).toBe(true);
  });

  it("refuse un navigateur sans showDirectoryPicker (Safari, Firefox, Brave par défaut)", () => {
    expect(isExportBrowserSupported({ hasDirectoryPicker: false, userAgent: CHROME_MAC })).toBe(false);
  });

  it("refuse le mobile, par userAgentData ou par user-agent", () => {
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: CHROME_MAC, uaDataMobile: true })).toBe(false);
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: CHROME_ANDROID })).toBe(false);
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: SAFARI_IPHONE })).toBe(false);
    expect(isExportBrowserSupported({ hasDirectoryPicker: true, userAgent: SAFARI_IPAD })).toBe(false);
  });
});

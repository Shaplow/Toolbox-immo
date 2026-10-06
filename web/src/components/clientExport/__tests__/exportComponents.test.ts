/**
 * Rendu serveur des composants de la page publique : vérifie les textes et les
 * actions que voit le visiteur dans chaque état. Pas de DOM ici (vitest tourne
 * en node) : ce qui dépend d'un clic ou d'un effet — sélecteur de dossier,
 * Wake Lock — n'est donc pas couvert.
 */

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EngineProgress, EngineResult } from "@/lib/clientExport/downloadEngine";
import type { ExportManifest, ExportReport } from "@/lib/clientExport/types";
import { ExportAdvice } from "../ExportAdvice";
import { ExportDownloader } from "../ExportDownloader";
import { ExportProgressCard } from "../ExportProgressCard";
import { AccountDetailCard, ExportRecap, ExportSkippedList, SkippedDetailCard } from "../ExportRecap";
import { ExportResultCard } from "../ExportResultCard";
import { ExportSession } from "../ExportSession";
import { ExportErrorCard, ExportLoadingCard, ExportUnsupportedCard } from "../ExportStateCards";
import { LinkUnavailableCard } from "../LinkUnavailableCard";
import { groupByAccount } from "../exportModel";

const TOKEN = "b".repeat(64);
const GIB = 1024 ** 3;
const noop = () => {};

/** Texte visible : balises retirées, entités décodées, espaces (dont insécables) ramenés à une seule. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function render(element: ReactElement): string {
  return textOf(renderToStaticMarkup(element));
}

const MANIFEST: ExportManifest = {
  linkId: "link_1",
  clientName: "Agence Dupont",
  rootName: "Agence Dupont",
  expiresAt: "2026-10-13T12:34:00.000Z",
  files: [
    { ref: "m.1", kind: "media", path: ["Agence Dupont", "Sarah", "Behind the scene", "Cuisine", "rush-01.mov"], size: 2 * GIB },
    { ref: "m.2", kind: "media", path: ["Agence Dupont", "Paul", "Behind the scene", "rush-02.mov"], size: GIB },
    { ref: "d.1", kind: "data", path: ["Agence Dupont", "Commun", "Fiches", "Fiches.xlsx"], size: null },
  ],
  skipped: [{ label: "Sarah — Behind the scene — rush-03.mov", reason: "missing" }],
  totals: { files: 3, bytes: 3 * GIB, accounts: 3 },
};

const REPORT: ExportReport = { files: 3, bytes: 3 * GIB, skipped: 0, failed: 0, missing: 0 };

function result(overrides: Partial<EngineResult> = {}): EngineResult {
  return { reason: "done", report: REPORT, failures: [], missing: [], ...overrides };
}

function progress(overrides: Partial<EngineProgress> = {}): EngineProgress {
  return {
    totalFiles: 1243,
    totalBytes: 100 * GIB,
    doneFiles: 400,
    skippedFiles: 0,
    failedFiles: 0,
    missingFiles: 0,
    writtenBytes: 30 * GIB,
    completedBytes: 30 * GIB,
    active: [],
    bytesPerSecond: 10 * 1024 ** 2,
    ...overrides,
  };
}

describe("ExportDownloader (rendu serveur)", () => {
  const html = renderToStaticMarkup(
    createElement(ExportDownloader, { token: TOKEN, clientName: "Agence Dupont", expiresAt: MANIFEST.expiresAt }),
  );
  const text = textOf(html);

  it("affiche le client et la validité dès le premier rendu (heure de Paris)", () => {
    expect(text).toContain("Téléchargement de tes contenus");
    expect(text).toContain("Agence Dupont");
    expect(text).toContain("Lien valable jusqu'au");
    expect(text).toContain("13 octobre 2026 à 14:34");
    expect(html).toMatch(/<h1[^>]*>Agence Dupont<\/h1>/);
  });

  it("ne tranche pas sur le navigateur côté serveur (pas d'écart d'hydratation)", () => {
    expect(html).toContain('aria-busy="true"');
    expect(text).not.toContain("Ouvre ce lien dans Google Chrome");
    expect(text).not.toContain("Préparation de la liste des fichiers");
  });

  it("rappelle de ne pas partager le lien", () => {
    expect(text).toContain("Ne partage pas ce lien");
  });
});

describe("ExportUnsupportedCard", () => {
  const text = render(createElement(ExportUnsupportedCard));

  it("dit quoi faire et pourquoi", () => {
    expect(text).toContain("Ouvre ce lien dans Google Chrome ou Microsoft Edge, sur un ordinateur.");
    expect(text).toContain("Ton navigateur ne permet pas d'enregistrer un dossier complet.");
  });

  it("propose de copier le lien", () => {
    expect(text).toContain("Copier le lien");
  });
});

describe("ExportLoadingCard / ExportErrorCard", () => {
  it("annonce la préparation de la liste", () => {
    const text = render(createElement(ExportLoadingCard, { slow: false }));
    expect(text).toContain("Préparation de la liste des fichiers…");
    expect(text).not.toContain("nouvel essai");
  });

  it("explique un serveur lent", () => {
    expect(render(createElement(ExportLoadingCard, { slow: true }))).toContain("nouvel essai en cours");
  });

  it("propose de réessayer après un échec de chargement", () => {
    const text = render(createElement(ExportErrorCard, { message: "Le serveur est occupé.", onRetry: noop }));
    expect(text).toContain("Impossible de charger la liste des fichiers.");
    expect(text).toContain("Le serveur est occupé.");
    expect(text).toContain("Réessayer");
  });
});

describe("LinkUnavailableCard", () => {
  it("rend un h1 par défaut et un h2 sous l'en-tête du téléchargeur", () => {
    const props = { title: "Ce lien a expiré", description: "Demande un nouveau lien à ton interlocuteur." };
    expect(renderToStaticMarkup(createElement(LinkUnavailableCard, props))).toMatch(/<h1[^>]*>Ce lien a expiré<\/h1>/);
    expect(renderToStaticMarkup(createElement(LinkUnavailableCard, { ...props, as: "h2" }))).toMatch(
      /<h2[^>]*>Ce lien a expiré<\/h2>/,
    );
    expect(render(createElement(LinkUnavailableCard, props))).toContain("Demande un nouveau lien à ton interlocuteur.");
  });
});

describe("ExportRecap", () => {
  it("résume le volume et l'arborescence", () => {
    const text = render(createElement(ExportRecap, { manifest: MANIFEST }));
    expect(text).toContain("3 fichiers · 3 Go à télécharger");
    expect(text).toContain("Tout sera rangé dans un dossier « Agence Dupont », avec un sous-dossier par compte.");
  });

  it("garde le détail par compte replié", () => {
    const text = render(createElement(ExportRecap, { manifest: MANIFEST }));
    expect(text).toContain("Détail par compte");
    expect(text).not.toContain("partagé entre tous les comptes");
  });

  it("n'annonce pas « 0 o » quand aucune taille n'est connue", () => {
    const text = render(
      createElement(ExportRecap, {
        manifest: { ...MANIFEST, totals: { files: 2, bytes: 0, accounts: 1 } },
      }),
    );
    expect(text).toContain("2 fichiers à télécharger");
    expect(text).not.toContain("0 o");
  });

  it("signale un lien sans aucun fichier", () => {
    const text = render(
      createElement(ExportRecap, { manifest: { ...MANIFEST, files: [], totals: { files: 0, bytes: 0, accounts: 0 } } }),
    );
    expect(text).toContain("Aucun fichier n'est disponible avec ce lien.");
    expect(text).not.toContain("à télécharger");
  });
});

describe("AccountDetailCard", () => {
  it("liste chaque compte avec son volume, « Commun » en dernier", () => {
    const text = render(createElement(AccountDetailCard, { groups: groupByAccount(MANIFEST.files) }));
    expect(text).toContain("Sarah 1 fichier · 2 Go");
    expect(text).toContain("Paul 1 fichier · 1 Go");
    // Taille inconnue (.xlsx) : le nombre de fichiers seul.
    expect(text).toContain("Commun partagé entre tous les comptes 1 fichier");
    expect(text.indexOf("Paul")).toBeLessThan(text.indexOf("Commun"));
  });
});

describe("ExportSkippedList / SkippedDetailCard", () => {
  it("n'affiche rien quand tout est disponible", () => {
    expect(renderToStaticMarkup(createElement(ExportSkippedList, { skipped: [] }))).toBe("");
  });

  it("annonce le nombre de fichiers indisponibles, replié", () => {
    const text = render(createElement(ExportSkippedList, { skipped: MANIFEST.skipped }));
    expect(text).toBe("1 fichier indisponible");
  });

  it("détaille chaque fichier avec sa raison en français", () => {
    const text = render(
      createElement(SkippedDetailCard, {
        skipped: [
          { label: "Sarah — rush-03.mov", reason: "missing" },
          { label: "Sarah — Reel du 3 octobre", reason: "no_video" },
          { label: "Paul — Carrousel", reason: "image_post" },
        ],
      }),
    );
    expect(text).toContain("3 fichiers indisponibles");
    expect(text).toContain("Sarah — rush-03.mov fichier introuvable");
    expect(text).toContain("Sarah — Reel du 3 octobre vidéo indisponible");
    expect(text).toContain("Paul — Carrousel publication image");
  });
});

describe("ExportAdvice", () => {
  it("donne les quatre conseils, avec le volume réel", () => {
    const text = render(createElement(ExportAdvice, { totalBytes: 162 * GIB }));
    expect(text).toContain(
      "Crée un nouveau dossier (par exemple dans Téléchargements) et sélectionne-le : Chrome refuse Téléchargements, Bureau et Documents eux-mêmes.",
    );
    expect(text).toContain("Évite un dossier synchronisé (OneDrive, iCloud) : 162 Go partiraient dans le cloud.");
    expect(text).toContain("Prévois 162 Go libres sur ton disque.");
    expect(text).toContain(
      "Laisse cette page ouverte et visible, ordinateur branché. Si le téléchargement s'interrompt, relance-le : les fichiers déjà téléchargés ne sont pas refaits.",
    );
  });

  it("omet les deux conseils de volume quand il est inconnu", () => {
    const text = render(createElement(ExportAdvice, { totalBytes: 0 }));
    expect(text).not.toContain("synchronisé");
    expect(text).not.toContain("libres sur ton disque");
    expect(text).toContain("Crée un nouveau dossier");
    expect(text).toContain("Laisse cette page ouverte");
  });
});

describe("ExportSession (premier rendu, avant tout clic)", () => {
  const text = render(createElement(ExportSession, { token: TOKEN, manifest: MANIFEST }));

  it("montre le récapitulatif, les indisponibles et les conseils", () => {
    expect(text).toContain("3 fichiers · 3 Go à télécharger");
    expect(text).toContain("1 fichier indisponible");
    expect(text).toContain("Avant de lancer");
  });

  it("propose de choisir un dossier, sans « Reprendre » tant qu'aucun dossier n'est mémorisé", () => {
    expect(text).toContain("Choisir un dossier et télécharger");
    expect(text).not.toContain("Reprendre dans");
    expect(text).toContain("Chrome te demandera ensuite d'autoriser l'accès à ce dossier");
  });

  it("ne propose aucun lancement pour un lien sans fichier", () => {
    const empty = render(
      createElement(ExportSession, {
        token: TOKEN,
        manifest: { ...MANIFEST, files: [], totals: { files: 0, bytes: 0, accounts: 0 } },
      }),
    );
    expect(empty).toContain("Aucun fichier n'est disponible avec ce lien.");
    expect(empty).not.toContain("Choisir un dossier et télécharger");
    expect(empty).not.toContain("Avant de lancer");
  });
});

describe("ExportProgressCard", () => {
  const base = {
    stopping: false,
    connectionIssue: false,
    folderName: "Agence Dupont",
    totalFiles: 1243,
    totalBytes: 100 * GIB,
    onStop: noop,
  };

  it("montre la barre globale, les fichiers et le temps restant", () => {
    const text = render(
      createElement(ExportProgressCard, { ...base, progress: progress(), rate: 10 * 1024 ** 2 }),
    );
    expect(text).toContain("Téléchargement en cours");
    expect(text).toContain("Les fichiers arrivent dans « Agence Dupont », rangés par compte.");
    expect(text).toContain("30 Go / 100 Go · 30 %");
    expect(text).toContain("400 / 1 243 fichiers");
    expect(text).toContain("10 Mo/s · temps restant estimé : environ 1 h 59 min");
    expect(text).toContain("Arrêter");
  });

  it("compte la part déjà reçue des fichiers en cours dans la barre", () => {
    const text = render(
      createElement(ExportProgressCard, {
        ...base,
        rate: 0,
        progress: progress({
          completedBytes: 10 * GIB,
          active: [{ ref: "m.1", path: ["Agence", "Sarah", "Cuisine", "rush-01.mov"], received: GIB, size: 2 * GIB, phase: "downloading" }],
        }),
      }),
    );
    expect(text).toContain("11 Go / 100 Go · 11 %");
  });

  it("liste les fichiers en cours par la fin de leur chemin, avec reçu / taille", () => {
    const text = render(
      createElement(ExportProgressCard, {
        ...base,
        rate: 0,
        progress: progress({
          active: [
            { ref: "m.1", path: ["Agence", "Sarah", "Behind", "Cuisine", "rush-01.mov"], received: 1.5 * GIB, size: 2 * GIB, phase: "downloading" },
            { ref: "m.2", path: ["Agence", "Paul", "Behind", "rush-02.mov"], received: GIB, size: GIB, phase: "finalizing" },
          ],
        }),
      }),
    );
    expect(text).toContain("Cuisine / rush-01.mov 1,5 Go / 2 Go");
    expect(text).toContain("Behind / rush-02.mov Finalisation…");
  });

  it("n'annonce pas de temps restant tant que le débit est inconnu", () => {
    const text = render(
      createElement(ExportProgressCard, { ...base, progress: progress({ bytesPerSecond: 0 }), rate: 0 }),
    );
    expect(text).toContain("Calcul du temps restant…");
    expect(text).not.toContain("temps restant estimé");
  });

  it("s'affiche avant le premier instantané du moteur", () => {
    const text = render(createElement(ExportProgressCard, { ...base, progress: null, rate: null }));
    expect(text).toContain("0 / 1 243 fichiers");
    expect(text).toContain("Calcul du temps restant…");
  });

  it("prévient quand le serveur ne répond plus", () => {
    const text = render(
      createElement(ExportProgressCard, { ...base, progress: progress(), rate: 1, connectionIssue: true }),
    );
    expect(text).toContain("Connexion au serveur interrompue");
    expect(text).toContain("le téléchargement reprendra tout seul");
  });

  it("indique l'arrêt en cours", () => {
    const text = render(createElement(ExportProgressCard, { ...base, progress: progress(), rate: 1, stopping: true }));
    expect(text).toContain("Arrêt en cours…");
  });
});

describe("ExportResultCard", () => {
  const base = { totalFiles: 3, folderName: "Agence Dupont", busy: false, onResume: noop, onChooseFolder: noop };
  const card = (props: Parameters<typeof ExportResultCard>[0]) => render(createElement(ExportResultCard, props));

  it("terminé sans incident : bilan et aucune action", () => {
    const text = card({ ...base, result: result() });
    expect(text).toContain("Téléchargement terminé");
    expect(text).toContain("Tes fichiers sont dans le dossier « Agence Dupont », rangés par compte. Tu peux fermer cette page.");
    expect(text).toContain("Fichiers enregistrés 3 / 3");
    expect(text).toContain("Téléchargé pendant cette session 3 Go");
    expect(text).not.toContain("Reprendre");
    expect(text).not.toContain("Réessayer");
  });

  it("terminé avec des échecs : les liste et propose de les réessayer", () => {
    const text = card({
      ...base,
      result: result({
        report: { ...REPORT, files: 2, failed: 1 },
        failures: [
          { ref: "m.1", path: ["Agence Dupont", "Sarah", "Cuisine", "rush-01.mov"], error: "Le navigateur refuse ce nom de fichier." },
        ],
      }),
    });
    expect(text).toContain("Téléchargement terminé");
    expect(text).toContain("1 fichier n'a pas pu être enregistré");
    expect(text).toContain("Cuisine / rush-01.mov — Le navigateur refuse ce nom de fichier.");
    expect(text).toContain("En échec 1");
    expect(text).toContain("Réessayer les fichiers en échec");
  });

  it("terminé avec des fichiers devenus introuvables : les liste, sans bouton inutile", () => {
    const text = card({
      ...base,
      result: result({
        report: { ...REPORT, files: 2, missing: 1 },
        missing: [{ ref: "m.2", path: ["Agence Dupont", "Paul", "rush-02.mov"] }],
      }),
    });
    expect(text).toContain("1 fichier est devenu introuvable");
    expect(text).toContain("Paul / rush-02.mov");
    expect(text).toContain("prévins ton interlocuteur");
    expect(text).not.toContain("Réessayer");
    expect(text).not.toContain("Reprendre");
  });

  it("arrêté : propose de reprendre sans retélécharger", () => {
    const text = card({ ...base, result: result({ reason: "aborted", report: { ...REPORT, files: 1, bytes: GIB } }) });
    expect(text).toContain("Téléchargement arrêté");
    expect(text).toContain("Les fichiers déjà enregistrés ne seront pas téléchargés une seconde fois.");
    expect(text).toContain("Fichiers enregistrés 1 / 3");
    expect(text).toContain("Reprendre");
    expect(text).not.toContain("Choisir le dossier à nouveau");
  });

  it("disque plein : dit de libérer de la place puis de reprendre", () => {
    const text = card({ ...base, result: result({ reason: "disk_full" }) });
    expect(text).toContain("Ton disque est plein");
    expect(text).toContain("Libère de la place puis reprends");
    expect(text).toContain("Reprendre");
  });

  it("accès perdu : propose de reprendre ou de rechoisir le dossier", () => {
    const text = card({ ...base, result: result({ reason: "permission_lost" }) });
    expect(text).toContain("L'accès au dossier a été perdu");
    expect(text).toContain("Chrome a retiré l'autorisation d'écrire dans « Agence Dupont »");
    expect(text).toContain("Reprendre");
    expect(text).toContain("Choisir le dossier à nouveau");
  });

  it("lien invalide : aucune reprise possible", () => {
    const text = card({ ...base, result: result({ reason: "link_gone" }), offerChooseFolder: true });
    expect(text).toContain("Ce lien n'est plus valide");
    expect(text).toContain("Demande un nouveau lien à ton interlocuteur");
    expect(text).not.toContain("Reprendre");
    expect(text).not.toContain("Choisir le dossier à nouveau");
  });

  it("propose de rechoisir le dossier quand la reprise a échoué", () => {
    const text = card({ ...base, result: result({ reason: "aborted" }), offerChooseFolder: true });
    expect(text).toContain("Reprendre");
    expect(text).toContain("Choisir le dossier à nouveau");
  });

  it("résume une très longue liste d'échecs", () => {
    const failures = Array.from({ length: 130 }, (_, i) => ({
      ref: `m.${i}`,
      path: ["Agence Dupont", "Sarah", `rush-${i}.mov`],
      error: "Connexion interrompue pendant le téléchargement.",
    }));
    const text = card({ ...base, result: result({ report: { ...REPORT, failed: 130 }, failures }) });
    expect(text).toContain("130 fichiers n'ont pas pu être enregistrés");
    expect(text).toContain("rush-99.mov");
    expect(text).not.toContain("rush-100.mov");
    expect(text).toContain("… et 30 autres");
  });
});

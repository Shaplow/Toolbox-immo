/**
 * Règles de rétention des vidéos sous-titrées de l'Atelier.
 *
 * Une erreur ici supprime la vidéo finale d'une publication : chaque exclusion est
 * testée isolément, et les deux `where` Prisma sont figés.
 */

import { describe, expect, it } from "vitest";
import {
  CAPTION_OUTPUT_RETENTION_MS,
  CAPTION_RETENTION_COPY,
  captionActivityDate,
  captionOutputAvailableUntil,
  captionOutputKind,
  captionRetentionCutoff,
  claimGuardWhere,
  isAtelierCaptionJob,
  isPurgeCandidate,
  isSubjectToRetention,
  purgeCandidateWhere,
  type RetentionJob,
} from "../outputRetention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-07T02:00:00Z");
const KEY = "outputs/captions/u1/1772733982883/full.mp4";

function job(overrides: Partial<RetentionJob> = {}): RetentionJob {
  return {
    status: "COMPLETED",
    slotId: null,
    activeForSlot: null,
    srtFilename: "captions.json",
    outputKey: KEY,
    outputExpiredAt: null,
    lastAccessedAt: null,
    createdAt: new Date(NOW.getTime() - 61 * DAY),
    ...overrides,
  };
}

describe("activité", () => {
  it("vaut le dernier téléchargement, sinon la génération", () => {
    const createdAt = new Date("2026-08-01T10:00:00Z");
    const lastAccessedAt = new Date("2026-09-15T10:00:00Z");
    expect(captionActivityDate({ createdAt, lastAccessedAt: null })).toEqual(createdAt);
    expect(captionActivityDate({ createdAt, lastAccessedAt })).toEqual(lastAccessedAt);
  });

  it("garde la vidéo 60 jours après la dernière activité", () => {
    const lastAccessedAt = new Date("2026-09-15T10:00:00Z");
    expect(captionOutputAvailableUntil({ createdAt: new Date(0), lastAccessedAt })).toEqual(
      new Date(lastAccessedAt.getTime() + 60 * DAY),
    );
    expect(captionRetentionCutoff(NOW)).toEqual(new Date(NOW.getTime() - CAPTION_OUTPUT_RETENTION_MS));
  });
});

describe("isPurgeCandidate", () => {
  it("retient un sous-titrage de l'Atelier inactif depuis plus de 60 jours", () => {
    expect(isPurgeCandidate(job(), NOW)).toBe(true);
  });

  it("borne stricte : 60 jours pile, la vidéo reste", () => {
    expect(isPurgeCandidate(job({ createdAt: new Date(NOW.getTime() - 60 * DAY) }), NOW)).toBe(false);
    expect(isPurgeCandidate(job({ createdAt: new Date(NOW.getTime() - 60 * DAY - 1) }), NOW)).toBe(true);
  });

  it("un téléchargement récent sauve un vieux job ; un vieux téléchargement non", () => {
    expect(isPurgeCandidate(job({ lastAccessedAt: new Date(NOW.getTime() - 10 * DAY) }), NOW)).toBe(false);
    expect(isPurgeCandidate(job({ lastAccessedAt: new Date(NOW.getTime() - 61 * DAY) }), NOW)).toBe(true);
  });

  it.each([
    ["lié à une publication", { slotId: "s1" }],
    ["sous-titre actif d'une publication", { activeForSlot: { id: "s1" } }],
    ["pipeline auto (srtFilename)", { srtFilename: "auto-transcription-tx1.json" }],
    ["pipeline auto, casse différente", { srtFilename: "AUTO-tx1.json" }],
    ["pipeline auto (clé)", { srtFilename: null, outputKey: "outputs/captions/u1/1772733982883/auto.mp4" }],
    ["vidéo d'un rendu", { outputKey: "renders/r1.mp4" }],
    ["montage d'une publication", { outputKey: "publications/s1/versions/v0.mp4" }],
    ["source uploadée", { outputKey: "inputs/captions/u1/1/video.mp4" }],
    ["sous-dossier inattendu", { outputKey: "outputs/captions/u1/1772733982883/x/full.mp4" }],
    ["horodatage non numérique", { outputKey: "outputs/captions/u1/abc/full.mp4" }],
    ["clé préfixée", { outputKey: "publications/s1/outputs/captions/u1/1/full.mp4" }],
    ["clé d'un autre dossier", { outputKey: "renders/captions/u1/1/full.mp4" }],
    ["suffixe en trop", { outputKey: "outputs/captions/u1/1/full.mp4.bak" }],
    ["segment après le fichier", { outputKey: "outputs/captions/u1/1/full.mp4/x" }],
    ["segment utilisateur vide", { outputKey: "outputs/captions//1/full.mp4" }],
    ["deux segments avant l'horodatage", { outputKey: "outputs/captions/u1/x/1/full.mp4" }],
    ["horodatage vide", { outputKey: "outputs/captions/u1//full.mp4" }],
    ["extension sans point", { outputKey: "outputs/captions/u1/1/fullXmp4" }],
    ["sans clé (stockage local)", { outputKey: null }],
    ["déjà expirée", { outputExpiredAt: new Date(NOW.getTime() - DAY) }],
    ["en attente", { status: "QUEUED" }],
    ["en cours", { status: "PROCESSING" }],
  ])("exclut un job %s", (_label, overrides) => {
    expect(isPurgeCandidate(job(overrides as Partial<RetentionJob>), NOW)).toBe(false);
  });

  it.each([
    ["sans nom de fichier de sous-titres", { srtFilename: null }],
    ["un aperçu 6 s", { outputKey: "outputs/captions/u1/1772733982883/preview.mp4" }],
    ["en échec (le worker a pu écrire la vidéo)", { status: "FAILED" }],
    ["dont le fichier importé commence par « auto »", { srtFilename: "automne-visite.srt" }],
    ["à l'ancien format de clé, sans segment utilisateur", { outputKey: "outputs/captions/1773134000000/full.mp4" }],
  ])("inclut un job %s", (_label, overrides) => {
    expect(isPurgeCandidate(job(overrides as Partial<RetentionJob>), NOW)).toBe(true);
  });
});

describe("isAtelierCaptionJob", () => {
  it("vrai hors publication et hors pipeline auto, quel que soit l'âge", () => {
    expect(isAtelierCaptionJob(job({ createdAt: NOW }))).toBe(true);
    expect(isAtelierCaptionJob(job({ slotId: "s1" }))).toBe(false);
    expect(isAtelierCaptionJob(job({ srtFilename: "auto-x.json" }))).toBe(false);
    expect(isAtelierCaptionJob(job({ srtFilename: "auto-transcription-cmx1.json" }))).toBe(false);
  });
});

describe("isSubjectToRetention", () => {
  it("exige un sous-titrage de l'Atelier et une clé R2 reconnue", () => {
    expect(isSubjectToRetention(job())).toBe(true);
    expect(isSubjectToRetention(job({ outputKey: null }))).toBe(false); // stockage local
    expect(isSubjectToRetention(job({ outputKey: "outputs/captions/u1/1/auto.mp4" }))).toBe(false);
    expect(isSubjectToRetention(job({ slotId: "s1" }))).toBe(false);
  });
});

describe("captionOutputKind", () => {
  it("lit le type de rendu dans la clé", () => {
    expect(captionOutputKind(KEY)).toBe("full");
    expect(captionOutputKind("outputs/captions/u1/1/preview.mp4")).toBe("preview");
    expect(captionOutputKind("outputs/captions/u1/1/auto.mp4")).toBeNull();
    expect(captionOutputKind(null)).toBeNull();
  });
});

describe("where Prisma", () => {
  const cutoff = captionRetentionCutoff(NOW);
  const inactive = {
    OR: [{ lastAccessedAt: null, createdAt: { lt: cutoff } }, { lastAccessedAt: { lt: cutoff } }],
  };

  it("lecture : toutes les exclusions, branche NULL du nom de fichier comprise", () => {
    expect(purgeCandidateWhere(cutoff)).toEqual({
      status: { in: ["COMPLETED", "FAILED"] },
      outputExpiredAt: null,
      slotId: null,
      activeForSlot: { is: null },
      outputKey: { startsWith: "outputs/captions/" },
      NOT: [{ outputKey: { endsWith: "/auto.mp4" } }],
      AND: [
        {
          OR: [
            { srtFilename: null },
            {
              NOT: {
                AND: [
                  { srtFilename: { startsWith: "auto-", mode: "insensitive" } },
                  { srtFilename: { endsWith: ".json", mode: "insensitive" } },
                ],
              },
            },
          ],
        },
        inactive,
      ],
    });
  });

  it("réclamation : colonnes du job seulement, règle d'âge re-vérifiée", () => {
    const guard = claimGuardWhere("j1", cutoff);
    expect(guard).toEqual({
      id: "j1",
      status: { in: ["COMPLETED", "FAILED"] },
      outputExpiredAt: null,
      slotId: null,
      AND: [inactive],
    });
    expect(guard).not.toHaveProperty("activeForSlot");
  });
});

describe("textes", () => {
  it("annoncent la durée et la date", () => {
    expect(CAPTION_RETENTION_COPY.notice).toContain("60 jours");
    expect(CAPTION_RETENTION_COPY.availableUntil(new Date("2026-12-05T12:00:00Z"))).toContain("5 déc.");
    expect(CAPTION_RETENTION_COPY.expiredTooltip).toContain("relance la génération");
  });
});

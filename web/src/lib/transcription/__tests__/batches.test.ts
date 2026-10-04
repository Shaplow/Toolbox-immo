import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  batchArchiveName,
  batchLabel,
  buildZipEntryNames,
  groupJobsIntoBatches,
  isBatchDownloadFormat,
  isValidBatchId,
  jobStatusDisplay,
  mergeJobs,
  newBatchId,
  sanitizeZipStem,
  summarizeBatch,
  toTranscriptionJobSummary,
  triState,
  type TranscriptionJobSummary,
} from "../batches";

const BATCH_A = "0b9f2c1e-6a4d-4c2b-9d1e-1f2a3b4c5d6e";
const BATCH_B = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

function job(overrides: Partial<TranscriptionJobSummary> & { id: string }): TranscriptionJobSummary {
  return {
    status: "QUEUED",
    inputFilename: `${overrides.id}.mp4`,
    model: "turbo",
    language: "fr",
    languages: [],
    enableDiarization: false,
    hasDiarization: false,
    segmentCount: null,
    duration: null,
    createdAt: "2026-10-04T10:00:00.000Z",
    errorMsg: null,
    batchId: null,
    uploadedAt: null,
    isAuto: false,
    ...overrides,
  };
}

describe("isValidBatchId", () => {
  it("accepte un UUID, majuscules comprises", () => {
    expect(isValidBatchId(BATCH_A)).toBe(true);
    expect(isValidBatchId(BATCH_A.toUpperCase())).toBe(true);
  });

  it("newBatchId produit un identifiant valide", () => {
    expect(isValidBatchId(newBatchId())).toBe(true);
  });

  it("refuse tout le reste", () => {
    expect(isValidBatchId("lot-1")).toBe(false);
    expect(isValidBatchId("")).toBe(false);
    expect(isValidBatchId(42)).toBe(false);
    expect(isValidBatchId(`${BATCH_A}' OR 1=1`)).toBe(false);
  });
});

describe("toTranscriptionJobSummary", () => {
  it("sérialise les dates, neutralise un statut inconnu, dérive isAuto", () => {
    const { isAuto: _isAuto, ...rest } = job({ id: "a" });
    void _isAuto;
    const summary = toTranscriptionJobSummary({
      ...rest,
      status: "WEIRD",
      createdAt: new Date("2026-10-04T10:00:00.000Z"),
      uploadedAt: new Date("2026-10-04T10:05:00.000Z"),
      renderId: null,
      publicationVersionId: "v1",
    });
    expect(summary.status).toBe("FAILED");
    expect(summary.createdAt).toBe("2026-10-04T10:00:00.000Z");
    expect(summary.uploadedAt).toBe("2026-10-04T10:05:00.000Z");
    expect(summary.isAuto).toBe(true);
    expect(summary).not.toHaveProperty("publicationVersionId");
  });
});

describe("groupJobsIntoBatches", () => {
  it("regroupe par lot, un job hors lot formant son propre groupe", () => {
    const groups = groupJobsIntoBatches([
      job({ id: "a1", batchId: BATCH_A, createdAt: "2026-10-04T10:00:01.000Z" }),
      job({ id: "legacy", createdAt: "2026-10-01T09:00:00.000Z" }),
      job({ id: "a2", batchId: BATCH_A, createdAt: "2026-10-04T10:00:00.000Z" }),
    ]);
    expect(groups.map((group) => group.key)).toEqual([BATCH_A, "legacy"]);
    // Ordre de dépôt dans le lot.
    expect(groups[0].jobs.map((j) => j.id)).toEqual(["a2", "a1"]);
    expect(groups[0].createdAt).toBe("2026-10-04T10:00:00.000Z");
    expect(groups[0].lastActivityAt).toBe("2026-10-04T10:00:01.000Z");
    expect(groups[1].batchId).toBeNull();
  });

  it("trie les groupes du plus récent au plus ancien", () => {
    const groups = groupJobsIntoBatches([
      job({ id: "a", batchId: BATCH_A, createdAt: "2026-10-01T10:00:00.000Z" }),
      job({ id: "b", batchId: BATCH_B, createdAt: "2026-10-03T10:00:00.000Z" }),
    ]);
    expect(groups.map((group) => group.batchId)).toEqual([BATCH_B, BATCH_A]);
  });
});

describe("mergeJobs", () => {
  it("fusionne par id, la seconde liste l'emporte, tri du plus récent", () => {
    const merged = mergeJobs(
      [job({ id: "a", status: "QUEUED", createdAt: "2026-10-01T10:00:00.000Z" })],
      [
        job({ id: "a", status: "COMPLETED", createdAt: "2026-10-01T10:00:00.000Z" }),
        job({ id: "b", createdAt: "2026-10-02T10:00:00.000Z" }),
      ],
    );
    expect(merged.map((j) => [j.id, j.status])).toEqual([
      ["b", "QUEUED"],
      ["a", "COMPLETED"],
    ]);
  });
});

describe("summarizeBatch", () => {
  it("compte les états et sépare prêtes / en upload", () => {
    const summary = summarizeBatch([
      job({ id: "ready", uploadedAt: "2026-10-04T10:01:00.000Z", enableDiarization: true }),
      job({ id: "uploading" }),
      job({ id: "running", status: "PROCESSING" }),
      job({ id: "done", status: "COMPLETED" }),
      job({ id: "ko", status: "FAILED" }),
    ]);
    expect(summary).toMatchObject({
      total: 5,
      ready: 1,
      awaitingUpload: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      readyJobIds: ["ready"],
      queuedJobIds: ["ready", "uploading"],
      completedJobIds: ["done"],
      diarizationOn: 1,
      diarizationOff: 1,
      isActive: true,
    });
  });

  it("un lot entièrement terminé n'est plus actif", () => {
    expect(summarizeBatch([job({ id: "done", status: "COMPLETED" })]).isActive).toBe(false);
  });
});

describe("triState", () => {
  it("indéterminé si mélangé", () => {
    expect(triState(2, 1)).toBe("indeterminate");
    expect(triState(2, 0)).toBe(true);
    expect(triState(0, 3)).toBe(false);
    expect(triState(0, 0)).toBe(false);
  });
});

describe("jobStatusDisplay", () => {
  it("distingue prête, à relancer, envoi incomplet, annulée et échec", () => {
    expect(jobStatusDisplay(job({ id: "a", uploadedAt: "x" })).label).toBe("Prête");
    expect(jobStatusDisplay(job({ id: "r", uploadedAt: "x", errorMsg: "Envoi au moteur impossible" }))).toEqual({
      label: "À relancer",
      variant: "warning",
    });
    expect(jobStatusDisplay(job({ id: "b" })).label).toBe("Envoi incomplet");
    expect(jobStatusDisplay(job({ id: "c", status: "FAILED", errorMsg: "Annulé" })).label).toBe("Annulée");
    expect(jobStatusDisplay(job({ id: "d", status: "FAILED", errorMsg: "boom" }))).toEqual({
      label: "Échec",
      variant: "danger",
    });
  });
});

describe("batchLabel", () => {
  it("formate en Europe/Paris", () => {
    // 12:32 UTC = 14:32 à Paris (heure d'été).
    expect(batchLabel("2026-10-04T12:32:00.000Z")).toBe("Lot du 4 oct. · 14:32");
  });
});

describe("noms de fichiers", () => {
  it("garde les accents, retire extension, séparateurs et caractères interdits", () => {
    expect(sanitizeZipStem("Visite été — villa.mp4", "x")).toBe("Visite été — villa");
    expect(sanitizeZipStem("../../etc/passwd.mov", "x")).toBe("_.._etc_passwd");
    expect(sanitizeZipStem('a<b>:c"d|e?f*g.mp4', "x")).toBe("a_b__c_d_e_f_g");
    expect(sanitizeZipStem("  .mp4", "fallback")).toBe("fallback");
    expect(sanitizeZipStem(null, "fallback")).toBe("fallback");
    // Noms refusés par Windows, quelle que soit l'extension.
    expect(sanitizeZipStem("CON.mp4", "x")).toBe("_CON");
    expect(sanitizeZipStem("lpt1.mov", "x")).toBe("_lpt1");
    expect(sanitizeZipStem("Console.mp4", "x")).toBe("Console");
  });

  it("dédoublonne les homonymes sans tenir compte de la casse", () => {
    expect(buildZipEntryNames(["IMG_0001.MOV", "img_0001.mp4", "IMG_0001.MOV", null], "srt")).toEqual([
      "IMG_0001.srt",
      "img_0001 (2).srt",
      "IMG_0001 (3).srt",
      "transcription-4.srt",
    ]);
  });

  it("Content-Disposition : repli ASCII + nom UTF-8 encodé", () => {
    expect(attachmentDisposition("Visite été.srt")).toBe(
      "attachment; filename=\"Visite ete.srt\"; filename*=UTF-8''Visite%20%C3%A9t%C3%A9.srt",
    );
  });

  it("nom d'archive ASCII, daté du jour à Paris et propre au lot", () => {
    // 23:30 UTC le 4 = 01:30 à Paris le 5.
    expect(batchArchiveName(BATCH_A, new Date("2026-10-04T23:30:00.000Z"), "srt")).toBe(
      "transcriptions-2026-10-05-0b9f2c1e-srt.zip",
    );
    expect(isBatchDownloadFormat("json")).toBe(true);
    expect(isBatchDownloadFormat("chunks")).toBe(false);
  });
});

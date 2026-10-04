import { describe, expect, it } from "vitest";
import type { TranscriptionJobSummary } from "@/lib/transcription/batches";
import {
  buildWorkspaceBatches,
  canLaunchRow,
  isRowReady,
  rowDisplay,
  summarizeWorkspaceBatch,
  type TranscriptionUpload,
} from "../workspaceModel";

const LOT = "0b9f2c1e-6a4d-4c2b-9d1e-1f2a3b4c5d6e";
const OTHER_LOT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

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
    batchId: LOT,
    uploadedAt: null,
    isAuto: false,
    ...overrides,
  };
}

function upload(overrides: Partial<TranscriptionUpload> & { key: string }): TranscriptionUpload {
  return {
    batchId: LOT,
    fileName: `${overrides.key}.mp4`,
    size: 1000,
    phase: "pending",
    progress: 0,
    jobId: null,
    error: null,
    droppedAt: "2026-10-04T10:00:00.000Z",
    order: 1,
    ...overrides,
  };
}

describe("buildWorkspaceBatches", () => {
  it("un dépôt sans job serveur forme déjà son lot, en tête", () => {
    const batches = buildWorkspaceBatches(
      [job({ id: "old", batchId: OTHER_LOT, createdAt: "2026-10-01T10:00:00.000Z" })],
      [
        upload({ key: "u2", order: 2, droppedAt: "2026-10-04T10:00:00.000Z" }),
        upload({ key: "u1", order: 1, droppedAt: "2026-10-04T10:00:00.000Z" }),
      ],
    );
    expect(batches.map((batch) => batch.key)).toEqual([LOT, OTHER_LOT]);
    expect(batches[0].rows.map((row) => row.key)).toEqual(["u1", "u2"]);
  });

  it("superpose l'upload au job serveur correspondant, sans doublon", () => {
    const batches = buildWorkspaceBatches(
      [job({ id: "j1" })],
      [upload({ key: "u1", jobId: "j1", phase: "uploading", progress: 0.4 }), upload({ key: "u2", order: 2 })],
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].rows.map((row) => [row.key, row.job?.id ?? null, row.upload?.key ?? null])).toEqual([
      ["j1", "j1", "u1"],
      ["u2", null, "u2"],
    ]);
  });

  it("un upload annulé avant d'avoir créé de job disparaît", () => {
    expect(buildWorkspaceBatches([], [upload({ key: "u1", phase: "cancelled" })])).toEqual([]);
  });
});

describe("rowDisplay", () => {
  it("progression d'upload, puis prête dès la confirmation", () => {
    expect(rowDisplay({ key: "u", job: null, upload: upload({ key: "u", phase: "uploading", progress: 0.42 }) })).toMatchObject({
      label: "Envoi 42 %",
      progress: 0.42,
    });
    // Confirmé côté serveur mais pas encore rafraîchi : pas de « Upload incomplet » fugace.
    expect(
      rowDisplay({ key: "j", job: job({ id: "j" }), upload: upload({ key: "u", jobId: "j", phase: "done" }) }).label,
    ).toBe("Prête");
  });

  it("échec d'upload avec son message", () => {
    expect(rowDisplay({ key: "u", job: null, upload: upload({ key: "u", phase: "error", error: "403" }) })).toMatchObject({
      label: "Échec de l'envoi",
      variant: "danger",
      error: "403",
    });
  });

  it("vidéo remise en attente : « À relancer » avec son motif", () => {
    expect(
      rowDisplay({ key: "j", job: job({ id: "j", uploadedAt: "x", errorMsg: "RunPod indisponible" }), upload: null }),
    ).toMatchObject({ label: "À relancer", variant: "warning", error: "RunPod indisponible" });
  });

  it("job terminé, annulé ou en échec", () => {
    expect(rowDisplay({ key: "j", job: job({ id: "j", status: "COMPLETED" }), upload: null }).label).toBe("Terminée");
    expect(rowDisplay({ key: "j", job: job({ id: "j", status: "FAILED", errorMsg: "Annulé" }), upload: null })).toMatchObject({
      label: "Annulée",
      error: null,
    });
    expect(rowDisplay({ key: "j", job: job({ id: "j", status: "FAILED", errorMsg: "GPU" }), upload: null }).error).toBe(
      "GPU",
    );
  });
});

describe("prête / lançable", () => {
  it("une vidéo en upload n'est ni prête ni lançable", () => {
    const row = { key: "j", job: job({ id: "j" }), upload: upload({ key: "u", jobId: "j", phase: "uploading" }) };
    expect(isRowReady(row)).toBe(false);
    expect(canLaunchRow(row)).toBe(false);
  });

  it("upload confirmé : prête ; job hérité sans confirmation : lançable (le serveur revérifie)", () => {
    expect(isRowReady({ key: "j", job: job({ id: "j", uploadedAt: "x" }), upload: null })).toBe(true);
    const legacy = { key: "j", job: job({ id: "j" }), upload: null };
    expect(isRowReady(legacy)).toBe(false);
    expect(canLaunchRow(legacy)).toBe(true);
  });
});

describe("summarizeWorkspaceBatch", () => {
  it("compte uploads, prêtes, en cours, terminées, échecs", () => {
    const [batch] = buildWorkspaceBatches(
      [
        job({ id: "ready", uploadedAt: "x", enableDiarization: true }),
        job({ id: "uploading" }),
        job({ id: "running", status: "PROCESSING" }),
        job({ id: "done", status: "COMPLETED" }),
        job({ id: "cancelled", status: "FAILED", errorMsg: "Annulé" }),
      ],
      [
        upload({ key: "u-up", jobId: "uploading", phase: "uploading" }),
        upload({ key: "u-pending", order: 2 }),
        upload({ key: "u-err", order: 3, phase: "error", error: "boom" }),
      ],
    );
    const summary = summarizeWorkspaceBatch(batch, true);
    expect(summary).toMatchObject({
      total: 7,
      uploading: 2,
      ready: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      uploadErrors: 1,
      configurable: true,
      isActive: true,
    });
    // ready (on) + uploading (off) + pending, qui suit le réglage du lot (on).
    expect(summary.diarization).toBe("indeterminate");
  });

  it("le réglage du lot s'applique aux fichiers pas encore préparés", () => {
    const [batch] = buildWorkspaceBatches([], [upload({ key: "u1" }), upload({ key: "u2", order: 2 })]);
    expect(summarizeWorkspaceBatch(batch, true).diarization).toBe(true);
    expect(summarizeWorkspaceBatch(batch, false).diarization).toBe(false);
  });

  it("lot terminé : plus rien à régler ni à lancer", () => {
    const [batch] = buildWorkspaceBatches([job({ id: "done", status: "COMPLETED" })], []);
    expect(summarizeWorkspaceBatch(batch, false)).toMatchObject({ configurable: false, isActive: false, completed: 1 });
  });
});

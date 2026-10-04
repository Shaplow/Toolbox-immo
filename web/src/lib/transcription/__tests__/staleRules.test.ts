import { describe, expect, it } from "vitest";
import {
  DISPATCH_STALL_MS,
  LOCAL_PROCESSING_STALL_MS,
  READY_JOB_TTL_MS,
  SWEEP_UPLOAD_STALL_MS,
  UPLOAD_STALL_MS,
  classifyPreSubmitJob,
  type PreSubmitJob,
} from "../staleRules";

const NOW = new Date("2026-10-04T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function job(overrides: Partial<PreSubmitJob>): PreSubmitJob {
  return {
    status: "QUEUED",
    runpodJobId: null,
    inputKey: "transcription/u1/1-abc/source.mp4",
    uploadedAt: null,
    updatedAt: NOW,
    renderId: null,
    publicationVersionId: null,
    ...overrides,
  };
}

const MINUTE = 60 * 1000;

describe("classifyPreSubmitJob", () => {
  it("un job confié à RunPod n'est jamais concerné", () => {
    expect(classifyPreSubmitJob(job({ runpodJobId: "rp-1", updatedAt: ago(30 * 24 * 60 * MINUTE) }), NOW)).toEqual({
      stale: false,
    });
  });

  it("vidéo PRÊTE : survit à la préparation d'un lot, expire au bout de 7 jours", () => {
    const ready = { uploadedAt: ago(2 * 60 * MINUTE) };
    expect(classifyPreSubmitJob(job({ ...ready, updatedAt: ago(2 * 60 * MINUTE) }), NOW).stale).toBe(false);
    expect(classifyPreSubmitJob(job({ ...ready, updatedAt: ago(READY_JOB_TTL_MS + MINUTE) }), NOW)).toEqual({
      stale: true,
      reason: "never_launched",
      requeue: false,
    });
  });

  it("upload jamais confirmé : à vérifier après 15 min (10 min pour le sweep)", () => {
    expect(classifyPreSubmitJob(job({ updatedAt: ago(UPLOAD_STALL_MS - MINUTE) }), NOW).stale).toBe(false);
    expect(classifyPreSubmitJob(job({ updatedAt: ago(UPLOAD_STALL_MS + MINUTE) }), NOW)).toMatchObject({
      reason: "upload_abandoned",
    });
    expect(
      classifyPreSubmitJob(job({ updatedAt: ago(SWEEP_UPLOAD_STALL_MS + MINUTE) }), NOW, {
        uploadStallMs: SWEEP_UPLOAD_STALL_MS,
      }),
    ).toMatchObject({ reason: "upload_abandoned" });
  });

  it("QUEUED du pipeline auto : envoi raté au bout de 30 min, jamais remis en attente", () => {
    const auto = { publicationVersionId: "v1" };
    expect(classifyPreSubmitJob(job({ ...auto, updatedAt: ago(20 * MINUTE) }), NOW).stale).toBe(false);
    expect(classifyPreSubmitJob(job({ ...auto, updatedAt: ago(DISPATCH_STALL_MS + MINUTE) }), NOW)).toEqual({
      stale: true,
      reason: "dispatch_interrupted",
      requeue: false,
    });
  });

  it("PROCESSING sans runpodJobId : 30 min de marge pour un démarrage de pod", () => {
    const processing = { status: "PROCESSING", uploadedAt: ago(40 * MINUTE) };
    expect(classifyPreSubmitJob(job({ ...processing, updatedAt: ago(20 * MINUTE) }), NOW).stale).toBe(false);
    // Dépôt standalone déjà uploadé : remis en attente plutôt que perdu.
    expect(classifyPreSubmitJob(job({ ...processing, updatedAt: ago(DISPATCH_STALL_MS + MINUTE) }), NOW)).toEqual({
      stale: true,
      reason: "dispatch_interrupted",
      requeue: true,
    });
    // Pipeline auto : FAILED comme avant.
    expect(
      classifyPreSubmitJob(job({ ...processing, renderId: "r1", updatedAt: ago(DISPATCH_STALL_MS + MINUTE) }), NOW),
    ).toMatchObject({ requeue: false });
  });

  it("moteur local (USE_RUNPOD=false) : un job auto PROCESSING n'est pas tué à 30 min", () => {
    const auto = { status: "PROCESSING", renderId: "r1", updatedAt: ago(2 * 60 * MINUTE) };
    expect(classifyPreSubmitJob(job(auto), NOW).stale).toBe(true);
    expect(classifyPreSubmitJob(job(auto), NOW, { localEngine: true }).stale).toBe(false);
  });

  it("mode local : une longue transcription vit jusqu'à 6 h", () => {
    const local = { status: "PROCESSING", inputKey: "local/transcription/u1/1-abc/source.mp4" };
    expect(classifyPreSubmitJob(job({ ...local, updatedAt: ago(2 * 60 * MINUTE) }), NOW).stale).toBe(false);
    expect(classifyPreSubmitJob(job({ ...local, updatedAt: ago(LOCAL_PROCESSING_STALL_MS + MINUTE) }), NOW)).toMatchObject({
      reason: "dispatch_interrupted",
      requeue: false,
    });
  });
});

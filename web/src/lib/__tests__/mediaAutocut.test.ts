import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockJobUpdateMany = vi.fn();
const mockJobDeleteMany = vi.fn();
const mockBatchUpdateMany = vi.fn();
const mockBatchFindMany = vi.fn();
const mockBatchDeleteMany = vi.fn();
const mockNotifyAll = vi.fn();
const mockResolvePhase = vi.fn();

const tx = {
  mediaAutocutJob: { updateMany: (...a: unknown[]) => mockJobUpdateMany(...a) },
  mediaAutocutBatch: { updateMany: (...a: unknown[]) => mockBatchUpdateMany(...a) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    mediaAutocutJob: {
      updateMany: (...a: unknown[]) => mockJobUpdateMany(...a),
      deleteMany: (...a: unknown[]) => mockJobDeleteMany(...a),
    },
    mediaAutocutBatch: {
      findMany: (...a: unknown[]) => mockBatchFindMany(...a),
      updateMany: (...a: unknown[]) => mockBatchUpdateMany(...a),
      deleteMany: (...a: unknown[]) => mockBatchDeleteMany(...a),
    },
  },
}));

vi.mock("@/lib/sseStore", () => ({ notifyAll: (...a: unknown[]) => mockNotifyAll(...a) }));
vi.mock("@/lib/runpod", () => ({
  resolveRunpodJobPhase: (...a: unknown[]) => mockResolvePhase(...a),
}));

import {
  AUTOCUT_ERROR_MAX,
  AUTOCUT_JOB_STATUSES,
  explainAutocutError,
  groupAutocutFailures,
  parseCsvFilter,
  summarizeAutocutCounts,
} from "@/lib/mediaAutocut";
import {
  applyAutocutBatchResults,
  autocutFailureMessage,
  failAutocutBatch,
  reconcileAutocutJobs,
} from "@/lib/mediaAutocutServer";

beforeEach(() => {
  vi.clearAllMocks();
  mockJobUpdateMany.mockResolvedValue({ count: 0 });
  mockJobDeleteMany.mockResolvedValue({ count: 0 });
  mockBatchUpdateMany.mockResolvedValue({ count: 1 });
  mockBatchFindMany.mockResolvedValue([]);
  mockBatchDeleteMany.mockResolvedValue({ count: 0 });
});

const row = (status: string, reviewStatus: string, n: number) => ({
  status,
  reviewStatus,
  _count: { _all: n },
});

// ── summarizeAutocutCounts ───────────────────────────────────────────────────
describe("summarizeAutocutCounts", () => {
  it("ne compte comme validable que done + pending_review", () => {
    // Le bug d'origine : filtrer sur reviewStatus seul comptait ces 4 lignes
    // comme « à valider », d'où le badge 99+ sur des jobs inutilisables.
    const counts = summarizeAutocutCounts([
      row("done", "pending_review", 3),
      row("failed", "pending_review", 40),
      row("pending", "pending_review", 5),
      row("processing", "pending_review", 2),
    ]);
    expect(counts.reviewable).toBe(3);
    expect(counts.failed).toBe(40);
    expect(counts.inProgress).toBe(7);
    expect(counts.total).toBe(50);
  });

  it("sort les jobs appliqués des échecs comme des validables", () => {
    const counts = summarizeAutocutCounts([
      row("done", "applied", 12),
      row("failed", "applied", 1),
      row("done", "pending_review", 2),
    ]);
    expect(counts.applied).toBe(13);
    expect(counts.failed).toBe(0);
    expect(counts.reviewable).toBe(2);
  });

  it("ignore accepted et skipped (ni à valider, ni en échec)", () => {
    const counts = summarizeAutocutCounts([row("done", "accepted", 4)]);
    expect(counts).toMatchObject({ reviewable: 0, failed: 0, inProgress: 0, applied: 0, total: 4 });
  });

  it("retourne des zéros sur une liste vide", () => {
    expect(summarizeAutocutCounts([])).toEqual({
      reviewable: 0, failed: 0, inProgress: 0, applied: 0, total: 0,
    });
  });
});

// ── parseCsvFilter ───────────────────────────────────────────────────────────
describe("parseCsvFilter", () => {
  it("retourne null quand le param est absent ou vide", () => {
    expect(parseCsvFilter(null, AUTOCUT_JOB_STATUSES)).toBeNull();
    expect(parseCsvFilter("", AUTOCUT_JOB_STATUSES)).toBeNull();
    expect(parseCsvFilter(" , ", AUTOCUT_JOB_STATUSES)).toBeNull();
  });

  it("parse une liste CSV et tolère les espaces", () => {
    expect(parseCsvFilter("done, failed", AUTOCUT_JOB_STATUSES)).toEqual(["done", "failed"]);
  });

  it("retourne undefined (→ 400) sur une valeur hors domaine", () => {
    expect(parseCsvFilter("done,DONE", AUTOCUT_JOB_STATUSES)).toBeUndefined();
  });
});

// ── explainAutocutError ──────────────────────────────────────────────────────
describe("explainAutocutError", () => {
  it("traduit un timeout RunPod et conserve le message brut", () => {
    const { label, detail } = explainAutocutError("Pack RunPod — RunPod status: TIMED_OUT");
    expect(label).toContain("dépassé son temps d'exécution");
    expect(detail).toBe("Pack RunPod — RunPod status: TIMED_OUT");
  });

  it("distingue un gel au téléchargement d'un gel à la transcription", () => {
    const dl = explainAutocutError(
      "Téléchargement de « IMG_2787.mp4 » toujours en cours après 420s — fichier inaccessible",
    );
    const tr = explainAutocutError(
      "Analyse de « IMG_2790.mp4 » bloquée après 420s — fichier probablement illisible",
    );
    expect(dl.label).toContain("Téléchargement bloqué");
    expect(tr.label).toContain("Transcription bloquée");
    expect(dl.label).not.toBe(tr.label);
  });

  it("traduit un pack à court de temps", () => {
    expect(
      explainAutocutError("Vidéo non analysée — temps de traitement du pack épuisé (1470s).").label,
    ).toContain("manqué de temps");
  });

  it("tombe sur un libellé neutre quand le message est absent", () => {
    expect(explainAutocutError(null)).toEqual({ label: "Erreur inconnue", detail: null });
    expect(explainAutocutError("   ")).toEqual({ label: "Erreur inconnue", detail: null });
  });

  it("tronque un message brut inconnu mais garde le détail entier", () => {
    const raw = `x${"y".repeat(400)}`;
    const { label, detail } = explainAutocutError(raw);
    expect(label.length).toBeLessThanOrEqual(160);
    expect(label.endsWith("…")).toBe(true);
    expect(detail).toBe(raw);
  });
});

// ── groupAutocutFailures ─────────────────────────────────────────────────────
describe("groupAutocutFailures", () => {
  it("regroupe par cause et trie par taille décroissante", () => {
    const groups = groupAutocutFailures([
      { assetId: "a", filename: "a.mp4", errorMsg: "Aucun segment Whisper produit pour a.mp4" },
      { assetId: "b", filename: "b.mp4", errorMsg: "Pack RunPod — RunPod status: TIMED_OUT" },
      { assetId: "c", filename: "c.mp4", errorMsg: "Pack RunPod — RunPod status: TIMED_OUT" },
      { assetId: "d", filename: "d.mp4", errorMsg: "Pack RunPod — RunPod status: TIMED_OUT" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].label).toContain("dépassé son temps");
    expect(groups[1].items.map((i) => i.assetId)).toEqual(["a"]);
  });

  it("regroupe les messages absents sous une cause unique", () => {
    const groups = groupAutocutFailures([
      { assetId: "a", filename: "a.mp4", errorMsg: null },
      { assetId: "b", filename: "b.mp4", errorMsg: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Erreur inconnue");
    expect(groups[0].detail).toBeNull();
  });

  it("retourne une liste vide sans échec", () => {
    expect(groupAutocutFailures([])).toEqual([]);
  });
});

// ── autocutFailureMessage ────────────────────────────────────────────────────
describe("autocutFailureMessage", () => {
  it("préfixe et tronque à 500 caractères", () => {
    const msg = autocutFailureMessage("z".repeat(900));
    expect(msg.length).toBe(AUTOCUT_ERROR_MAX);
    expect(msg.startsWith("Pack RunPod — ")).toBe(true);
  });

  it("ne double pas le préfixe s'il est déjà présent", () => {
    expect(autocutFailureMessage("Pack RunPod — boum")).toBe("Pack RunPod — boum");
  });

  it("accepte une Error, un objet ou null", () => {
    expect(autocutFailureMessage(new Error("boum"))).toBe("Pack RunPod — boum");
    expect(autocutFailureMessage({ a: 1 })).toBe('Pack RunPod — {"a":1}');
    expect(autocutFailureMessage(null)).toBe("Pack RunPod — erreur inconnue");
  });
});

// ── failAutocutBatch ─────────────────────────────────────────────────────────
describe("failAutocutBatch", () => {
  it("bascule aussi les jobs encore pending (course avec le dispatch async)", async () => {
    mockJobUpdateMany.mockResolvedValue({ count: 10 });
    const res = await failAutocutBatch("batch1", "RunPod status: TIMED_OUT");

    expect(res.jobsFailed).toBe(10);
    const where = mockJobUpdateMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["pending", "processing"] });
    expect(where.batchId).toBe("batch1");
  });

  it("écrit le MÊME message réel sur le batch et sur ses jobs", async () => {
    await failAutocutBatch("batch1", "RunPod status: TIMED_OUT");
    const batchMsg = mockBatchUpdateMany.mock.calls[0][0].data.errorMsg;
    const jobMsg = mockJobUpdateMany.mock.calls[0][0].data.errorMsg;
    expect(batchMsg).toBe(jobMsg);
    expect(jobMsg).toContain("TIMED_OUT");
    // La constante générique d'origine ne doit plus jamais être écrite.
    expect(jobMsg).not.toBe("Échec global du job RunPod");
  });

  it("émet la notification SSE après la transaction", async () => {
    const order: string[] = [];
    mockJobUpdateMany.mockImplementation(async () => { order.push("tx"); return { count: 1 }; });
    mockNotifyAll.mockImplementation(() => { order.push("sse"); });
    await failAutocutBatch("batch1", "boum");
    expect(order).toEqual(["tx", "sse"]);
  });

  it("respecte notify:false", async () => {
    await failAutocutBatch("batch1", "boum", { notify: false });
    expect(mockNotifyAll).not.toHaveBeenCalled();
  });
});

// ── applyAutocutBatchResults ─────────────────────────────────────────────────
describe("applyAutocutBatchResults", () => {
  it("marque done les succès, failed les erreurs, et calcule partial", async () => {
    mockJobUpdateMany.mockResolvedValue({ count: 1 });
    const outcome = await applyAutocutBatchResults("b1", [
      { job_id: "j1", proposed_start: 0.4, proposed_end: 5 },
      { job_id: "j2", error: "boum" },
    ]);
    // Le dernier updateMany est le filet « orphelins », qui renvoie 1 ici aussi.
    expect(outcome.doneCount).toBe(1);
    expect(outcome.batchStatus).toBe("partial");

    const doneData = mockJobUpdateMany.mock.calls[0][0].data;
    expect(doneData.status).toBe("done");
    expect(doneData.confirmedStart).toBe(0.4);
    // Un job qui repasse done doit perdre son ancien message d'échec.
    expect(doneData.errorMsg).toBeNull();
  });

  it("passe en échec les jobs sans résultat renvoyé par le worker", async () => {
    mockJobUpdateMany.mockResolvedValue({ count: 2 });
    await applyAutocutBatchResults("b1", []);
    const orphanCall = mockJobUpdateMany.mock.calls.at(-1)![0];
    expect(orphanCall.where.status).toEqual({ in: ["pending", "processing"] });
    expect(orphanCall.data.errorMsg).toContain("Aucun résultat renvoyé par le worker");
  });

  it("marque done quand tout réussit et qu'aucun job n'est orphelin", async () => {
    mockJobUpdateMany.mockResolvedValue({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    mockJobUpdateMany.mockImplementation(async (args: { data: { status: string } }) =>
      args.data.status === "failed" ? { count: 0 } : { count: 1 },
    );
    const outcome = await applyAutocutBatchResults("b1", [{ job_id: "j1", proposed_start: 1 }]);
    expect(outcome).toMatchObject({ doneCount: 1, failCount: 0, batchStatus: "done" });
  });

  it("ne réécrit pas un job déjà validé par un admin (compare-and-swap)", async () => {
    // Rejouable par la réconciliation : sans le garde reviewStatus, une seconde
    // application remettrait le job en pending_review et écraserait les timings
    // que l'admin venait d'ajuster.
    mockJobUpdateMany.mockResolvedValue({ count: 1 });
    await applyAutocutBatchResults("b1", [
      { job_id: "j1", proposed_start: 1 },
      { job_id: "j2", error: "boum" },
    ]);
    expect(mockJobUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: "j1",
      reviewStatus: "pending_review",
    });
    expect(mockJobUpdateMany.mock.calls[1][0].where).toMatchObject({
      id: "j2",
      reviewStatus: "pending_review",
    });
  });

  it("tronque un message d'erreur worker à 500 caractères", async () => {
    mockJobUpdateMany.mockResolvedValue({ count: 1 });
    await applyAutocutBatchResults("b1", [{ job_id: "j1", error: "e".repeat(900) }]);
    expect(mockJobUpdateMany.mock.calls[0][0].data.errorMsg.length).toBe(AUTOCUT_ERROR_MAX);
  });
});

// ── reconcileAutocutJobs ─────────────────────────────────────────────────────
describe("reconcileAutocutJobs", () => {
  const cutoffs = {
    processingCutoff: new Date("2026-01-01T00:00:00Z"),
    queuedCutoff: new Date("2026-01-01T00:20:00Z"),
    failedRetentionCutoff: new Date("2025-12-25T00:00:00Z"),
  };

  it("rejoue l'output d'un batch dont le webhook s'est perdu", async () => {
    process.env.RUNPOD_ENDPOINT_ID = "ep";
    process.env.RUNPOD_API_KEY = "key";
    mockBatchFindMany
      .mockResolvedValueOnce([{ id: "b1", runpodId: "rp1", updatedAt: new Date() }])
      .mockResolvedValueOnce([]);
    mockResolvePhase.mockResolvedValue({
      phase: "completed",
      output: { batch_id: "b1", results: [{ job_id: "j1", proposed_start: 1, proposed_end: 2 }] },
    });
    mockJobUpdateMany.mockResolvedValue({ count: 1 });

    const res = await reconcileAutocutJobs(cutoffs);
    expect(res.recovered).toBe(1);
    expect(res.batchesFailed).toBe(0);
    delete process.env.RUNPOD_ENDPOINT_ID;
    delete process.env.RUNPOD_API_KEY;
  });

  it("propage le vrai message RunPod quand le job a échoué", async () => {
    process.env.RUNPOD_ENDPOINT_ID = "ep";
    process.env.RUNPOD_API_KEY = "key";
    mockBatchFindMany
      .mockResolvedValueOnce([{ id: "b1", runpodId: "rp1", updatedAt: new Date() }])
      .mockResolvedValueOnce([]);
    mockResolvePhase.mockResolvedValue({ phase: "failed", error: "OOM killed" });

    const res = await reconcileAutocutJobs(cutoffs);
    expect(res.batchesFailed).toBe(1);
    expect(mockJobUpdateMany.mock.calls[0][0].data.errorMsg).toContain("OOM killed");
    delete process.env.RUNPOD_ENDPOINT_ID;
    delete process.env.RUNPOD_API_KEY;
  });

  it("ne purge ni les jobs appliqués ni les applies en vol", async () => {
    await reconcileAutocutJobs(cutoffs);
    const where = mockJobDeleteMany.mock.calls[0][0].where;
    expect(where.status).toBe("failed");
    expect(where.reviewStatus).toEqual({ not: "applied" });
    expect(where.editJobId).toBeNull();
    expect(where.updatedAt).toEqual({ lt: cutoffs.failedRetentionCutoff });
  });

  it("fait hériter aux jobs vivants le message de leur batch déjà failed", async () => {
    mockBatchFindMany.mockResolvedValue([{ id: "b1", errorMsg: "Pack RunPod — TIMED_OUT" }]);
    mockJobUpdateMany.mockResolvedValue({ count: 4 });
    const res = await reconcileAutocutJobs(cutoffs);
    expect(res.inherited).toBe(4);
    expect(mockJobUpdateMany.mock.calls[0][0].data.errorMsg).toBe("Pack RunPod — TIMED_OUT");
  });
});

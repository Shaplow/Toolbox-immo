/**
 * expireAtelierCaptionOutputs — la purge supprime des fichiers : chaque garde est testée
 * isolément (aucune écriture en dry-run, réclamation avant suppression, clé effacée
 * seulement après R2, reprise des suppressions en attente, re-vérification JS, clé
 * partagée, disjoncteur).
 *
 * `findMany` renvoie ce que le test lui donne, quel que soit le `where` : c'est ce qui
 * permet de simuler un SQL qui laisserait passer une ligne qu'il aurait dû exclure. Les
 * `where` eux-mêmes sont figés dans lib/captions/__tests__/outputRetention.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
  updateMany: vi.fn(),
  listSizes: vi.fn(),
  deleteFromR2: vi.fn(),
  r2Configured: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { captionJob: { findMany: mocks.findMany, groupBy: mocks.groupBy, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/r2", () => ({
  r2Configured: mocks.r2Configured,
  listR2ObjectSizes: mocks.listSizes,
  deleteFromR2: mocks.deleteFromR2,
}));

import { expireAtelierCaptionOutputs } from "../expireOutputs";
import { captionRetentionCutoff, claimGuardWhere, purgeCandidateWhere } from "@/lib/captions/outputRetention";

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const NOW = new Date("2026-10-07T02:00:00.000Z");
const CUTOFF = captionRetentionCutoff(NOW);

function key(n: number, kind: "full" | "preview" = "full", user = "u1") {
  return `outputs/captions/${user}/${1_757_000_000_000 + n}/${kind}.mp4`;
}

type CandidateRow = {
  id: string;
  userId: string;
  status: string;
  slotId: string | null;
  activeForSlot: { id: string } | null;
  srtFilename: string | null;
  outputKey: string | null;
  outputExpiredAt: Date | null;
  lastAccessedAt: Date | null;
  createdAt: Date;
};

/** Un sous-titrage de l'Atelier inactif depuis 90 jours : candidat à la purge. */
function candidate(id: string, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id,
    userId: "u1",
    status: "COMPLETED",
    slotId: null,
    activeForSlot: null,
    srtFilename: "captions.json",
    outputKey: key(1),
    outputExpiredAt: null,
    lastAccessedAt: null,
    createdAt: new Date(NOW.getTime() - 90 * DAY),
    ...overrides,
  };
}

type Filter = { in?: string[]; not?: null } | null | undefined;
type Where = { status?: Filter; outputKey?: Filter; outputExpiredAt?: Filter };

type Db = {
  candidates?: CandidateRow[];
  /** Réclamées par un passage antérieur, suppression R2 pas terminée. */
  pending?: { id: string; outputKey: string }[];
  /** Clés qu'une ligne encore vivante (outputExpiredAt nul) porte. */
  held?: string[];
  /** Nombre de lignes qui portent une clé (1 par défaut). */
  holders?: Record<string, number>;
  /** QUEUED/PROCESSING plus vieux que la rétention. */
  stale?: { slotId: string | null; activeForSlot: { id: string } | null; srtFilename: string | null; outputKey: string | null }[];
};

/** Répond à chaque lecture d'après la forme de son `where`, pas d'après l'ordre des appels. */
function seed(db: Db) {
  mocks.findMany.mockImplementation(async ({ where }: { where: Where }) => {
    if (where.status?.in?.includes("QUEUED")) return db.stale ?? [];
    if (where.outputKey?.in) {
      const asked = where.outputKey.in;
      return (db.held ?? []).filter((k) => asked.includes(k)).map((outputKey) => ({ outputKey }));
    }
    if (where.outputExpiredAt && "not" in where.outputExpiredAt) return db.pending ?? [];
    return db.candidates ?? [];
  });
  mocks.groupBy.mockImplementation(async ({ where }: { where: { outputKey: { in: string[] } } }) =>
    where.outputKey.in.map((outputKey) => ({ outputKey, _count: { _all: db.holders?.[outputKey] ?? 1 } })),
  );
}

const run = (opts: Partial<{ dryRun: boolean; maxDeletes: number }> = {}) =>
  expireAtelierCaptionOutputs({ dryRun: false, maxDeletes: 500, now: NOW, ...opts });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.r2Configured.mockReturnValue(true);
  mocks.listSizes.mockResolvedValue(new Map());
  mocks.deleteFromR2.mockResolvedValue(undefined);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  seed({});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("R2 non configuré : erreur avant toute lecture, rien n'est réclamé", async () => {
    mocks.r2Configured.mockReturnValue(false);
    seed({ candidates: [candidate("j1")] });

    await expect(run()).rejects.toThrow(/R2 non configuré/);

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });
});

describe("passage à blanc", () => {
  it("rapporte candidats, volumes et répartition sans aucune écriture", async () => {
    const a = key(1, "full", "u1");
    const b = key(2, "preview", "u2");
    seed({
      candidates: [candidate("j1", { outputKey: a }), candidate("j2", { userId: "u2", outputKey: b })],
      pending: [{ id: "p1", outputKey: key(3) }],
    });
    mocks.listSizes.mockResolvedValue(new Map([[a, 70 * MB], [b, 1 * MB], [key(3), 50 * MB]]));

    // maxDeletes plus bas que le nombre de candidats : un dry-run n'est jamais refusé.
    const report = await run({ dryRun: true, maxDeletes: 1 });

    expect(report).toEqual({
      dryRun: true,
      retentionDays: 60,
      cutoff: CUTOFF.toISOString(),
      candidates: 2,
      claimed: 0,
      deleted: 0,
      pendingRetried: 0,
      pendingLeft: 1,
      skipped: { sharedKey: 0, unsafeKey: 0, race: 0 },
      errors: 0,
      nonTerminalStale: 0,
      bytes: { candidates: 71 * MB, missingInR2: 0 },
      byKind: { full: 1, preview: 1 },
      byStatus: { completed: 2, failed: 0 },
      byUser: { u1: { count: 1, bytes: 70 * MB }, u2: { count: 1, bytes: 1 * MB } },
      samples: [a, b],
      refused: null,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });

  it("répartit les candidats par statut : un FAILED sans fichier se voit dans byStatus et missingInR2", async () => {
    const present = key(1);
    const failedKey = key(2);
    seed({
      candidates: [
        candidate("j1", { outputKey: present }),
        // La clé est posée à la création du job, mais le rendu a échoué : rien sur R2.
        candidate("j2", { status: "FAILED", outputKey: failedKey }),
        candidate("j3", { status: "FAILED", outputKey: key(3) }),
      ],
    });
    mocks.listSizes.mockResolvedValue(new Map([[present, 70 * MB]]));

    const report = await run({ dryRun: true });

    expect(report.candidates).toBe(3);
    expect(report.byStatus).toEqual({ completed: 1, failed: 2 });
    expect(report.bytes).toEqual({ candidates: 70 * MB, missingInR2: 2 });
    // Les FAILED sont des candidats comme les autres : aucun filtre de statut après le SQL.
    expect(report.byUser.u1.count).toBe(3);
  });

  it("le passage réel réclame les FAILED comme les autres, et son rapport garde la même répartition", async () => {
    const present = key(1);
    const failedKey = key(2);
    seed({
      candidates: [candidate("j1", { outputKey: present }), candidate("j2", { status: "FAILED", outputKey: failedKey })],
    });
    mocks.listSizes.mockResolvedValue(new Map([[present, 70 * MB]]));

    const dry = await run({ dryRun: true });
    const real = await run();

    expect(real.byStatus).toEqual(dry.byStatus);
    expect(real.byStatus).toEqual({ completed: 1, failed: 1 });
    // Pas de fichier pour le FAILED : la suppression R2 est tentée quand même (un objet absent n'est pas une erreur).
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(failedKey);
    expect(real).toMatchObject({ candidates: 2, claimed: 2, deleted: 2, errors: 0 });
  });

  it("lit les candidats avec le where de lecture et ne liste R2 que sous outputs/captions/", async () => {
    seed({ candidates: [candidate("j1")] });

    await run({ dryRun: true });

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: purgeCandidateWhere(CUTOFF) }));
    expect(mocks.listSizes).toHaveBeenCalledWith(["outputs/captions/"]);
  });

  it("ne rapporte que 20 clés en exemple", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => candidate(`j${i}`, { outputKey: key(i) }));
    seed({ candidates: rows });

    const report = await run({ dryRun: true });

    expect(report.candidates).toBe(25);
    expect(report.samples).toEqual(rows.slice(0, 20).map((r) => r.outputKey));
  });

  it("compte les candidats dont le fichier a déjà disparu de R2", async () => {
    const present = key(1);
    const gone = key(2);
    seed({ candidates: [candidate("j1", { outputKey: present }), candidate("j2", { outputKey: gone })] });
    mocks.listSizes.mockResolvedValue(new Map([[present, 70 * MB]]));

    const report = await run({ dryRun: true });

    expect(report.bytes).toEqual({ candidates: 70 * MB, missingInR2: 1 });
    expect(report.byUser.u1).toEqual({ count: 2, bytes: 70 * MB });
  });

  it("listing R2 impossible : volumes inconnus (null), le reste du rapport est intact", async () => {
    seed({ candidates: [candidate("j1")] });
    mocks.listSizes.mockRejectedValue(new Error("R2 injoignable"));

    const report = await run({ dryRun: true });

    expect(report.bytes).toBeNull();
    expect(report.byUser).toEqual({ u1: { count: 1, bytes: null } });
    expect(report.candidates).toBe(1);
    expect(report.byKind).toEqual({ full: 1, preview: 0 });
  });

  it("compte, pour information, les sous-titrages de l'Atelier restés non terminés", async () => {
    seed({
      stale: [
        { slotId: null, activeForSlot: null, srtFilename: null, outputKey: key(1) },
        { slotId: null, activeForSlot: null, srtFilename: "captions.json", outputKey: key(2) },
        // pipeline auto (nom de fichier, ou clé) et sous-titre actif d'une publication : pas l'Atelier
        { slotId: null, activeForSlot: null, srtFilename: "auto-transcription-tx1.json", outputKey: key(3) },
        { slotId: null, activeForSlot: null, srtFilename: null, outputKey: "outputs/captions/u1/1757000000004/auto.mp4" },
        { slotId: null, activeForSlot: { id: "s1" }, srtFilename: null, outputKey: key(5) },
      ],
    });

    const report = await run({ dryRun: true });

    expect(report.nonTerminalStale).toBe(2);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["QUEUED", "PROCESSING"] }, slotId: null, createdAt: { lt: CUTOFF } },
      }),
    );
  });
});

describe("passage réel", () => {
  it("réclame la ligne, puis supprime l'objet R2, puis seulement alors efface la clé", async () => {
    const outputKey = key(1);
    seed({ candidates: [candidate("j1", { outputKey })] });
    mocks.listSizes.mockResolvedValue(new Map([[outputKey, 70 * MB]]));

    const report = await run();

    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    // Garde de réclamation : colonnes du job + règle d'âge relue + clé validée.
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: { ...claimGuardWhere("j1", CUTOFF), outputKey },
      data: { outputExpiredAt: NOW, outputUrl: null },
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(outputKey);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "j1", outputKey },
      data: { outputKey: null },
    });

    const [claim, clear] = mocks.updateMany.mock.invocationCallOrder;
    const [remove] = mocks.deleteFromR2.mock.invocationCallOrder;
    expect(claim).toBeLessThan(remove);
    expect(remove).toBeLessThan(clear);

    expect(report).toMatchObject({
      dryRun: false,
      candidates: 1,
      claimed: 1,
      deleted: 1,
      pendingRetried: 0,
      pendingLeft: 0,
      errors: 0,
      skipped: { sharedKey: 0, unsafeKey: 0, race: 0 },
      bytes: { candidates: 70 * MB, missingInR2: 0 },
      refused: null,
    });
  });

  it("un téléchargement arrivé entre la lecture et la réclamation gagne : rien n'est supprimé", async () => {
    seed({ candidates: [candidate("j1")] });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const report = await run();

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(report).toMatchObject({ candidates: 1, claimed: 0, deleted: 0, skipped: { race: 1 }, pendingLeft: 0 });
  });

  it("supprime un fichier déjà absent de R2 et efface la clé", async () => {
    const outputKey = key(1);
    seed({ candidates: [candidate("j1", { outputKey })] });
    mocks.listSizes.mockResolvedValue(new Map()); // absent du listing

    const report = await run();

    expect(report.bytes).toEqual({ candidates: 0, missingInR2: 1 });
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(outputKey);
    expect(report.deleted).toBe(1);
  });

  it("échec R2 : la clé reste, la ligne est en attente ; un passage ultérieur la reprend et l'efface", async () => {
    const outputKey = key(1);
    seed({ candidates: [candidate("j1", { outputKey })] });
    mocks.deleteFromR2.mockRejectedValueOnce(new Error("R2 en panne"));

    const first = await run();

    // Réclamée (la vidéo n'est plus téléchargeable), mais jamais de `outputKey: null`.
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { outputExpiredAt: NOW, outputUrl: null } }));
    expect(first).toMatchObject({ claimed: 1, deleted: 0, pendingLeft: 1, errors: 1 });

    // Plus tard : la ligne n'est plus candidate, elle est en attente.
    mocks.updateMany.mockClear();
    mocks.deleteFromR2.mockClear();
    seed({ pending: [{ id: "j1", outputKey }] });

    const second = await run();

    expect(mocks.deleteFromR2).toHaveBeenCalledWith(outputKey);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", outputKey, outputExpiredAt: { not: null } },
      data: { outputKey: null },
    });
    expect(second).toMatchObject({ candidates: 0, claimed: 0, pendingRetried: 1, pendingLeft: 0, errors: 0 });
  });

  it("échec de l'effacement de la clé après R2 : la ligne reste en attente", async () => {
    seed({ candidates: [candidate("j1")] });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 }) // réclamation
      .mockRejectedValueOnce(new Error("base indisponible")); // effacement

    const report = await run();

    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ claimed: 1, deleted: 0, pendingLeft: 1, errors: 1 });
  });

  it("réclamation en erreur : la ligne n'a pas bougé, rien n'est supprimé, les autres continuent", async () => {
    const first = key(1);
    const second = key(2);
    seed({ candidates: [candidate("j1", { outputKey: first }), candidate("j2", { outputKey: second })] });
    mocks.updateMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "j1") throw new Error("base indisponible");
      return { count: 1 };
    });

    const report = await run();

    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(second);
    expect(report).toMatchObject({ candidates: 2, claimed: 1, deleted: 1, pendingLeft: 0, errors: 1 });
  });

  it("supprime au plus 4 fichiers à la fois", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => candidate(`j${i}`, { outputKey: key(i) }));
    seed({ candidates: rows });
    let inFlight = 0;
    let peak = 0;
    mocks.deleteFromR2.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });

    const report = await run();

    expect(report.deleted).toBe(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("re-vérification JS", () => {
  it("une ligne que le SQL aurait dû exclure n'est jamais réclamée ni supprimée", async () => {
    const valid = candidate("ok", { outputKey: key(1) });
    seed({
      candidates: [
        valid,
        candidate("auto", { srtFilename: null, outputKey: "outputs/captions/u1/1757000000002/auto.mp4" }),
        candidate("slot", { status: "FAILED", slotId: "s1", outputKey: key(3) }),
        candidate("actif", { activeForSlot: { id: "s1" }, outputKey: key(4) }),
        candidate("recent", { createdAt: new Date(NOW.getTime() - 10 * DAY), outputKey: key(5) }),
        candidate("hors-forme", { outputKey: "publications/s1/versions/v0.mp4" }),
        candidate("sans-cle", { outputKey: null }),
      ],
    });

    const report = await run();

    // Une ligne refusée ne compte nulle part, même FAILED : seule « ok » est dans byStatus.
    expect(report).toMatchObject({
      candidates: 1,
      claimed: 1,
      deleted: 1,
      skipped: { unsafeKey: 6 },
      byStatus: { completed: 1, failed: 0 },
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(key(1));
    // Seule la ligne valide atteint la garde de clé partagée, et la réclamation.
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { outputKey: { in: [key(1)] } } }));
    const claimedIds = mocks.updateMany.mock.calls.map(([args]) => (args.where as { id: string }).id);
    expect(claimedIds).toEqual(["ok", "ok"]);
  });
});

describe("clé partagée", () => {
  it("une clé portée par plusieurs lignes n'est jamais réclamée ni supprimée", async () => {
    const shared = key(1);
    const alone = key(2);
    seed({
      candidates: [candidate("j1", { outputKey: shared }), candidate("j2", { outputKey: alone })],
      holders: { [shared]: 2 },
    });

    const report = await run();

    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["outputKey"],
      where: { outputKey: { in: [shared, alone] } },
      _count: { _all: true },
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(alone);
    const touchedIds = mocks.updateMany.mock.calls.map(([args]) => (args.where as { id: string }).id);
    expect(touchedIds).not.toContain("j1");
    expect(report).toMatchObject({ candidates: 1, claimed: 1, deleted: 1, skipped: { sharedKey: 1 } });
  });

  it("les clés partagées sont écartées dès le passage à blanc (candidats, volumes, exemples)", async () => {
    const shared = key(1);
    seed({ candidates: [candidate("j1", { outputKey: shared })], holders: { [shared]: 2 } });
    mocks.listSizes.mockResolvedValue(new Map([[shared, 70 * MB]]));

    const report = await run({ dryRun: true });

    expect(report).toMatchObject({
      candidates: 0,
      skipped: { sharedKey: 1 },
      bytes: { candidates: 0, missingInR2: 0 },
      byStatus: { completed: 0, failed: 0 },
      byUser: {},
      samples: [],
    });
  });
});

describe("disjoncteur", () => {
  it("plus de candidats que maxDeletes : refusé, rien n'est réclamé ni supprimé", async () => {
    seed({ candidates: [candidate("j1", { outputKey: key(1) }), candidate("j2", { outputKey: key(2) }), candidate("j3", { outputKey: key(3) })] });

    const report = await run({ maxDeletes: 2 });

    expect(report.refused).toEqual({ reason: "too_many_candidates", maxDeletes: 2 });
    expect(report).toMatchObject({ candidates: 3, claimed: 0, deleted: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });

  it("les FAILED comptent face au plafond comme les autres, et le rapport refusé garde la répartition", async () => {
    seed({
      candidates: [
        candidate("j1", { outputKey: key(1) }),
        candidate("j2", { status: "FAILED", outputKey: key(2) }),
        candidate("j3", { status: "FAILED", outputKey: key(3) }),
      ],
    });

    const report = await run({ maxDeletes: 2 });

    expect(report.refused).toEqual({ reason: "too_many_candidates", maxDeletes: 2 });
    expect(report).toMatchObject({ candidates: 3, byStatus: { completed: 1, failed: 2 }, claimed: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("pile au plafond : le passage a lieu", async () => {
    seed({ candidates: [candidate("j1", { outputKey: key(1) }), candidate("j2", { outputKey: key(2) })] });

    const report = await run({ maxDeletes: 2 });

    expect(report.refused).toBeNull();
    expect(report).toMatchObject({ claimed: 2, deleted: 2 });
  });

  it("refuse les nouvelles réclamations mais reprend les suppressions déjà décidées", async () => {
    const waiting = key(9);
    seed({
      candidates: [candidate("j1", { outputKey: key(1) }), candidate("j2", { outputKey: key(2) })],
      pending: [{ id: "p1", outputKey: waiting }],
    });

    const report = await run({ maxDeletes: 1 });

    expect(report.refused).toEqual({ reason: "too_many_candidates", maxDeletes: 1 });
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(waiting);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", outputKey: waiting, outputExpiredAt: { not: null } },
      data: { outputKey: null },
    });
    expect(report).toMatchObject({ claimed: 0, pendingRetried: 1, pendingLeft: 0 });
  });
});

describe("suppressions en attente", () => {
  it("une clé qu'une ligne encore vivante porte n'est pas supprimée, la ligne reste en attente", async () => {
    const outputKey = key(1);
    seed({ pending: [{ id: "p1", outputKey }], held: [outputKey] });

    const report = await run();

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { outputKey: { in: [outputKey] }, outputExpiredAt: null },
      select: { outputKey: true },
    });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({ pendingRetried: 0, pendingLeft: 1 });
  });

  it("une clé hors forme n'est jamais supprimée, au passage à blanc comme au passage réel", async () => {
    seed({ pending: [{ id: "p1", outputKey: "publications/s1/versions/v0.mp4" }] });

    const dry = await run({ dryRun: true });
    const real = await run();

    for (const report of [dry, real]) {
      expect(report).toMatchObject({ skipped: { unsafeKey: 1 }, pendingRetried: 0, pendingLeft: 1 });
    }
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("une suppression R2 qui échoue encore reste en attente", async () => {
    const outputKey = key(1);
    seed({ pending: [{ id: "p1", outputKey }] });
    mocks.deleteFromR2.mockRejectedValue(new Error("R2 en panne"));

    const report = await run();

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(report).toMatchObject({ pendingRetried: 0, pendingLeft: 1, errors: 1 });
  });
});

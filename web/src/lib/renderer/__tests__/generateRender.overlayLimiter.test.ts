/**
 * Tests du limiteur de la phase overlays (plan « Lancer les rendus », étape
 * 5) — `generateRender.ts` exporte deux petits internes réservés aux tests
 * (préfixe `__test__`), qui SONT le chemin de production (pas une copie) :
 *  - `__test__getOverlayPhaseLimiter()` : le singleton `createLimiter(...)`
 *    utilisé par `generateSequenceRender` pour la phase overlay (RunPod).
 *  - `__test__attemptOverlayDequeue(renderId)` : le CAS de sortie de file
 *    (`status=PROCESSING`, sans filtre sur `stage` — cf. commentaire dans
 *    generateRender.ts) qui décide si le travail a lieu.
 *
 * Prisma est mocké — aucune DB, aucun Chromium/RunPod réel ne tourne ici.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRenderUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: {
      updateMany: (...args: unknown[]) => mockRenderUpdateMany(...args),
    },
  },
}));

import { __test__getOverlayPhaseLimiter, __test__attemptOverlayDequeue } from "@/lib/renderer/generateRender";

beforeEach(() => {
  vi.clearAllMocks();
  mockRenderUpdateMany.mockResolvedValue({ count: 1 });
  // Le limiteur est un singleton sur `globalThis` (survit au HMR en prod/dev) —
  // on le réinitialise entre les tests pour ne pas hériter d'une concurrence
  // configurée par un test précédent.
  delete (globalThis as Record<string, unknown>).__renderOverlayPhaseLimiter;
  delete process.env.RENDER_OVERLAY_CONCURRENCY;
});

describe("__test__attemptOverlayDequeue", () => {
  it("renvoie true et rafraîchit startedAt/lastHeartbeatAt quand le render est encore PROCESSING", async () => {
    mockRenderUpdateMany.mockResolvedValue({ count: 1 });
    const ok = await __test__attemptOverlayDequeue("render-1");
    expect(ok).toBe(true);
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockRenderUpdateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // Pas de filtre sur `stage` : un CAS sur `status` seul (cf. commentaire
    // generateRender.ts) — une écriture QUEUED perdue ne doit pas faire
    // échouer la sortie de file.
    expect(call.where).toEqual({ id: "render-1", status: "PROCESSING" });
  });

  it("renvoie false sans lever quand le render a été force-failed pendant l'attente (updateMany ne touche aucune ligne)", async () => {
    mockRenderUpdateMany.mockResolvedValue({ count: 0 });
    const ok = await __test__attemptOverlayDequeue("render-2");
    expect(ok).toBe(false);
  });

  it("dequeue même si le stage n'a jamais atteint QUEUED (écriture de tracking perdue) tant que status=PROCESSING", async () => {
    // Reproduit le scénario du finding : l'update `stage: QUEUED` a échoué
    // (erreur DB transitoire avalée par `updateRenderTracking`), le render
    // est resté PROCESSING sur un stage antérieur. Le CAS ne doit PAS en
    // faire un abandon silencieux : `status` seul doit suffire à dequeue.
    mockRenderUpdateMany.mockResolvedValue({ count: 1 });
    const ok = await __test__attemptOverlayDequeue("render-3");
    expect(ok).toBe(true);
  });
});

describe("__test__getOverlayPhaseLimiter", () => {
  it("ne laisse jamais plus de N tâches actives en même temps", async () => {
    process.env.RENDER_OVERLAY_CONCURRENCY = "2";
    const limiter = __test__getOverlayPhaseLimiter();

    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];

    const task = () =>
      limiter(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
      });

    const tasks = [task(), task(), task(), task(), task()];

    // Laisse les micro-tâches se poser : les 2 premières doivent démarrer,
    // les 3 suivantes rester en file.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);

    // Libère progressivement — jamais plus de 2 actives à la fois.
    while (release.length > 0) {
      release.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(2);
    }

    await Promise.all(tasks);
    expect(maxActive).toBe(2);
  });

  it("réutilise le même singleton (le process PM2 est unique) tant que globalThis n'est pas réinitialisé", () => {
    const a = __test__getOverlayPhaseLimiter();
    const b = __test__getOverlayPhaseLimiter();
    expect(a).toBe(b);
  });
});

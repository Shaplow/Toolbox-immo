/**
 * Bascule du rendu courant à la complétion — le cœur du re-render.
 *
 * Avant : `Render.publicationSlotId` était unique, donc un re-render sur un slot
 * dont le rendu était DONE partait orphelin. La fiche affichait l'ancienne vidéo
 * indéfiniment, et toute la chaîne aval naissait détachée du slot.
 *
 * Après : le slot accumule ses rendus, et `currentRenderId` n'est promu qu'ici,
 * à la complétion. Un re-render qui échoue ne fait donc rien perdre.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRenderFindUnique = vi.fn();
const mockSlotFindUnique = vi.fn();
const mockSlotUpdate = vi.fn();
const mockTransaction = vi.fn();
const mockMarkStale = vi.fn();
const mockLogActivity = vi.fn();
const mockAutoTransition = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: { findUnique: (...a: unknown[]) => mockRenderFindUnique(...a) },
    publicationSlot: {
      findUnique: (...a: unknown[]) => mockSlotFindUnique(...a),
      update: (...a: unknown[]) => mockSlotUpdate(...a),
    },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
}));

vi.mock("@/lib/publications/jobLifecycle", () => ({
  markJobsStaleForSlot: (...a: unknown[]) => mockMarkStale(...a),
  autoPromoteIfNoActive: vi.fn(),
}));

vi.mock("@/lib/services/slot/activity", () => ({
  logActivity: (...a: unknown[]) => mockLogActivity(...a),
}));

vi.mock("@/lib/services/slot/transitions", () => ({
  applyAutoTransitionFromPipeline: (...a: unknown[]) => mockAutoTransition(...a),
}));

// Import APRÈS les mocks
import { onRenderCompleted } from "@/lib/services/slot/pipelineHooks";

beforeEach(() => {
  mockRenderFindUnique.mockReset();
  mockSlotFindUnique.mockReset();
  mockSlotUpdate.mockReset().mockResolvedValue({});
  mockMarkStale.mockReset().mockResolvedValue({});
  mockLogActivity.mockReset().mockResolvedValue({});
  mockAutoTransition.mockReset().mockResolvedValue(undefined);
  mockTransaction.mockReset().mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ publicationSlot: { update: (...a: unknown[]) => mockSlotUpdate(...a) } }),
  );
});

describe("onRenderCompleted", () => {
  it("ne fait rien pour un rendu sans slot", async () => {
    mockRenderFindUnique.mockResolvedValue({ publicationSlotId: null, videoUrl: "u" });

    await onRenderCompleted("r1");

    expect(mockSlotUpdate).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("premier rendu : promeut le rendu courant sans rien invalider", async () => {
    mockRenderFindUnique.mockResolvedValue({ publicationSlotId: "slot-1", videoUrl: "v1" });
    mockSlotFindUnique.mockResolvedValue({ currentRenderId: null });

    await onRenderCompleted("r1");

    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentRenderId: "r1" } }),
    );
    // Rien à invalider : aucune chaîne aval n'existait.
    expect(mockMarkStale).not.toHaveBeenCalled();
  });

  it("re-render : bascule le rendu courant ET invalide la chaîne aval", async () => {
    mockRenderFindUnique.mockResolvedValue({ publicationSlotId: "slot-1", videoUrl: "v2" });
    mockSlotFindUnique.mockResolvedValue({ currentRenderId: "r1" });

    await onRenderCompleted("r2");

    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentRenderId: "r2" } }),
    );
    expect(mockMarkStale).toHaveBeenCalledWith(expect.anything(), "slot-1", "render_replaced");
  });

  it("trace le rendu remplacé dans l'activité", async () => {
    mockRenderFindUnique.mockResolvedValue({ publicationSlotId: "slot-1", videoUrl: "v2" });
    mockSlotFindUnique.mockResolvedValue({ currentRenderId: "r1" });

    await onRenderCompleted("r2");

    const payload = (mockLogActivity.mock.calls[0][1] as { payload: Record<string, unknown> }).payload;
    expect(payload).toMatchObject({ renderId: "r2", replacedRenderId: "r1" });
  });

  it("rejoue le même rendu : pas de ré-invalidation (idempotent)", async () => {
    mockRenderFindUnique.mockResolvedValue({ publicationSlotId: "slot-1", videoUrl: "v1" });
    mockSlotFindUnique.mockResolvedValue({ currentRenderId: "r1" });

    await onRenderCompleted("r1");

    expect(mockMarkStale).not.toHaveBeenCalled();
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("une erreur n'échoue jamais le pipeline appelant", async () => {
    mockRenderFindUnique.mockRejectedValue(new Error("db down"));

    await expect(onRenderCompleted("r1")).resolves.toBeUndefined();
  });
});

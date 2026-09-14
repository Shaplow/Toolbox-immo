/**
 * Tests cancelSlot — fige le retrait d'une publication du pipeline.
 *
 * Le besoin : 5 vidéos commandées, des rushs pour 4 seulement. Le monteur doit
 * pouvoir en retirer une. Avant, il ne pouvait ni supprimer (ADMIN strict) ni
 * annuler (CANCELLED réservé à l'ADMIN via PATCH) — il ne lui restait que
 * BLOCKED, dont le sens est tout autre.
 *
 * Invariants figés ici :
 *  1. ADMIN / MONTEUR / VIDEASTE peuvent ; le CM non (il publie, il ne décide
 *     pas du nombre de vidéos).
 *  2. Le scope s'applique d'abord : hors périmètre → 404, pas 403.
 *  3. Motif obligatoire et borné.
 *  4. Un slot déjà terminal refuse en 409.
 *  5. L'audit trace l'admin RÉEL sous impersonation.
 *  6. On ANNULE, on ne supprime pas — le slot reste en base (c'est ce qui
 *     empêche la commande de le recréer).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockSlotUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockSlotDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...a: unknown[]) => mockSlotFindUnique(...a),
      update: (...a: unknown[]) => mockSlotUpdate(...a),
      delete: (...a: unknown[]) => mockSlotDelete(...a),
    },
    publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
  },
}));

vi.mock("@/lib/r2", () => ({
  deleteR2Prefix: vi.fn(),
  r2Configured: () => false,
}));

import { cancelSlot } from "@/lib/services/slot/slotService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(
  role: "ADMIN" | "MONTEUR" | "CM" | "VIDEASTE" | "EXTERNAL_GENERATOR",
  opts: { userId?: string; actualUserId?: string } = {},
) {
  const userId = opts.userId ?? `${role.toLowerCase()}-1`;
  const user = { id: userId, role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: { ...user, id: opts.actualUserId ?? userId },
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: opts.actualUserId !== undefined,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN" && opts.actualUserId === undefined,
  } as Parameters<typeof cancelSlot>[2];
}

const SLOT = {
  id: "slot-1",
  status: "IN_EDIT",
  title: "RVA1",
  notes: null,
  assigneeMonteurId: "monteur-1",
  assigneeCmId: "cm-1",
  assigneeVideasteId: "videaste-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSlotFindUnique.mockResolvedValue(SLOT);
  mockSlotUpdate.mockResolvedValue({ ...SLOT, status: "CANCELLED" });
  mockActivityCreate.mockResolvedValue({ id: "act-1" });
});

describe("cancelSlot — qui peut retirer", () => {
  it.each(["ADMIN", "MONTEUR", "VIDEASTE"] as const)("%s peut retirer", async (role) => {
    await expect(cancelSlot("slot-1", "Pas de rushs", ctx(role))).resolves.toBeDefined();
    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
  });

  // Le CM passe le scope (il est assigné) mais pas la permission : c'est bien
  // un 403 et non un 404, il sait que la publication existe.
  it("le CM ne peut pas retirer, même sur sa propre publication", async () => {
    await expect(cancelSlot("slot-1", "Pas de rushs", ctx("CM"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("hors périmètre → 404, pas 403 (anti-énumération)", async () => {
    await expect(
      cancelSlot("slot-1", "Pas de rushs", ctx("MONTEUR", { userId: "autre-monteur" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("slot inexistant → 404", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    await expect(cancelSlot("nope", "Pas de rushs", ctx("ADMIN"))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("cancelSlot — motif", () => {
  it("un motif vide est refusé", async () => {
    for (const reason of ["", "   "]) {
      await expect(cancelSlot("slot-1", reason, ctx("ADMIN"))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("un motif trop long est refusé", async () => {
    await expect(cancelSlot("slot-1", "x".repeat(501), ctx("ADMIN"))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("le motif est trimé et tracé dans l'activité", async () => {
    await cancelSlot("slot-1", "  Rushs manquants  ", ctx("MONTEUR"));
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "STATUS_CHANGED",
          payload: { from: "IN_EDIT", to: "CANCELLED", reason: "Rushs manquants" },
        }),
      }),
    );
  });
});

describe("cancelSlot — état du slot", () => {
  it.each(["PUBLISHED", "ARCHIVED", "CANCELLED"] as const)(
    "un slot %s refuse en conflit",
    async (status) => {
      mockSlotFindUnique.mockResolvedValue({ ...SLOT, status });
      await expect(cancelSlot("slot-1", "Pas de rushs", ctx("ADMIN"))).rejects.toBeInstanceOf(
        ConflictError,
      );
    },
  );

  it("message dédié quand la publication est déjà retirée", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, status: "CANCELLED" });
    await expect(cancelSlot("slot-1", "Pas de rushs", ctx("ADMIN"))).rejects.toThrow(
      /déjà retirée/,
    );
  });

  // La matrice de transitions reste la source de vérité pour les non-ADMIN.
  it("BLOCKED n'a aucune sortie pour un monteur", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, status: "BLOCKED" });
    await expect(cancelSlot("slot-1", "Pas de rushs", ctx("MONTEUR"))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("mais l'ADMIN bypasse la matrice", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, status: "BLOCKED" });
    await expect(cancelSlot("slot-1", "Abandon", ctx("ADMIN"))).resolves.toBeDefined();
  });
});

describe("cancelSlot — traçabilité", () => {
  // Sous impersonation, l'audit doit désigner l'admin réel, pas la personne
  // dont il emprunte l'identité.
  it("l'activité trace l'utilisateur RÉEL", async () => {
    await cancelSlot(
      "slot-1",
      "Pas de rushs",
      ctx("MONTEUR", { userId: "monteur-1", actualUserId: "admin-9" }),
    );
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: "admin-9" }) }),
    );
  });

  /**
   * Le point structurant : on annule, on ne supprime pas. Un slot CANCELLED
   * reste compté par l'idempotence de `instantiateOrderSlots`, donc le bouton
   * « Réessayer l'instanciation » de la commande ne le recrée pas. Une
   * suppression faisait réapparaître la vidéo au clic suivant.
   */
  it("ne supprime jamais la ligne", async () => {
    await cancelSlot("slot-1", "Pas de rushs", ctx("MONTEUR"));
    expect(mockSlotDelete).not.toHaveBeenCalled();
    expect(mockSlotUpdate).toHaveBeenCalledTimes(1);
  });
});

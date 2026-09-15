/**
 * Tests setSlotCollabs — les comptes invités en « collaborateur » sur un post.
 *
 * Ce que ces tests figent, au-delà du « ça écrit bien » :
 *  1. le refus du compte principal — sinon le CM lirait deux fois le même
 *     compte dans sa consigne et chercherait ce qu'il a raté ;
 *  2. le plafond d'Instagram, posé côté serveur pour que l'admin ne puisse pas
 *     enregistrer une consigne que le composer refusera ;
 *  3. l'autorisation sur une publication DÉJÀ PUBLIÉE — divergence volontaire
 *     avec assignSlotAccount, à ne pas « corriger » par symétrie ;
 *  4. l'idempotence : re-poser le même set ne réécrit rien et ne pollue pas le
 *     fil d'activité.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockAccountFindMany = vi.fn();
const mockCollabDeleteMany = vi.fn();
const mockCollabCreateMany = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: { findUnique: (...a: unknown[]) => mockSlotFindUnique(...a) },
    instagramAccount: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
    publicationSlotCollab: {
      deleteMany: (...a: unknown[]) => mockCollabDeleteMany(...a),
      createMany: (...a: unknown[]) => mockCollabCreateMany(...a),
    },
    publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn(), r2Configured: () => false }));
vi.mock("@/lib/publications/captionDataLibrary", () => ({
  resolveCaptionWithDataLibrary: vi.fn(),
}));
vi.mock("@/lib/contentLibraryResolver", () => ({
  claimDataEntryForCaption: vi.fn(),
  selectDataEntry: vi.fn(),
  resolveCaptionWithDataLibrary: vi.fn(),
}));

import { setSlotCollabs } from "@/lib/services/slot/slotService";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(role: "ADMIN" | "CM" = "ADMIN") {
  const user = { id: `${role.toLowerCase()}-1`, role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof setSlotCollabs>[2];
}

beforeEach(() => {
  mockSlotFindUnique.mockReset().mockResolvedValue({
    id: "slot-1",
    accountId: "acc-main",
    collabs: [],
  });
  mockAccountFindMany.mockReset().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.map((id) => ({ id, handle: `h_${id}`, name: id }))),
  );
  mockCollabDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockCollabCreateMany.mockReset().mockResolvedValue({ count: 0 });
  mockActivityCreate.mockReset().mockResolvedValue({ id: "act" });
  mockTransaction.mockReset().mockImplementation((cb: unknown) => {
    if (typeof cb !== "function") return Promise.resolve(undefined);
    const tx = {
      publicationSlotCollab: {
        deleteMany: (...a: unknown[]) => mockCollabDeleteMany(...a),
        createMany: (...a: unknown[]) => mockCollabCreateMany(...a),
      },
      publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    };
    return Promise.resolve((cb as (tx: unknown) => Promise<unknown>)(tx));
  });
});

describe("setSlotCollabs", () => {
  it("remplace le set et renvoie les comptes", async () => {
    const res = await setSlotCollabs("slot-1", ["acc-2", "acc-3"], ctx());

    expect(mockCollabDeleteMany).toHaveBeenCalledWith({ where: { slotId: "slot-1" } });
    expect(mockCollabCreateMany).toHaveBeenCalledWith({
      data: [
        { slotId: "slot-1", accountId: "acc-2" },
        { slotId: "slot-1", accountId: "acc-3" },
      ],
    });
    expect(res.accounts.map((a) => a.id)).toEqual(["acc-2", "acc-3"]);
  });

  it("une liste vide retire tout, sans createMany", async () => {
    mockSlotFindUnique.mockResolvedValue({
      id: "slot-1",
      accountId: "acc-main",
      collabs: [{ accountId: "acc-2" }],
    });

    await setSlotCollabs("slot-1", [], ctx());

    expect(mockCollabDeleteMany).toHaveBeenCalled();
    expect(mockCollabCreateMany).not.toHaveBeenCalled();
  });

  it("le compte qui publie ne peut pas être son propre collaborateur", async () => {
    await expect(setSlotCollabs("slot-1", ["acc-main"], ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockCollabDeleteMany).not.toHaveBeenCalled();
  });

  it("au-delà de 3 collaborateurs → refus (limite Instagram)", async () => {
    await expect(
      setSlotCollabs("slot-1", ["a", "b", "c", "d"], ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("les doublons ne comptent pas double dans le plafond", async () => {
    await expect(
      setSlotCollabs("slot-1", ["a", "a", "b", "b"], ctx()),
    ).resolves.toBeDefined();
  });

  it("un compte inexistant → refus", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: "acc-2", handle: "h", name: "n" }]);

    await expect(
      setSlotCollabs("slot-1", ["acc-2", "fantome"], ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("re-poser le même set n'écrit rien et ne pollue pas le fil", async () => {
    mockSlotFindUnique.mockResolvedValue({
      id: "slot-1",
      accountId: "acc-main",
      collabs: [{ accountId: "acc-3" }, { accountId: "acc-2" }],
    });

    // Ordre différent : c'est un ENSEMBLE, pas une séquence.
    const res = await setSlotCollabs("slot-1", ["acc-2", "acc-3"], ctx());

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockActivityCreate).not.toHaveBeenCalled();
    expect(res.accounts).toHaveLength(2);
  });

  it("trace COLLAB_ACCOUNTS_CHANGED avec les handles, pas les ids", async () => {
    await setSlotCollabs("slot-1", ["acc-2"], ctx());

    const logged = mockActivityCreate.mock.calls
      .map((c) => (c[0] as { data: { type: string; payload?: { to?: string[] } } }).data)
      .find((d) => d.type === "COLLAB_ACCOUNTS_CHANGED");
    expect(logged?.payload?.to).toEqual(["h_acc-2"]);
  });

  it("un non-admin est refusé", async () => {
    await expect(setSlotCollabs("slot-1", ["acc-2"], ctx("CM"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("slot introuvable → 404", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    await expect(setSlotCollabs("ghost", ["acc-2"], ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("autorisé sur une publication DÉJÀ PUBLIÉE — divergence voulue avec le compte", async () => {
    // Le compte pilote la résolution de recette et la visibilité calendrier,
    // le collab ne pilote rien : on doit pouvoir consigner après coup.
    mockSlotFindUnique.mockResolvedValue({
      id: "slot-1",
      accountId: "acc-main",
      status: "PUBLISHED",
      publishedUrl: "https://instagram.com/p/x",
      collabs: [],
    });

    await expect(setSlotCollabs("slot-1", ["acc-2"], ctx())).resolves.toBeDefined();
  });
});

/**
 * Tests assignSlotAccount — poser le compte Instagram d'une publication déjà
 * créée.
 *
 * Le compte n'est plus choisi à la commande mais au placement calendrier. Ce
 * chemin n'existait pas : `accountId` est absent d'ALLOWED_PATCH_FIELDS_BY_ROLE
 * et `patchSlot` filtre silencieusement — l'appel réussissait sans rien faire.
 *
 * Deux choses comptent ici plus que « est-ce que ça écrit » :
 *  1. le contrôle « la recette est-elle active sur ce compte ? » a DÉMÉNAGÉ
 *     depuis la validation de commande (qui sortait par le haut sans compte).
 *     S'il ne s'exécute pas ici, il ne s'exécute plus nulle part ;
 *  2. ce que ça n'écrase PAS — un assigné posé à la main tient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();
const mockSlotFindUniqueOrThrow = vi.fn();
const mockSlotUpdate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockActivityCreate = vi.fn();
const mockCollabDeleteMany = vi.fn(async () => ({ count: 0 }));
const mockCollabFindMany = vi.fn(async () => [] as unknown[]);

vi.mock("@/lib/prisma", () => {
  const client: Record<string, unknown> = {
    publicationSlot: {
      findUnique: (...a: unknown[]) => mockSlotFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockSlotFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockSlotUpdate(...a),
    },
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    patternBinding: { findFirst: (...a: unknown[]) => mockBindingFindFirst(...a) },
    publicationActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    publicationSlotCollab: {
      deleteMany: (...a: unknown[]) => mockCollabDeleteMany(...a),
      findMany: (...a: unknown[]) => mockCollabFindMany(...a),
    },
  };
  // La purge du collaborateur devenu faux et le changement de compte partagent
  // une transaction : le mock la joue en passant le client lui-même.
  client.$transaction = (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

vi.mock("@/lib/r2", () => ({ deleteR2Prefix: vi.fn(), r2Configured: () => false }));
vi.mock("@/lib/publications/captionDataLibrary", () => ({
  resolveCaptionWithDataLibrary: vi.fn(),
}));
vi.mock("@/lib/contentLibraryResolver", () => ({
  claimDataEntryForCaption: vi.fn(),
  selectDataEntry: vi.fn(),
  resolveCaptionWithDataLibrary: vi.fn(),
}));

import { assignSlotAccount } from "@/lib/services/slot/slotService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(role: "ADMIN" | "MONTEUR" = "ADMIN") {
  const user = { id: `${role.toLowerCase()}-1`, role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  } as Parameters<typeof assignSlotAccount>[2];
}

/** Publication en banque : sans compte, sans assigné — le cas nominal. */
const SLOT = {
  id: "slot-1",
  status: "TO_EDIT",
  accountId: null,
  publishedUrl: null,
  assigneeMonteurId: null,
  assigneeCmId: null,
  assigneeVideasteId: null,
  order: { clientId: "client-1" },
  shootEntity: null,
  patternBinding: null,
  patternTemplate: { id: "pt1", label: "RVA1", source: "manual_rushes" },
};

const ACCOUNT = {
  id: "acc-1",
  handle: "lola",
  clientId: "client-1",
  defaultAssigneeVideasteId: "u-videaste",
  defaultAssigneeMonteurId: "u-monteur",
  defaultAssigneeCmId: "u-cm",
};

const BINDING = {
  id: "bind-1",
  defaultAssigneeVideasteId: null,
  defaultAssigneeMonteurId: "u-monteur-recette",
  defaultAssigneeCmId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSlotFindUnique.mockResolvedValue(SLOT);
  mockAccountFindUnique.mockResolvedValue(ACCOUNT);
  mockBindingFindFirst.mockResolvedValue(BINDING);
  mockSlotUpdate.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "slot-1", ...(data as object) }));
});

describe("cas nominal", () => {
  it("pose le compte ET le binding de la recette sur ce compte", async () => {
    await assignSlotAccount("slot-1", "acc-1", ctx());

    expect(mockBindingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acc-1", patternTemplateId: "pt1", isActive: true },
      }),
    );
    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountId: "acc-1", patternBindingId: "bind-1" }),
      }),
    );
  });

  /**
   * Sans binding, le slot resterait piloté par la recette GLOBALE : pas
   * d'horaire de publication, pas de libellé propre au compte, pas d'équipe.
   * Poser le compte sans poser le binding ne servirait donc à rien.
   */
  it("complète les assignés : recette d'abord, puis compte", async () => {
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeMonteurId: "u-monteur-recette", // la recette gagne
          assigneeCmId: "u-cm", // repli compte
          assigneeVideasteId: "u-videaste", // repli compte
        }),
      }),
    );
  });

  it("n'écrase JAMAIS un assigné posé à la main", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, assigneeMonteurId: "u-choisi" });
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeMonteurId: "u-choisi" }),
      }),
    );
  });

  it("trace le changement avec le compte d'avant", async () => {
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ASSIGNEE_CHANGED",
        }),
      }),
    );
  });

  it("re-choisir le même compte ne réécrit rien", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, accountId: "acc-1" });
    mockSlotFindUniqueOrThrow.mockResolvedValue({ id: "slot-1", accountId: "acc-1" });
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });
});

describe("le contrôle déménagé depuis la validation de commande", () => {
  /**
   * `assertOrderIsInstantiable` refusait de valider une commande dont une
   * recette n'était pas active sur le compte. Sans compte à la commande, elle
   * sort par le haut (`if (!order.accountId) return`) : ce contrôle ne
   * s'exécuterait plus nulle part s'il n'était pas ici.
   */
  it("refuse un compte où la recette n'est pas active, et nomme les deux", async () => {
    mockBindingFindFirst.mockResolvedValue(null);
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toThrow(/RVA1.*@lola/);
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("une recette inactive ne compte pas comme active", async () => {
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockBindingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });

  it("un slot sans aucune recette passe sans binding", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, patternTemplate: null });
    await assignSlotAccount("slot-1", "acc-1", ctx());
    expect(mockBindingFindFirst).not.toHaveBeenCalled();
    expect(mockSlotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ patternBindingId: expect.anything() }) }),
    );
  });
});

describe("gardes", () => {
  it("réservé aux administrateurs", async () => {
    await expect(assignSlotAccount("slot-1", "acc-1", ctx("MONTEUR"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("404 sur une publication inconnue", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404 sur un compte inconnu", async () => {
    mockAccountFindUnique.mockResolvedValue(null);
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuse de déplacer une publication déjà publiée", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, status: "PUBLISHED" });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse aussi sur un publishedUrl sans le statut", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, publishedUrl: "https://…" });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(ConflictError);
  });

  /** Cloison client : un id deviné ne doit pas faire changer de client. */
  it("refuse un compte qui n'appartient pas au client de la commande", async () => {
    mockAccountFindUnique.mockResolvedValue({ ...ACCOUNT, clientId: "client-autre" });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockSlotUpdate).not.toHaveBeenCalled();
  });

  it("une publication hors commande n'est pas cloisonnée par client", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, order: null });
    mockAccountFindUnique.mockResolvedValue({ ...ACCOUNT, clientId: "client-autre" });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).resolves.toBeTruthy();
  });

  /** Miroir de la garde d'attachShootToSlot : le tournage impose son compte. */
  it("refuse un compte différent de celui du tournage rattaché", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, shootEntity: { accountId: "acc-autre" } });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).rejects.toBeInstanceOf(ConflictError);
  });

  it("accepte un tournage rattaché sans compte", async () => {
    mockSlotFindUnique.mockResolvedValue({ ...SLOT, shootEntity: { accountId: null } });
    await expect(assignSlotAccount("slot-1", "acc-1", ctx())).resolves.toBeTruthy();
  });
});

/**
 * L'invariant « un compte n'est pas son propre collaborateur » était gardé
 * d'un seul côté : `setSlotCollabs` refusait de l'écrire, mais une
 * réassignation de compte pouvait le produire par la bande, et le CM lisait
 * « poster depuis @B, et inviter @B en collaborateur ».
 */
describe("collaborateurs", () => {
  it("le nouveau compte cesse d'être son propre collaborateur", async () => {
    mockCollabDeleteMany.mockResolvedValue({ count: 1 });
    mockCollabFindMany.mockResolvedValue([{ account: { handle: "autre_compte" } }]);

    await assignSlotAccount("slot-1", "acc-1", ctx());

    expect(mockCollabDeleteMany).toHaveBeenCalledWith({
      where: { slotId: "slot-1", accountId: "acc-1" },
    });
  });

  it("le retrait est consigné avec les collaborateurs restants", async () => {
    mockCollabDeleteMany.mockResolvedValue({ count: 1 });
    mockCollabFindMany.mockResolvedValue([{ account: { handle: "autre_compte" } }]);

    await assignSlotAccount("slot-1", "acc-1", ctx());

    const logged = mockActivityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string; payload?: { to?: string[] } } }).data,
    );
    const collabLog = logged.find((d) => d.type === "COLLAB_ACCOUNTS_CHANGED");
    expect(collabLog?.payload?.to).toEqual(["autre_compte"]);
  });

  it("rien à retirer → pas de ligne de fil en plus", async () => {
    mockCollabDeleteMany.mockResolvedValue({ count: 0 });

    await assignSlotAccount("slot-1", "acc-1", ctx());

    const types = mockActivityCreate.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).not.toContain("COLLAB_ACCOUNTS_CHANGED");
  });
});

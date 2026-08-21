/**
 * Tests validation bidirectionnelle des fiches — fige :
 *  - initialValidationStatus : direction selon créateur + config du type
 *  - setEntityValidation : transitions + gating (admin / externe scopé / autres)
 *  - assertEntityValidated : porte de création de slots (slotService)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockEntityUpdate = vi.fn();
const mockEntityActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: {
      findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
      update: (...a: unknown[]) => mockEntityUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  initialValidationStatus,
  setEntityValidation,
} from "@/lib/services/entity/entityService";
import { assertEntityValidated } from "@/lib/services/slot/slotService";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(role: string, opts: { canAdminBypass?: boolean } = {}) {
  const user = { id: `${role.toLowerCase()}-1`, role, name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: opts.canAdminBypass ?? role === "ADMIN",
  } as Parameters<typeof setEntityValidation>[2];
}

function mockEntity(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    validationStatus: null,
    type: { needsAdminValidation: false, needsClientValidation: false },
    order: null,
    account: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // La tx exécute le callback avec un client mocké.
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      entity: { update: (...a: unknown[]) => mockEntityUpdate(...a) },
      entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    }),
  );
  // Forme minimale attendue par withParsedFields (entityListSelect).
  mockEntityUpdate.mockResolvedValue({
    id: "e1",
    fields: "{}",
    type: { fieldSchema: "[]" },
    validationStatus: "APPROVED",
  });
});

describe("initialValidationStatus", () => {
  const both = { needsAdminValidation: true, needsClientValidation: true };
  const none = { needsAdminValidation: false, needsClientValidation: false };

  it("créateur externe → PENDING_ADMIN si le type l'exige, sinon null", () => {
    expect(initialValidationStatus(both, { isExternalCreator: true })).toBe("PENDING_ADMIN");
    expect(
      initialValidationStatus(
        { needsAdminValidation: false, needsClientValidation: true },
        { isExternalCreator: true },
      ),
    ).toBeNull();
    expect(initialValidationStatus(none, { isExternalCreator: true })).toBeNull();
  });

  it("créateur interne → PENDING_CLIENT si le type l'exige, sinon null", () => {
    expect(initialValidationStatus(both, { isExternalCreator: false })).toBe("PENDING_CLIENT");
    expect(
      initialValidationStatus(
        { needsAdminValidation: true, needsClientValidation: false },
        { isExternalCreator: false },
      ),
    ).toBeNull();
  });
});

describe("setEntityValidation — admin", () => {
  it("approve une fiche PENDING_ADMIN → APPROVED + activité", async () => {
    mockEntityFindUnique.mockResolvedValue(mockEntity({ validationStatus: "PENDING_ADMIN" }));
    await setEntityValidation("e1", { action: "approve" }, ctx("ADMIN"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "APPROVED" } }),
    );
    expect(mockEntityActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "VALIDATION_APPROVED" }) }),
    );
  });

  it("approve possible sur une fiche REJECTED (après correction)", async () => {
    mockEntityFindUnique.mockResolvedValue(mockEntity({ validationStatus: "REJECTED" }));
    await setEntityValidation("e1", { action: "approve" }, ctx("ADMIN"));
    expect(mockEntityUpdate).toHaveBeenCalled();
  });

  it("approve sans validation en cours → ValidationError", async () => {
    mockEntityFindUnique.mockResolvedValue(mockEntity({ validationStatus: null }));
    await expect(
      setEntityValidation("e1", { action: "approve" }, ctx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("reject d'une PENDING_CLIENT (admin) → REJECTED_CLIENT non bloquant", async () => {
    mockEntityFindUnique.mockResolvedValue(mockEntity({ validationStatus: "PENDING_CLIENT" }));
    await setEntityValidation("e1", { action: "reject" }, ctx("ADMIN"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "REJECTED_CLIENT" } }),
    );
  });

  it("reject → REJECTED avec commentaire tronqué dans le payload", async () => {
    mockEntityFindUnique.mockResolvedValue(mockEntity({ validationStatus: "PENDING_ADMIN" }));
    await setEntityValidation("e1", { action: "reject", comment: "  trop cher  " }, ctx("ADMIN"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "REJECTED" } }),
    );
    expect(mockEntityActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ comment: "trop cher" }),
        }),
      }),
    );
  });

  it("request → PENDING_CLIENT si le type a la validation client, sinon erreur", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ type: { needsAdminValidation: false, needsClientValidation: true } }),
    );
    await setEntityValidation("e1", { action: "request" }, ctx("ADMIN"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "PENDING_CLIENT" } }),
    );

    mockEntityFindUnique.mockResolvedValue(mockEntity());
    await expect(
      setEntityValidation("e1", { action: "request" }, ctx("ADMIN")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("fiche introuvable → NotFoundError", async () => {
    mockEntityFindUnique.mockResolvedValue(null);
    await expect(
      setEntityValidation("nope", { action: "approve" }, ctx("ADMIN")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("setEntityValidation — externe", () => {
  it("approve une fiche PENDING_CLIENT de son périmètre (via order.clientId)", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT", order: { clientId: "c1" } }),
    );
    mockUserFindUnique.mockResolvedValue({ clientId: "c1" });
    await setEntityValidation("e1", { action: "approve" }, ctx("EXTERNAL_GENERATOR"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "APPROVED" } }),
    );
  });

  it("périmètre via account.clientId accepté aussi ; reject client → REJECTED_CLIENT (non bloquant)", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT", account: { clientId: "c1" } }),
    );
    mockUserFindUnique.mockResolvedValue({ clientId: "c1" });
    await setEntityValidation("e1", { action: "reject" }, ctx("EXTERNAL_GENERATOR"));
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "REJECTED_CLIENT" } }),
    );
  });

  it("hors périmètre → 404 anti-énumération", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT", order: { clientId: "c2" } }),
    );
    mockUserFindUnique.mockResolvedValue({ clientId: "c1" });
    await expect(
      setEntityValidation("e1", { action: "approve" }, ctx("EXTERNAL_GENERATOR")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("externe sans client lié → 404", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT", order: { clientId: "c1" } }),
    );
    mockUserFindUnique.mockResolvedValue({ clientId: null });
    await expect(
      setEntityValidation("e1", { action: "approve" }, ctx("EXTERNAL_GENERATOR")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fiche pas en PENDING_CLIENT → ValidationError", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_ADMIN", order: { clientId: "c1" } }),
    );
    mockUserFindUnique.mockResolvedValue({ clientId: "c1" });
    await expect(
      setEntityValidation("e1", { action: "approve" }, ctx("EXTERNAL_GENERATOR")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("request interdit aux externes", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT", order: { clientId: "c1" } }),
    );
    await expect(
      setEntityValidation("e1", { action: "request" }, ctx("EXTERNAL_GENERATOR")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rôle team (non admin, non externe) → 404", async () => {
    mockEntityFindUnique.mockResolvedValue(
      mockEntity({ validationStatus: "PENDING_CLIENT" }),
    );
    await expect(
      setEntityValidation("e1", { action: "approve" }, ctx("MONTEUR")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assertEntityValidated (porte createSlot)", () => {
  it("bloque PENDING_ADMIN et REJECTED", () => {
    expect(() => assertEntityValidated("PENDING_ADMIN", "Cette fiche")).toThrow(ValidationError);
    expect(() => assertEntityValidated("REJECTED", "Cette fiche")).toThrow(ValidationError);
  });

  it("laisse passer null, APPROVED, PENDING_CLIENT et REJECTED_CLIENT (non bloquants)", () => {
    expect(() => assertEntityValidated(null, "Cette fiche")).not.toThrow();
    expect(() => assertEntityValidated("APPROVED", "Cette fiche")).not.toThrow();
    expect(() => assertEntityValidated("PENDING_CLIENT", "Cette fiche")).not.toThrow();
    expect(() => assertEntityValidated("REJECTED_CLIENT", "Cette fiche")).not.toThrow();
  });
});

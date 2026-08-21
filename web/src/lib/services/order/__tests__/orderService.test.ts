/**
 * Tests orderService — fige :
 *  - createOrder : résolution client (session externe / explicite admin),
 *    allowlist 404 anti-énumération, compte ∈ client, fiches attendues.
 *  - validateOrder / instantiateOrderSlots : routage reel / missions / direct,
 *    count multiplié, échecs isolés.
 *  - rejectOrder / cancelOrder : gardes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrderFindUnique = vi.fn();
const mockOrderFindUniqueOrThrow = vi.fn();
const mockOrderFindMany = vi.fn();
const mockOrderCreate = vi.fn();
const mockOrderUpdate = vi.fn();
const mockOrderUpdateMany = vi.fn();
const mockClientFindUnique = vi.fn();
const mockOrderTemplateFindUnique = vi.fn();
const mockEntityFindMany = vi.fn();
const mockEntityCreate = vi.fn();
const mockEntityUpdate = vi.fn();
const mockEntityFindFirst = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockSlotCount = vi.fn();
const mockActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: (...a: unknown[]) => mockOrderFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockOrderFindUniqueOrThrow(...a),
      findMany: (...a: unknown[]) => mockOrderFindMany(...a),
      create: (...a: unknown[]) => mockOrderCreate(...a),
      update: (...a: unknown[]) => mockOrderUpdate(...a),
      updateMany: (...a: unknown[]) => mockOrderUpdateMany(...a),
    },
    client: { findUnique: (...a: unknown[]) => mockClientFindUnique(...a) },
    orderTemplate: { findUnique: (...a: unknown[]) => mockOrderTemplateFindUnique(...a) },
    entity: {
      findMany: (...a: unknown[]) => mockEntityFindMany(...a),
      findFirst: (...a: unknown[]) => mockEntityFindFirst(...a),
      create: (...a: unknown[]) => mockEntityCreate(...a),
      update: (...a: unknown[]) => mockEntityUpdate(...a),
    },
    instagramAccount: { findFirst: (...a: unknown[]) => mockAccountFindFirst(...a) },
    publicationSlot: { count: (...a: unknown[]) => mockSlotCount(...a) },
    entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

const mockAttachSlotToEntity = vi.fn();
const mockPrepareEntityCreate = vi.fn();
vi.mock("@/lib/services/entity/entityService", () => ({
  attachSlotToEntity: (...a: unknown[]) => mockAttachSlotToEntity(...a),
  prepareEntityCreate: (...a: unknown[]) => mockPrepareEntityCreate(...a),
}));

const mockCreateSlot = vi.fn();
vi.mock("@/lib/services/slot/slotService", () => ({
  createSlot: (...a: unknown[]) => mockCreateSlot(...a),
}));

import {
  cancelOrder,
  createOrder,
  rejectOrder,
  validateOrder,
} from "@/lib/services/order/orderService";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function ctx(role: string, opts: { clientId?: string | null; canAdminBypass?: boolean } = {}) {
  const user = {
    id: `${role.toLowerCase()}-1`,
    role,
    name: null,
    email: null,
    permissions: "[]",
    clientId: opts.clientId ?? null,
  };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: opts.canAdminBypass ?? role === "ADMIN",
  } as Parameters<typeof createOrder>[1];
}

const bienType = {
  id: "etype_bien",
  name: "Bien",
  hasPlanning: false,
  hasAccount: false,
  hasRushes: false,
  fieldSchema: "[]",
};
const tournageType = {
  id: "etype_tournage",
  name: "Tournage",
  hasPlanning: true,
  hasAccount: true,
  hasRushes: true,
  fieldSchema: "[]",
};

function mockTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "ot1",
    name: "Bien + tournage",
    isArchived: false,
    items: [
      { entityTypeId: "etype_bien", entityType: bienType },
      { entityTypeId: "etype_tournage", entityType: tournageType },
    ],
    accesses: [{ clientId: "c1" }],
    ...over,
  };
}

// Détail post-création : createOrder termine par getOrder → order.findUnique.
const orderDetail = {
  id: "o1",
  status: "SUBMITTED",
  notes: null,
  rejectedReason: null,
  createdAt: new Date("2026-08-19T10:00:00Z"),
  updatedAt: new Date("2026-08-19T10:00:00Z"),
  validatedAt: null,
  clientId: "c1",
  client: { id: "c1", name: "Agence A" },
  accountId: "acc1",
  account: { id: "acc1", name: "Compte", handle: "compte" },
  createdBy: null,
  validatedBy: null,
  orderTemplate: { id: "ot1", name: "Bien + tournage", description: null, recipes: [] },
  entities: [],
  slots: [],
};

function baseInput(over: Record<string, unknown> = {}) {
  return {
    orderTemplateId: "ot1",
    accountId: "acc1",
    fiches: [
      { entityTypeId: "etype_bien", label: "Villa", fields: {} },
      {
        entityTypeId: "etype_tournage",
        label: "Tournage villa",
        fields: {},
        scheduledAt: "2026-09-01T09:00:00Z",
      },
    ],
    ...over,
  } as Parameters<typeof createOrder>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrderTemplateFindUnique.mockResolvedValue(mockTemplate());
  mockAccountFindFirst.mockResolvedValue({ id: "acc1" });
  mockPrepareEntityCreate.mockImplementation(async (input: { typeId: string; label: string }) => ({
    typeId: input.typeId,
    label: input.label,
    fields: "{}",
    validationStatus: "PENDING_ADMIN",
  }));
  let entitySeq = 0;
  mockEntityCreate.mockImplementation(async () => ({ id: `e${++entitySeq}`, typeId: "t" }));
  mockOrderCreate.mockResolvedValue({ id: "o1" });
  mockOrderFindUnique.mockResolvedValue(orderDetail);
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      order: {
        create: (...a: unknown[]) => mockOrderCreate(...a),
        update: (...a: unknown[]) => mockOrderUpdate(...a),
        updateMany: (...a: unknown[]) => mockOrderUpdateMany(...a),
      },
      entity: {
        create: (...a: unknown[]) => mockEntityCreate(...a),
        update: (...a: unknown[]) => mockEntityUpdate(...a),
      },
      entityActivity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    }),
  );
  // CAS : par défaut la transition gagne ; idempotence : aucun slot existant.
  mockOrderUpdateMany.mockResolvedValue({ count: 1 });
  mockSlotCount.mockResolvedValue(0);
  mockClientFindUnique.mockResolvedValue({ id: "c1" });
});

describe("createOrder — résolution client + allowlist", () => {
  it("externe rattaché : clientId de session, jamais du body", async () => {
    await createOrder(
      baseInput({ clientId: "c-autre" }),
      ctx("EXTERNAL_GENERATOR", { clientId: "c1" }),
    );
    // Le compte est vérifié contre LE client de session.
    expect(mockAccountFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acc1", clientId: "c1" } }),
    );
    expect(mockOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: "c1" }) }),
    );
  });

  it("externe sans client rattaché → Forbidden", async () => {
    await expect(
      createOrder(baseInput(), ctx("EXTERNAL_GENERATOR", { clientId: null })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin sans clientId explicite → ValidationError", async () => {
    await expect(createOrder(baseInput(), ctx("ADMIN"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("modèle hors allowlist du client → 404 anti-énumération (externe)", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(
      mockTemplate({ accesses: [{ clientId: "c-autre" }] }),
    );
    await expect(
      createOrder(baseInput(), ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("modèle archivé → 404", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(mockTemplate({ isArchived: true }));
    await expect(
      createOrder(baseInput(), ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("compte hors du client → ValidationError", async () => {
    mockAccountFindFirst.mockResolvedValue(null);
    await expect(
      createOrder(baseInput(), ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toThrow(/Compte Instagram invalide/);
  });

  it("compte requis quand un type l'exige", async () => {
    await expect(
      createOrder(baseInput({ accountId: null }), ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toThrow(/compte Instagram est requis/);
  });

  it("fiche inattendue (type hors modèle) → ValidationError", async () => {
    await expect(
      createOrder(
        baseInput({
          fiches: [
            { entityTypeId: "etype_bien", label: "V" },
            { entityTypeId: "etype_tournage", label: "T", scheduledAt: "2026-09-01T09:00:00Z" },
            { entityTypeId: "etype_intrus", label: "X" },
          ],
        }),
        ctx("EXTERNAL_GENERATOR", { clientId: "c1" }),
      ),
    ).rejects.toThrow(/inattendue/);
  });

  it("fiche manquante → ValidationError", async () => {
    await expect(
      createOrder(
        baseInput({ fiches: [{ entityTypeId: "etype_bien", label: "V" }] }),
        ctx("EXTERNAL_GENERATOR", { clientId: "c1" }),
      ),
    ).rejects.toThrow(/Tournage » est requise/);
  });

  it("câble relatedEntityId : le tournage pointe la fiche data précédente", async () => {
    await createOrder(baseInput(), ctx("EXTERNAL_GENERATOR", { clientId: "c1" }));
    // 2 créations : e1 (bien, related null) puis e2 (tournage, related e1).
    const calls = mockEntityCreate.mock.calls as { data: Record<string, unknown> }[][];
    expect(calls[0][0].data.relatedEntityId).toBeNull();
    expect(calls[1][0].data.relatedEntityId).toBe("e1");
    expect(calls[1][0].data.orderId).toBe("o1");
  });
});

describe("validateOrder — instanciation", () => {
  function setupValidate(recipes: unknown[], entities: unknown[]) {
    // loadOrderForTransition
    mockOrderFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      // le select du détail contient orderTemplate → renvoyer le détail complet
      if (args?.select && "orderTemplate" in args.select) return orderDetail;
      return { id: "o1", clientId: "c1", status: "SUBMITTED", accountId: "acc1" };
    });
    mockEntityFindMany.mockResolvedValue(entities);
    mockOrderFindUniqueOrThrow.mockResolvedValue({
      id: "o1",
      accountId: "acc1",
      orderTemplate: { recipes },
      entities,
    });
  }

  const shootEntity = {
    id: "e-tournage",
    typeId: "etype_tournage",
    label: "Tournage",
    validationStatus: "PENDING_ADMIN",
    type: { hasPlanning: true, hasRushes: true },
  };
  const bienEntity = {
    id: "e-bien",
    typeId: "etype_bien",
    label: "Villa",
    validationStatus: "PENDING_ADMIN",
    type: { hasPlanning: false, hasRushes: false },
  };

  it("réservé aux admins", async () => {
    await expect(
      validateOrder("o1", ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("recette manual_rushes ×2 + tournage → 2 attaches reel sur le tournage", async () => {
    setupValidate(
      [
        {
          count: 2,
          patternTemplate: {
            id: "pt1",
            label: "Reel visite",
            source: "manual_rushes",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [bienEntity, shootEntity],
    );
    mockAttachSlotToEntity.mockResolvedValue({ mode: "reel", slot: { id: "s1" } });

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(2);
    expect(mockAttachSlotToEntity).toHaveBeenCalledWith(
      "e-tournage",
      expect.objectContaining({ patternTemplateId: "pt1", propertyId: "e-bien", orderId: "o1" }),
      expect.anything(),
    );
    expect(result.failed).toEqual([]);
    // Fiches approuvées + commande VALIDATED.
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: "APPROVED" } }),
    );
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["SUBMITTED", "REJECTED"] } }),
        data: expect.objectContaining({ status: "VALIDATED" }),
      }),
    );
  });

  it("recette auto_template + fiche data → chemin missions", async () => {
    setupValidate(
      [
        {
          count: 1,
          patternTemplate: {
            id: "pt2",
            label: "Post auto",
            source: "auto_template",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [bienEntity, shootEntity],
    );
    mockAttachSlotToEntity.mockResolvedValue({
      mode: "missions",
      createdIds: ["s2"],
      count: 1,
      failed: [],
    });

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(mockAttachSlotToEntity).toHaveBeenCalledWith(
      "e-bien",
      expect.objectContaining({ recipeIds: ["pt2"], accountId: "acc1", orderId: "o1" }),
      expect.anything(),
    );
    expect(result.createdSlotIds).toEqual(["s2"]);
  });

  it("aucune fiche → createSlot direct", async () => {
    setupValidate(
      [
        {
          count: 1,
          patternTemplate: {
            id: "pt3",
            label: "Stock",
            source: "auto_template",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [],
    );
    mockCreateSlot.mockResolvedValue({ id: "s3" });

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(mockCreateSlot).toHaveBeenCalledWith(
      expect.objectContaining({ patternTemplateId: "pt3", accountId: "acc1", orderId: "o1" }),
      expect.anything(),
    );
    expect(result.createdSlotIds).toEqual(["s3"]);
  });

  it("CAS perdu (double validation concurrente) → ConflictError, zéro instanciation", async () => {
    setupValidate(
      [
        {
          count: 1,
          patternTemplate: {
            id: "pt1",
            label: "Reel visite",
            source: "manual_rushes",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [shootEntity],
    );
    mockOrderUpdateMany.mockResolvedValue({ count: 0 });
    await expect(validateOrder("o1", ctx("ADMIN"))).rejects.toBeInstanceOf(ConflictError);
    expect(mockAttachSlotToEntity).not.toHaveBeenCalled();
  });

  it("idempotence : re-validation d'une commande VALIDATED ne crée que les slots manquants", async () => {
    setupValidate(
      [
        {
          count: 2,
          patternTemplate: {
            id: "pt1",
            label: "Reel visite",
            source: "manual_rushes",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [shootEntity],
    );
    // Statut déjà VALIDATED → transition sautée ; 1 slot existe déjà.
    mockOrderFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "orderTemplate" in args.select) return orderDetail;
      return { id: "o1", clientId: "c1", status: "VALIDATED", accountId: "acc1" };
    });
    mockSlotCount.mockResolvedValue(1);
    mockAttachSlotToEntity.mockResolvedValue({ mode: "reel", slot: { id: "s-missing" } });

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(mockOrderUpdateMany).not.toHaveBeenCalled();
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(1);
    expect(result.createdSlotIds).toEqual(["s-missing"]);
  });

  it("échec d'une recette isolé dans failed[], les autres passent", async () => {
    setupValidate(
      [
        {
          count: 2,
          patternTemplate: {
            id: "pt1",
            label: "Reel visite",
            source: "manual_rushes",
            requiresProperty: false,
            requiresEntityTypeId: null,
          },
        },
      ],
      [shootEntity],
    );
    mockAttachSlotToEntity
      .mockResolvedValueOnce({ mode: "reel", slot: { id: "s1" } })
      .mockRejectedValueOnce(new Error("binding manquant"));

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.createdSlotIds).toEqual(["s1"]);
    expect(result.failed).toEqual([
      { patternTemplateId: "pt1", label: "Reel visite", error: "binding manquant" },
    ]);
  });
});

describe("rejectOrder / cancelOrder", () => {
  beforeEach(() => {
    mockOrderFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "orderTemplate" in args.select) return orderDetail;
      return { id: "o1", clientId: "c1", status: "SUBMITTED", accountId: "acc1" };
    });
    mockEntityFindMany.mockResolvedValue([]);
  });

  it("reject : motif requis", async () => {
    await expect(rejectOrder("o1", "  ", ctx("ADMIN"))).rejects.toThrow(/motif/);
  });

  it("cancel externe : uniquement sa commande, tant que SUBMITTED ; fiches bloquantes nettoyées", async () => {
    mockEntityFindMany.mockResolvedValue([{ id: "e1", validationStatus: "PENDING_ADMIN" }]);
    await cancelOrder("o1", ctx("EXTERNAL_GENERATOR", { clientId: "c1" }));
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["SUBMITTED", "REJECTED"] } }),
        data: { status: "CANCELLED" },
      }),
    );
    // La demande de validation meurt avec la commande.
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validationStatus: null } }),
    );

    // Hors périmètre → 404.
    mockOrderFindUnique.mockResolvedValue({
      id: "o1",
      clientId: "c-autre",
      status: "SUBMITTED",
      accountId: null,
    });
    await expect(
      cancelOrder("o1", ctx("EXTERNAL_GENERATOR", { clientId: "c1" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancel admin : 409 si publications actives", async () => {
    mockSlotCount.mockResolvedValue(2);
    await expect(cancelOrder("o1", ctx("ADMIN"))).rejects.toBeInstanceOf(ConflictError);
  });
});

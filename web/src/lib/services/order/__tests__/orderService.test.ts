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
const mockBindingFindMany = vi.fn(async () => []);
const mockEntityFindMany = vi.fn();
const mockEntityCreate = vi.fn();
const mockEntityUpdate = vi.fn();
// Aucune fiche n'exige de compte : la garde « compte supprimé » laisse passer.
const mockEntityCount = vi.fn(async () => 0);
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
    patternBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    entity: {
      findMany: (...a: unknown[]) => mockEntityFindMany(...a),
      findFirst: (...a: unknown[]) => mockEntityFindFirst(...a),
      count: (...a: unknown[]) => mockEntityCount(...a),
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
  // Sa résolution propre est couverte dans entityService.test.ts ; ici on
  // vérifie seulement ce que validateOrder fait du résultat.
  resolveDefaultAssignees: (...a: unknown[]) => mockResolveDefaultAssignees(...a),
  // Signal informatif affiché sur la commande — sa détection est testée dans
  // entityService.test.ts.
  detectRecipeAssigneeConflicts: (...a: unknown[]) => mockDetectConflicts(...a),
}));

const mockDetectConflicts = vi.fn(async () => []);

const mockResolveDefaultAssignees = vi.fn(
  async (
    _accountId: unknown,
    _recipeIds: unknown,
    provided: { videasteId: string | null; monteurId: string | null; cmId: string | null },
  ) => provided,
);

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
    recipes: [],
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
  it("libellé des fiches suivantes dérivé de la première, pas de celui envoyé", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(mockTemplate());
    await createOrder(
      {
        orderTemplateId: "ot1",
        accountId: "acc1",
        fiches: [
          { entityTypeId: "etype_bien", label: "12 rue des Lilas" },
          // Ce que le client envoie pour la fiche suivante est ignoré.
          { entityTypeId: "etype_tournage", label: "n'importe quoi" },
        ],
      },
      ctx("EXTERNAL_GENERATOR", { clientId: "c1" }),
    );
    const calls = mockPrepareEntityCreate.mock.calls as { label: string }[][];
    expect(calls[0][0].label).toBe("12 rue des Lilas");
    expect(calls[1][0].label).toBe("Tournage — 12 rue des Lilas");
  });
});

describe("validateOrder — instanciation", () => {
  /**
   * `recipes` accepte des lignes SANS `isOptional`/`defaultSelected` : on les
   * complète ici avec les défauts de la migration (imposée, pré-cochée). Les
   * fixtures existantes décrivent donc des commandes ANTÉRIEURES à la
   * sélection de vidéos, et doivent continuer à se comporter à l'identique.
   */
  function setupValidate(
    recipes: unknown[],
    entities: unknown[],
    recipeSelections: { patternTemplateId: string; count: number }[] = [],
  ) {
    recipes = (recipes as Record<string, unknown>[]).map((r) => ({
      isOptional: false,
      defaultSelected: true,
      minCount: 0,
      ...r,
    }));
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
      account: { handle: "compte" },
      orderTemplate: { name: "Bien + tournage", recipes },
      recipeSelections,
      // `backfillOrderAssignees` lit les fiches avec leur type et leurs
      // assignés ; les fixtures d'instanciation n'en portent pas.
      entities: (entities as { id?: string }[]).map((e) => ({
        assigneeVideasteId: "vid-1",
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
        label: "fiche",
        type: { hasPlanning: false, hasRushes: false, hasAssignees: false },
        ...e,
      })),
    });
    // Toutes les recettes du modèle sont actives sur le compte : la garde
    // « recette inactive » a ses propres tests plus bas.
    mockBindingFindMany.mockResolvedValue(
      (recipes as { patternTemplate?: { id?: string } }[]).map((r) => ({
        patternTemplateId: r.patternTemplate?.id ?? "pt-x",
        defaultAssigneeVideasteId: null,
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
      })),
    );
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

  /**
   * Le seul chemin de validation totalement muet : sans recette, la boucle
   * d'instanciation fait zéro tour et rend createdSlotIds ET failed vides.
   * La commande passait VALIDATED sans la moindre publication, sans erreur, et
   * sans même le bouton « Réessayer » (0 < 0 est faux). On refuse en amont.
   */
  it("refuse un modèle sans recette — et ne valide pas la commande", async () => {
    setupValidate([], [bienEntity, shootEntity]);

    await expect(validateOrder("o1", ctx("ADMIN"))).rejects.toBeInstanceOf(ValidationError);
    await expect(validateOrder("o1", ctx("ADMIN"))).rejects.toThrow(
      /ne déclenche aucune vidéo/,
    );
    // La garde est en amont de la transaction : rien n'a bougé en base.
    expect(mockOrderUpdateMany).not.toHaveBeenCalled();
    expect(mockAttachSlotToEntity).not.toHaveBeenCalled();
  });

  /**
   * `requested` distingue « 0 créée parce que tout existait déjà » de « 0 créée
   * parce que rien n'était demandé » — les deux rendaient le même couple vide.
   */
  it("remonte le nombre de vidéos demandées (requested)", async () => {
    setupValidate(
      [
        {
          count: 3,
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
    // Les 3 slots existent déjà : instanciation légitimement vide.
    mockSlotCount.mockResolvedValue(3);

    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(3);
    expect(result.createdSlotIds).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(mockAttachSlotToEntity).not.toHaveBeenCalled();
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

  const RECIPE_PT1 = {
    count: 1,
    patternTemplate: {
      id: "pt1",
      label: "RVA1",
      source: "manual_rushes",
      requiresProperty: false,
      requiresEntityTypeId: null,
    },
  };

  it("recette du modèle inactive sur le compte → ConflictError, zéro instanciation", async () => {
    setupValidate([RECIPE_PT1], [shootEntity]);
    // Aucun binding actif : la publication naîtrait sans horaire ni assignés,
    // invisible pour tout le monde.
    mockBindingFindMany.mockResolvedValue([]);
    await expect(validateOrder("o1", ctx("ADMIN"))).rejects.toBeInstanceOf(ConflictError);
    await expect(validateOrder("o1", ctx("ADMIN"))).rejects.toThrow(/RVA1.*n'est pas active/s);
    expect(mockAttachSlotToEntity).not.toHaveBeenCalled();
  });

  it("commande sans compte → pas de garde recette (recettes globales)", async () => {
    setupValidate([RECIPE_PT1], [shootEntity]);
    mockBindingFindMany.mockResolvedValue([]);
    mockOrderFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "orderTemplate" in args.select) return orderDetail;
      return { id: "o1", clientId: "c1", status: "SUBMITTED", accountId: null };
    });
    mockOrderFindUniqueOrThrow.mockResolvedValue({
      id: "o1",
      accountId: null,
      account: null,
      orderTemplate: { name: "Bien + tournage", recipes: [RECIPE_PT1] },
      recipeSelections: [],
      entities: [],
    });
    mockEntityFindMany.mockResolvedValue([]);
    await expect(validateOrder("o1", ctx("ADMIN"))).resolves.toBeDefined();
  });

  it("tournage sans vidéaste → remonté dans unassignedShoots", async () => {
    setupValidate([RECIPE_PT1], [shootEntity]);
    mockBindingFindMany.mockResolvedValue([
      {
        patternTemplateId: "pt1",
        defaultAssigneeVideasteId: null,
        defaultAssigneeMonteurId: "mon-1",
        defaultAssigneeCmId: null,
      },
    ]);
    mockOrderFindUniqueOrThrow.mockResolvedValue({
      id: "o1",
      accountId: "acc1",
      account: { handle: "compte" },
      orderTemplate: { name: "Bien + tournage", recipes: [RECIPE_PT1] },
      recipeSelections: [],
      entities: [
        {
          id: "e-tournage",
          label: "Tournage — 12 rue des Lilas",
          assigneeVideasteId: null,
          defaultAssigneeMonteurId: null,
          defaultAssigneeCmId: null,
          type: { hasPlanning: true, hasRushes: true, hasAssignees: true },
        },
      ],
    });
    mockResolveDefaultAssignees.mockResolvedValue({
      videasteId: null,
      monteurId: "mon-1",
      cmId: null,
    });
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.unassignedShoots).toEqual([
      { id: "e-tournage", label: "Tournage — 12 rue des Lilas" },
    ]);
    // Le monteur, lui, a bien été complété depuis la recette commandée.
    expect(mockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e-tournage" },
        data: expect.objectContaining({ defaultAssigneeMonteurId: "mon-1" }),
      }),
    );
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

/**
 * Vidéos au choix du demandeur (OrderRecipeSelection).
 *
 * Le test qui compte le plus est celui de non-régression : une commande
 * antérieure à la migration n'a AUCUNE sélection, et doit instancier
 * exactement ce qu'elle instanciait avant. C'est ce qui rend la migration
 * purement additive et dispense de tout backfill.
 */
describe("validateOrder — vidéos au choix du demandeur", () => {
  const shootFiche = {
    id: "e-tournage",
    typeId: "etype_tournage",
    label: "Tournage",
    validationStatus: "APPROVED",
    type: { hasPlanning: true, hasRushes: true },
  };

  function recipe(over: Record<string, unknown> = {}) {
    return {
      count: 3,
      isOptional: false,
      defaultSelected: true,
      minCount: 0,
      patternTemplate: {
        id: "pt1",
        label: "RVA1",
        source: "manual_rushes",
        requiresProperty: false,
        requiresEntityTypeId: null,
      },
      ...over,
    };
  }

  function setup(
    recipes: unknown[],
    recipeSelections: { patternTemplateId: string; count: number }[] = [],
  ) {
    mockOrderFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && "orderTemplate" in args.select) return orderDetail;
      return { id: "o1", clientId: "c1", status: "SUBMITTED", accountId: "acc1" };
    });
    mockEntityFindMany.mockResolvedValue([shootFiche]);
    mockOrderFindUniqueOrThrow.mockResolvedValue({
      id: "o1",
      accountId: "acc1",
      account: { handle: "compte" },
      orderTemplate: { name: "Modèle", recipes },
      recipeSelections,
      entities: [
        {
          ...shootFiche,
          assigneeVideasteId: "vid-1",
          defaultAssigneeMonteurId: null,
          defaultAssigneeCmId: null,
          type: { hasPlanning: true, hasRushes: true, hasAssignees: true },
        },
      ],
    });
    mockBindingFindMany.mockResolvedValue(
      (recipes as { patternTemplate: { id: string } }[]).map((r) => ({
        patternTemplateId: r.patternTemplate.id,
        defaultAssigneeVideasteId: null,
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
      })),
    );
    mockAttachSlotToEntity.mockResolvedValue({ mode: "reel", slot: { id: "s1" } });
  }

  // NON-RÉGRESSION : aucune sélection = comportement d'avant la migration.
  it("commande sans sélection → instancie count, comme avant", async () => {
    setup([recipe()]);
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(3);
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(3);
  });

  it("recette imposée → count, quelle que soit la sélection reçue", async () => {
    setup([recipe({ isOptional: false })], [{ patternTemplateId: "pt1", count: 1 }]);
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(3);
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(3);
  });

  it("recette optionnelle cochée → la quantité choisie", async () => {
    setup([recipe({ isOptional: true })], [{ patternTemplateId: "pt1", count: 2 }]);
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(2);
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(2);
  });

  it("recette optionnelle décochée (count 0) → aucune vidéo", async () => {
    setup([recipe({ isOptional: true })], [{ patternTemplateId: "pt1", count: 0 }]);
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(0);
    expect(mockAttachSlotToEntity).not.toHaveBeenCalled();
  });

  // Sans sélection enregistrée, une optionnelle suit son défaut : c'est ce qui
  // permet à l'admin de créer la commande sans passer par le formulaire négo.
  it("optionnelle sans sélection → suit defaultSelected", async () => {
    setup([recipe({ isOptional: true, defaultSelected: false })]);
    expect((await validateOrder("o1", ctx("ADMIN"))).requested).toBe(0);

    vi.clearAllMocks();
    mockOrderUpdateMany.mockResolvedValue({ count: 1 });
    mockSlotCount.mockResolvedValue(0);
    setup([recipe({ isOptional: true, defaultSelected: true })]);
    expect((await validateOrder("o1", ctx("ADMIN"))).requested).toBe(3);
  });

  // Garde-fou : une sélection au-dessus du plafond du modèle ne doit pas
  // permettre de commander plus que ce que l'admin a autorisé.
  it("une sélection au-dessus du plafond est ramenée à count", async () => {
    setup([recipe({ isOptional: true, count: 2 })], [{ patternTemplateId: "pt1", count: 99 }]);
    const result = await validateOrder("o1", ctx("ADMIN"));
    expect(result.requested).toBe(2);
    expect(mockAttachSlotToEntity).toHaveBeenCalledTimes(2);
  });
});

describe("createOrder — sélection de vidéos", () => {
  function templateWith(recipes: Record<string, unknown>[]) {
    return mockTemplate({
      recipes: recipes.map((r) => ({
        patternTemplateId: "pt1",
        count: 3,
        isOptional: false,
        defaultSelected: true,
        minCount: 0,
        ...r,
      })),
    });
  }

  it("refuse une recette hors du modèle", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(templateWith([{ isOptional: true }]));
    await expect(
      createOrder(
        baseInput({ recipes: [{ patternTemplateId: "pt-inconnu", count: 1 }], clientId: "c1" }),
        ctx("ADMIN"),
      ),
    ).rejects.toThrow(/hors du modèle/);
  });

  // Ne jamais croire le client sur une recette imposée : il pourrait s'en
  // servir pour retirer une vidéo que l'admin a rendue obligatoire.
  it("refuse de choisir une recette imposée", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(templateWith([{ isOptional: false }]));
    await expect(
      createOrder(
        baseInput({ recipes: [{ patternTemplateId: "pt1", count: 1 }], clientId: "c1" }),
        ctx("ADMIN"),
      ),
    ).rejects.toThrow(/imposée/);
  });

  it("refuse une quantité hors des bornes du modèle", async () => {
    mockOrderTemplateFindUnique.mockResolvedValue(
      templateWith([{ isOptional: true, count: 2, minCount: 1 }]),
    );
    for (const count of [0, 3]) {
      await expect(
        createOrder(
          baseInput({ recipes: [{ patternTemplateId: "pt1", count }], clientId: "c1" }),
          ctx("ADMIN"),
        ),
      ).rejects.toThrow(/Quantité invalide/);
    }
  });
});

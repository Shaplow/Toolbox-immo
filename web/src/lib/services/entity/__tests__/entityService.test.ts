/**
 * Tests entityService — fige :
 *  - createEntity : guards (admin, type/label/date/compte requis selon capacités)
 *  - computeShotTransition : logique pure PLANNED→SHOT
 *  - markEntityShot : transition + bump reels (via shootEntityId) + idempotence
 *
 * Port de event/__tests__/eventService.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEntityTypeFindUnique = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockEntityFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockBindingFindFirst = vi.fn();
const mockBindingFindMany = vi.fn(async () => []);
const mockEntityCreate = vi.fn();
const mockEntityUpdate = vi.fn();
const mockEntityActivityCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entityType: { findUnique: (...a: unknown[]) => mockEntityTypeFindUnique(...a) },
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    entity: {
      findUnique: (...a: unknown[]) => mockEntityFindUnique(...a),
      create: (...a: unknown[]) => mockEntityCreate(...a),
      update: (...a: unknown[]) => mockEntityUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    patternBinding: {
      findFirst: (...a: unknown[]) => mockBindingFindFirst(...a),
      findMany: (...a: unknown[]) => mockBindingFindMany(...a),
    },
    entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  createEntity,
  computeShotTransition,
  markEntityShot,
  patchEntity,
  resolveDefaultAssignees,
  detectRecipeAssigneeConflicts,
} from "@/lib/services/entity/entityService";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/services/_runtime/errors";

function adminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof createEntity>[1];
}

function nonAdminCtx() {
  return {
    ...adminCtx(),
    actualUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "v1", role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    canAdminBypass: false,
  } as Parameters<typeof createEntity>[1];
}

const BIEN_TYPE = {
  id: "etype_bien",
  name: "Bien",
  fieldSchema: "[]",
  labelTemplate: null,
  hasPlanning: false,
  hasAccount: false,
  hasRushes: false,
  hasAssignees: false,
  visibility: "admin",
};

const TOURNAGE_TYPE = {
  id: "etype_tournage",
  name: "Tournage",
  fieldSchema: "[]",
  labelTemplate: null,
  hasPlanning: true,
  hasAccount: true,
  hasRushes: true,
  hasAssignees: true,
  visibility: "team",
};

beforeEach(() => {
  mockEntityTypeFindUnique.mockReset().mockResolvedValue(BIEN_TYPE);
  mockAccountFindUnique.mockReset().mockResolvedValue({ id: "acc-1" });
  mockEntityFindUnique.mockReset().mockResolvedValue({ id: "rel-1", isArchived: false });
  mockUserFindUnique.mockReset();
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockEntityActivityCreate.mockReset().mockResolvedValue({ id: "act-1" });
  mockTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      entity: { create: (...a: unknown[]) => mockEntityCreate(...a) },
      entityActivity: { create: (...a: unknown[]) => mockEntityActivityCreate(...a) },
    }),
  );
  mockEntityCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "ent-new",
      ...data,
      type: { fieldSchema: "[]" },
    }),
  );
});

describe("createEntity — guards", () => {
  it("non-admin (canAdminBypass=false) → ForbiddenError", async () => {
    await expect(
      createEntity({ typeId: "etype_bien", label: "12 rue des Lilas" }, nonAdminCtx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sans typeId → ValidationError", async () => {
    await expect(
      createEntity({ typeId: "", label: "T" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type introuvable → NotFoundError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(null);
    await expect(
      createEntity({ typeId: "etype_ghost", label: "T" }, adminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sans label → ValidationError", async () => {
    await expect(
      createEntity({ typeId: "etype_bien", label: "   " }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning sans scheduledAt → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity({ typeId: "etype_tournage", label: "Tournage Villa", accountId: "acc-1" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning + date invalide → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        { typeId: "etype_tournage", label: "T", accountId: "acc-1", scheduledAt: "pas-une-date" },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasPlanning + endAt avant scheduledAt → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        {
          typeId: "etype_tournage",
          label: "T",
          accountId: "acc-1",
          scheduledAt: "2026-08-01T10:00:00Z",
          endAt: "2026-08-01T09:00:00Z",
        },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type.hasAccount sans accountId → ValidationError", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    await expect(
      createEntity(
        { typeId: "etype_tournage", label: "T", scheduledAt: "2026-08-01T10:00:00Z" },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path (fiche admin, ex-Bien) → crée la fiche + log CREATED", async () => {
    const entity = await createEntity(
      { typeId: "etype_bien", label: "12 rue des Lilas" },
      adminCtx(),
    );
    expect(entity.status).toBeNull();
    expect(mockEntityCreate).toHaveBeenCalledOnce();
    const arg = mockEntityCreate.mock.calls[0][0].data;
    expect(arg.label).toBe("12 rue des Lilas");
    expect(arg.createdByUserId).toBe("admin-1");
    expect(mockEntityActivityCreate).toHaveBeenCalled();
  });

  it("happy path (fiche team, ex-Tournage) → status initial PLANNED", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    const entity = await createEntity(
      { typeId: "etype_tournage", label: "Tournage Villa", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    expect(entity.status).toBe("PLANNED");
    const arg = mockEntityCreate.mock.calls[0][0].data;
    expect(arg.accountId).toBe("acc-1");
    expect(arg.status).toBe("PLANNED");
  });

  it("seed les trois assignés (vidéaste inclus) depuis les bindings du compte", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    mockBindingFindMany.mockResolvedValue([
      {
        patternTemplateId: "pt-1",
        defaultAssigneeVideasteId: "vid-def",
        defaultAssigneeMonteurId: "mon-def",
        defaultAssigneeCmId: "cm-def",
      },
    ]);
    await createEntity(
      { typeId: "etype_tournage", label: "T", accountId: "acc-1", scheduledAt: "2026-08-01T10:00:00Z" },
      adminCtx(),
    );
    const arg = mockEntityCreate.mock.calls[0][0].data;
    // Le vidéaste n'était jamais seedé : la worklist vidéaste lit
    // `Entity.assigneeVideasteId`, donc le tournage n'atteignait personne.
    expect(arg.assigneeVideasteId).toBe("vid-def");
    expect(arg.defaultAssigneeMonteurId).toBe("mon-def");
    expect(arg.defaultAssigneeCmId).toBe("cm-def");
  });

  it("premier rôle renseigné gagne, dans l'ordre des recettes commandées", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(TOURNAGE_TYPE);
    // findMany renvoie dans l'ordre de création ; `recipeTemplateIds` impose
    // l'ordre du modèle de commande.
    mockBindingFindMany.mockResolvedValue([
      {
        patternTemplateId: "pt-second",
        defaultAssigneeVideasteId: "vid-second",
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: "cm-second",
      },
      {
        patternTemplateId: "pt-first",
        defaultAssigneeVideasteId: "vid-first",
        defaultAssigneeMonteurId: "mon-first",
        defaultAssigneeCmId: null,
      },
    ]);
    const resolved = await resolveDefaultAssignees(
      "acc-1",
      ["pt-first", "pt-second"],
      { videasteId: null, monteurId: null, cmId: null },
    );
    expect(resolved).toEqual({
      videasteId: "vid-first",
      monteurId: "mon-first",
      cmId: "cm-second",
    });
  });

  it("cascade : la recette prime sur le compte", async () => {
    mockBindingFindMany.mockResolvedValue([
      {
        patternTemplateId: "pt-1",
        defaultAssigneeVideasteId: "vid-recette",
        defaultAssigneeMonteurId: null,
        defaultAssigneeCmId: null,
      },
    ]);
    mockAccountFindUnique.mockResolvedValue({
      defaultAssigneeVideasteId: "vid-compte",
      defaultAssigneeMonteurId: "mon-compte",
      defaultAssigneeCmId: "cm-compte",
    });
    const resolved = await resolveDefaultAssignees("acc-1", undefined, {
      videasteId: null,
      monteurId: null,
      cmId: null,
    });
    // Vidéaste surchargé par la recette, le reste hérité du compte.
    expect(resolved).toEqual({
      videasteId: "vid-recette",
      monteurId: "mon-compte",
      cmId: "cm-compte",
    });
  });

  it("cascade : sans aucun binding, l'équipe du compte s'applique", async () => {
    mockBindingFindMany.mockResolvedValue([]);
    mockAccountFindUnique.mockResolvedValue({
      defaultAssigneeVideasteId: "vid-compte",
      defaultAssigneeMonteurId: "mon-compte",
      defaultAssigneeCmId: "cm-compte",
    });
    const resolved = await resolveDefaultAssignees("acc-1", ["pt-inconnue"], {
      videasteId: null,
      monteurId: null,
      cmId: null,
    });
    expect(resolved).toEqual({
      videasteId: "vid-compte",
      monteurId: "mon-compte",
      cmId: "cm-compte",
    });
  });

  it("une valeur fournie explicitement n'est jamais écrasée", async () => {
    mockAccountFindUnique.mockResolvedValue(null);
    mockBindingFindMany.mockResolvedValue([
      {
        patternTemplateId: "pt-1",
        defaultAssigneeVideasteId: "vid-def",
        defaultAssigneeMonteurId: "mon-def",
        defaultAssigneeCmId: "cm-def",
      },
    ]);
    const resolved = await resolveDefaultAssignees("acc-1", undefined, {
      videasteId: "vid-choisi",
      monteurId: null,
      cmId: null,
    });
    expect(resolved.videasteId).toBe("vid-choisi");
    expect(resolved.monteurId).toBe("mon-def");
  });
});

describe("computeShotTransition — pur", () => {
  it("PLANNED → transition SHOT + bump", () => {
    expect(computeShotTransition("PLANNED")).toEqual({ nextStatus: "SHOT", bumpReels: true });
  });

  it("SHOT / DONE / CANCELLED / null → null (idempotent)", () => {
    expect(computeShotTransition("SHOT")).toBeNull();
    expect(computeShotTransition("DONE")).toBeNull();
    expect(computeShotTransition("CANCELLED")).toBeNull();
    expect(computeShotTransition(null)).toBeNull();
  });
});

describe("markEntityShot — DB", () => {
  function fakeDb(status: string) {
    const entityUpdate = vi.fn().mockResolvedValue({});
    const slotUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const activityCreate = vi.fn().mockResolvedValue({ id: "a" });
    return {
      db: {
        entity: {
          findUnique: vi.fn().mockResolvedValue({ id: "ent-1", status }),
          update: entityUpdate,
        },
        publicationSlot: { updateMany: slotUpdateMany },
        entityActivity: { create: activityCreate },
      },
      entityUpdate,
      slotUpdateMany,
      activityCreate,
    };
  }

  it("PLANNED → passe SHOT, bump les reels via shootEntityId, log SHOT", async () => {
    const f = fakeDb("PLANNED");
    const res = await markEntityShot(f.db as never, "ent-1", "actor-1");
    expect(res).toEqual({ transitioned: true, bumpedReels: 2 });
    expect(f.entityUpdate).toHaveBeenCalledOnce();
    const upd = f.entityUpdate.mock.calls[0][0];
    expect(upd.data.status).toBe("SHOT");
    expect(upd.data.shotAt).toBeInstanceOf(Date);
    expect(f.slotUpdateMany).toHaveBeenCalledOnce();
    const bump = f.slotUpdateMany.mock.calls[0][0];
    expect(bump.where.shootEntityId).toBe("ent-1");
    expect(bump.where.status.in).toEqual(["PLANNED", "RUSHES_EXPECTED"]);
    expect(bump.data.status).toBe("IN_EDIT");
    expect(f.activityCreate).toHaveBeenCalled();
  });

  it("déjà SHOT → no-op idempotent", async () => {
    const f = fakeDb("SHOT");
    const res = await markEntityShot(f.db as never, "ent-1", null);
    expect(res).toEqual({ transitioned: false, bumpedReels: 0 });
    expect(f.entityUpdate).not.toHaveBeenCalled();
    expect(f.slotUpdateMany).not.toHaveBeenCalled();
  });
});

describe("detectRecipeAssigneeConflicts", () => {
  const binding = (
    id: string,
    label: string,
    videasteId: string | null,
    videasteName: string | null,
  ) => ({
    patternTemplateId: id,
    customLabel: null,
    patternTemplate: { label },
    defaultAssigneeVideasteId: videasteId,
    defaultAssigneeVideaste: videasteName ? { name: videasteName } : null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeMonteur: null,
    defaultAssigneeCmId: null,
    defaultAssigneeCm: null,
  });

  it("deux recettes sur A, une sur B → conflit, A retenu (ordre du modèle)", async () => {
    mockBindingFindMany.mockResolvedValue([
      binding("pt-3", "RVA3", "vid-b", "Bob"),
      binding("pt-1", "RVA1", "vid-a", "Alice"),
      binding("pt-2", "RVA2", "vid-a", "Alice"),
    ]);
    const conflicts = await detectRecipeAssigneeConflicts("acc-1", ["pt-1", "pt-2", "pt-3"]);
    expect(conflicts).toEqual([
      {
        role: "videaste",
        keptName: "Alice",
        keptRecipeLabel: "RVA1",
        ignored: [{ recipeLabel: "RVA3", name: "Bob" }],
      },
    ]);
  });

  it("toutes les recettes d'accord → aucun conflit", async () => {
    mockBindingFindMany.mockResolvedValue([
      binding("pt-1", "RVA1", "vid-a", "Alice"),
      binding("pt-2", "RVA2", "vid-a", "Alice"),
    ]);
    expect(await detectRecipeAssigneeConflicts("acc-1", ["pt-1", "pt-2"])).toEqual([]);
  });

  it("sans compte ou sans recette commandée → pas de requête", async () => {
    mockBindingFindMany.mockClear();
    expect(await detectRecipeAssigneeConflicts(null, ["pt-1"])).toEqual([]);
    expect(await detectRecipeAssigneeConflicts("acc-1", [])).toEqual([]);
    expect(mockBindingFindMany).not.toHaveBeenCalled();
  });
});

describe("patchEntity — confirmation de disponibilité du vidéaste", () => {
  const TOURNAGE_ACCESS = {
    id: "ent-1",
    typeId: "etype_tournage",
    type: { visibility: "team", hasPlanning: true, fieldSchema: "[]" },
    orderId: null,
    order: null,
    status: "PLANNED",
    scheduledAt: null,
    endAt: null,
    validationStatus: "APPROVED",
    assigneeVideasteId: "v1",
    videasteConfirmation: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    shootSlots: [],
  };

  beforeEach(() => {
    mockEntityUpdate.mockClear();
    mockEntityFindUnique.mockResolvedValue(TOURNAGE_ACCESS);
    // Le retour passe par withParsedFields → il faut un `type` sérialisable.
    const updated = { id: "ent-1", fields: "{}", type: { fieldSchema: "[]" } };
    mockEntityUpdate.mockResolvedValue(updated);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        entity: {
          update: (...a: unknown[]) => mockEntityUpdate(...a),
          findUnique: () => updated,
        },
        entityActivity: { create: mockEntityActivityCreate },
      }),
    );
  });

  it("le vidéaste assigné confirme → horodatage posé", async () => {
    await patchEntity("ent-1", { videasteConfirmation: "CONFIRMED" }, nonAdminCtx());
    const data = mockEntityUpdate.mock.calls[0][0].data;
    expect(data.videasteConfirmation).toBe("CONFIRMED");
    expect(data.videasteConfirmationAt).toBeInstanceOf(Date);
    // Une confirmation efface le motif d'une indisponibilité précédente.
    expect(data.videasteDeclineReason).toBeNull();
  });

  it("un autre vidéaste (accès via un reel) ne répond pas à la place de l'assigné", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...TOURNAGE_ACCESS,
      assigneeVideasteId: "v-autre",
      shootSlots: [{ assigneeMonteurId: null, assigneeCmId: null, assigneeVideasteId: "v1" }],
    });
    await expect(
      patchEntity("ent-1", { videasteConfirmation: "CONFIRMED" }, nonAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("tournage encore en attente de validation admin → refus", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...TOURNAGE_ACCESS,
      validationStatus: "PENDING_ADMIN",
    });
    await expect(
      patchEntity("ent-1", { videasteConfirmation: "CONFIRMED" }, nonAdminCtx()),
    ).rejects.toThrow();
  });

  it("le vidéaste décliné peut se raviser (DECLINED → CONFIRMED)", async () => {
    // Le serveur l'a toujours accepté ; c'est l'UI qui masquait le bouton et
    // enfermait le vidéaste dans son refus.
    mockEntityFindUnique.mockResolvedValue({
      ...TOURNAGE_ACCESS,
      videasteConfirmation: "DECLINED",
    });
    await patchEntity("ent-1", { videasteConfirmation: "CONFIRMED" }, nonAdminCtx());
    const data = mockEntityUpdate.mock.calls[0][0].data;
    expect(data.videasteConfirmation).toBe("CONFIRMED");
    expect(data.videasteDeclineReason).toBeNull();
  });

  it("le motif d'indisponibilité est borné à 500 caractères", async () => {
    await patchEntity(
      "ent-1",
      { videasteConfirmation: "DECLINED", videasteDeclineReason: "x".repeat(900) },
      nonAdminCtx(),
    );
    const data = mockEntityUpdate.mock.calls[0][0].data;
    expect((data.videasteDeclineReason as string).length).toBe(500);
  });

  it("l'admin relance la demande (null) → réponse effacée, assigné conservé", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...TOURNAGE_ACCESS,
      videasteConfirmation: "DECLINED",
    });
    await patchEntity("ent-1", { videasteConfirmation: null }, adminCtx());
    const data = mockEntityUpdate.mock.calls[0][0].data;
    expect(data.videasteConfirmation).toBeNull();
    expect(data.videasteConfirmationAt).toBeNull();
    expect(data.videasteDeclineReason).toBeNull();
    // L'assigné reste : c'est tout l'intérêt face à une réassignation.
    expect(data.assigneeVideasteId).toBeUndefined();
  });

  it("un non-admin ne peut pas relancer la demande", async () => {
    // La whitelist VIDEASTE laisse passer la clé — la garde est dans le service.
    await expect(
      patchEntity("ent-1", { videasteConfirmation: null }, nonAdminCtx()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("l'admin réassigne le vidéaste → la confirmation repart de zéro", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...TOURNAGE_ACCESS,
      videasteConfirmation: "CONFIRMED",
    });
    mockUserFindUnique.mockResolvedValue({ id: "v2", role: "VIDEASTE" });
    await patchEntity("ent-1", { assigneeVideasteId: "v2" }, adminCtx());
    const data = mockEntityUpdate.mock.calls[0][0].data;
    expect(data.assigneeVideasteId).toBe("v2");
    expect(data.videasteConfirmation).toBeNull();
    expect(data.videasteConfirmationAt).toBeNull();
    expect(data.videasteDeclineReason).toBeNull();
  });
});

describe("prepareEntityCreate — libellé automatique", () => {
  const AVEC_MODELE = {
    ...BIEN_TYPE,
    fieldSchema: JSON.stringify([
      { key: "adresse", label: "Adresse", type: "text" },
      { key: "ville", label: "Ville", type: "text" },
    ]),
    labelTemplate: "{{adresse}}, {{ville}}",
  };

  it("type à modèle → libellé dérivé des champs, le label envoyé est ignoré", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(AVEC_MODELE);
    await createEntity(
      {
        typeId: "etype_bien",
        label: "n'importe quoi",
        fields: { adresse: "12 rue des Lilas", ville: "Lyon" },
      },
      adminCtx(),
    );
    const data = mockEntityCreate.mock.calls.at(-1)![0].data;
    expect(data.label).toBe("12 rue des Lilas, Lyon");
    expect(data.labelIsCustom).toBe(false);
  });

  it("type à modèle + champs vides → repli daté, AUCUNE erreur", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(AVEC_MODELE);
    await expect(
      createEntity({ typeId: "etype_bien", label: "", fields: {} }, adminCtx()),
    ).resolves.toBeDefined();
    const data = mockEntityCreate.mock.calls.at(-1)![0].data;
    expect(data.label).toMatch(/^Bien du \d{2}\/\d{2}\/\d{4}$/);
    expect(data.labelIsCustom).toBe(false);
  });

  it("type sans modèle → libellé requis (comportement historique)", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(BIEN_TYPE);
    await expect(
      createEntity({ typeId: "etype_bien", label: "   " }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("type sans modèle + libellé saisi → verrouillé d'emblée", async () => {
    mockEntityTypeFindUnique.mockResolvedValue(BIEN_TYPE);
    await createEntity({ typeId: "etype_bien", label: "Saisi à la main" }, adminCtx());
    const data = mockEntityCreate.mock.calls.at(-1)![0].data;
    expect(data.label).toBe("Saisi à la main");
    expect(data.labelIsCustom).toBe(true);
  });

  it("champs invalides → l'erreur de champ remonte AVANT toute dérivation", async () => {
    // Fige le réordonnancement : le libellé dépend désormais des champs.
    mockEntityTypeFindUnique.mockResolvedValue({
      ...AVEC_MODELE,
      fieldSchema: JSON.stringify([
        { key: "type", label: "Type", type: "select", options: ["vente", "location"] },
      ]),
    });
    await expect(
      createEntity(
        { typeId: "etype_bien", label: "", fields: { type: "hors-options" } },
        adminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockEntityCreate).not.toHaveBeenCalled();
  });
});

describe("patchEntity — libellé automatique", () => {
  const TYPE_AVEC_MODELE = {
    visibility: "admin",
    hasPlanning: false,
    fieldSchema: JSON.stringify([{ key: "adresse", label: "Adresse", type: "text" }]),
    name: "Bien",
    labelTemplate: "{{adresse}}",
  };
  const BASE = {
    id: "ent-1",
    typeId: "etype_bien",
    type: TYPE_AVEC_MODELE,
    label: "12 rue des Lilas",
    labelIsCustom: false,
    fields: JSON.stringify({ adresse: "12 rue des Lilas" }),
    orderId: null,
    order: null,
    status: null,
    scheduledAt: null,
    endAt: null,
    validationStatus: "APPROVED",
    assigneeVideasteId: null,
    videasteConfirmation: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    shootSlots: [],
  };

  function lastUpdateData() {
    return mockEntityUpdate.mock.calls.at(-1)![0].data as Record<string, unknown>;
  }

  beforeEach(() => {
    mockEntityUpdate.mockClear();
    mockEntityFindUnique.mockResolvedValue(BASE);
    const updated = { id: "ent-1", fields: "{}", type: { fieldSchema: "[]" } };
    mockEntityUpdate.mockResolvedValue(updated);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        entity: {
          update: (...a: unknown[]) => mockEntityUpdate(...a),
          findUnique: () => updated,
        },
        entityActivity: { create: mockEntityActivityCreate },
      }),
    );
  });

  it("champs modifiés, libellé non personnalisé → recalcul", async () => {
    await patchEntity("ent-1", { fields: { adresse: "8 avenue Foch" } }, adminCtx());
    expect(lastUpdateData().label).toBe("8 avenue Foch");
  });

  it("champs modifiés, libellé personnalisé → le libellé ne bouge PAS", async () => {
    mockEntityFindUnique.mockResolvedValue({ ...BASE, labelIsCustom: true });
    await patchEntity("ent-1", { fields: { adresse: "8 avenue Foch" } }, adminCtx());
    expect(lastUpdateData().label).toBeUndefined();
  });

  it("champs modifiés sur un type SANS modèle → pas de recalcul", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...BASE,
      type: { ...TYPE_AVEC_MODELE, labelTemplate: null },
    });
    await patchEntity("ent-1", { fields: { adresse: "8 avenue Foch" } }, adminCtx());
    expect(lastUpdateData().label).toBeUndefined();
  });

  it("renommage manuel → verrou posé", async () => {
    await patchEntity("ent-1", { label: "Mon nom à moi" }, adminCtx());
    const data = lastUpdateData();
    expect(data.label).toBe("Mon nom à moi");
    expect(data.labelIsCustom).toBe(true);
  });

  it("libellé renvoyé À L'IDENTIQUE → pas de verrou (anti round-trip)", async () => {
    await patchEntity("ent-1", { label: "12 rue des Lilas" }, adminCtx());
    expect(lastUpdateData().labelIsCustom).toBeUndefined();
  });

  it("labelIsCustom:false → retour à l'automatique, recalcul immédiat", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...BASE,
      labelIsCustom: true,
      label: "Mon nom à moi",
    });
    await patchEntity("ent-1", { labelIsCustom: false }, adminCtx());
    const data = lastUpdateData();
    expect(data.label).toBe("12 rue des Lilas");
    expect(data.labelIsCustom).toBe(false);
  });

  it("labelIsCustom:true explicite → refusé", async () => {
    await expect(
      patchEntity("ent-1", { labelIsCustom: true }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("labelIsCustom:false sur un type sans modèle → refusé", async () => {
    mockEntityFindUnique.mockResolvedValue({
      ...BASE,
      labelIsCustom: true,
      type: { ...TYPE_AVEC_MODELE, labelTemplate: null },
    });
    await expect(
      patchEntity("ent-1", { labelIsCustom: false }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

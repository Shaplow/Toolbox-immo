/**
 * Tests d'intégration sur createSlot — fige les invariants critiques :
 *
 *  1. ForbiddenError si non-admin (canAdminBypass=false)
 *  2. ValidationError si ni compte ni recette (Missions : compte optionnel mais
 *     recette obligatoire quand pas de compte ; scheduledAt optionnel = banque)
 *  3. ValidationError si pattern d'un autre compte (cross-account guard)
 *  4. ValidationError si pattern inexistant
 *  5. Préfille les assignees depuis pattern.default* (override admin prime)
 *  6. Status initial dérivé de pattern.source
 *  7. Cross-field : needsCaptions sans preset → rejet
 *  8. Cross-field : autoGenerate sans prompt → rejet
 *  9. Cross-field : coverMode=auto sans preset → rejet
 * 10. Compte inexistant → NotFoundError
 *
 * Prisma mocké au niveau module — tests vitest unit purs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotCreate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
// Recette canonique : PatternBinding (les tests binding le surchargent).
const mockBindingFindUnique = vi.fn().mockResolvedValue(null);
const mockBindingFindFirst = vi.fn().mockResolvedValue(null);
// Missions — résolution recette GLOBALE directe (patternTemplateId).
const mockPatternTemplateFindUnique = vi.fn().mockResolvedValue(null);
// Fiche (Entity, Phase 5) — validation existence/archivage du propertyId (clé API).
const mockEntityFindUnique = vi.fn().mockResolvedValue({ id: "prop-1", typeId: "etype_bien", isArchived: false, fields: "{}" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      create: (...args: unknown[]) => mockSlotCreate(...args),
    },
    patternTemplate: {
      findUnique: (...args: unknown[]) => mockPatternTemplateFindUnique(...args),
    },
    patternBinding: {
      findUnique: (...args: unknown[]) => mockBindingFindUnique(...args),
      findFirst: (...args: unknown[]) => mockBindingFindFirst(...args),
    },
    instagramAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    entity: {
      findUnique: (...args: unknown[]) => mockEntityFindUnique(...args),
    },
  },
}));

import { createSlot } from "@/lib/services/slot/slotService";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/_runtime/errors";

function makeAdminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof createSlot>[1];
}

function makeNonAdminCtx() {
  return {
    session: {} as unknown,
    actualUser: { id: "user-1", role: "MONTEUR", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "user-1", role: "MONTEUR", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: false,
  } as Parameters<typeof createSlot>[1];
}

/** PatternBinding mock (recette appliquée au compte) — chemin canonique createSlot. */
function makeBindingRow(
  templateOver: Record<string, unknown> = {},
  bindingOver: Record<string, unknown> = {},
) {
  return {
    id: "binding-A",
    accountId: "account-A",
    customLabel: null,
    captionPresetIdOverride: null,
    descriptionPromptIdOverride: null,
    coverModeOverride: null,
    templateIdOverride: null,
    defaultAssigneeMonteurId: null,
    defaultAssigneeCmId: null,
    defaultAssigneeVideasteId: null,
    patternTemplate: {
      id: "tpl-A",
      label: "Recette A",
      source: "auto_template",
      templateId: null,
      requiresProperty: false,
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      descriptionSourceFieldKey: null,
      descriptionFixedText: null,
      coverMode: "none",
      coverConfig: null,
      ...templateOver,
    },
    ...bindingOver,
  };
}

beforeEach(() => {
  mockSlotCreate.mockReset();
  mockAccountFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockBindingFindUnique.mockReset().mockResolvedValue(null);
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockPatternTemplateFindUnique.mockReset().mockResolvedValue(null);
  mockEntityFindUnique.mockReset().mockResolvedValue({ id: "prop-1", typeId: "etype_bien", isArchived: false, fields: "{}" });

  // Mock par défaut : create renvoie un objet stub plausible
  mockSlotCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "slot-new",
      ...data,
      account: { id: data.accountId, name: "Test", handle: "test" },
    }),
  );

  // Compte par défaut
  mockAccountFindUnique.mockResolvedValue({ id: "account-A", name: "Test", handle: "test" });
});

// ─── Invariant 1 : ForbiddenError si non-admin ──────────────────────────────

describe("createSlot — auth ADMIN only", () => {
  it("MONTEUR (canAdminBypass=false) → ForbiddenError", async () => {
    await expect(
      createSlot(
        { accountId: "account-A", scheduledAt: "2026-06-01T10:00:00Z" },
        makeNonAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Impersonation (canAdminBypass=false) → ForbiddenError", async () => {
    const impersonatingCtx = makeAdminCtx();
    impersonatingCtx.canAdminBypass = false;
    await expect(
      createSlot(
        { accountId: "account-A", scheduledAt: "2026-06-01T10:00:00Z" },
        impersonatingCtx,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── Invariant 2 : champs requis ────────────────────────────────────────────

describe("createSlot — champs requis", () => {
  it("ni compte ni recette → ValidationError", async () => {
    // Missions : accountId est devenu optionnel, mais une mission sans compte
    // DOIT porter une recette (patternTemplateId). Aucun des deux → rejet.
    await expect(
      createSlot(
        { accountId: "", scheduledAt: "2026-06-01T10:00:00Z" },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("scheduledAt vide → mission en banque (scheduledAt null, pas d'erreur)", async () => {
    // Contrat élargi (Missions) : une date absente crée un slot en banque
    // (comme bulkStockSlots), plus un rejet.
    const slot = await createSlot(
      { accountId: "account-A", scheduledAt: "" },
      makeAdminCtx(),
    );
    expect(slot.scheduledAt).toBeNull();
    expect(mockSlotCreate).toHaveBeenCalledOnce();
  });

  it("scheduledAt invalide → ValidationError", async () => {
    await expect(
      createSlot(
        { accountId: "account-A", scheduledAt: "pas-une-date" },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("mission : patternTemplateId sans compte → slot créé (compte null, fieldSchema hérité)", async () => {
    mockPatternTemplateFindUnique.mockResolvedValue({
      id: "tpl-1",
      label: "Recette Mission",
      source: "auto_template",
      isArchived: false,
      captionPresetId: "capt-1",
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      fieldSchema: JSON.stringify(["adresse", "prix"]),
    });

    const slot = await createSlot(
      { patternTemplateId: "tpl-1" },
      makeAdminCtx(),
    );

    expect(mockPatternTemplateFindUnique).toHaveBeenCalledOnce();
    // Compte non résolu (mission stock) + aucun findUnique compte déclenché.
    expect(slot.accountId).toBeNull();
    expect(mockAccountFindUnique).not.toHaveBeenCalled();
    // fieldSchema est toujours [] : les champs perso viennent du bien, pas de la recette.
    expect(slot.fieldSchema).toEqual([]);
    // Titre par défaut = label de la recette.
    expect(slot.title).toBe("Recette Mission");
  });

  it("mission : recette archivée → ValidationError", async () => {
    mockPatternTemplateFindUnique.mockResolvedValue({
      id: "tpl-archived",
      label: "Ancienne",
      source: "auto_template",
      isArchived: true,
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      fieldSchema: "[]",
    });
    await expect(
      createSlot({ patternTemplateId: "tpl-archived" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("mission avec compte + binding existant → hérite des assignés par défaut du binding", async () => {
    // Un binding existe pour (compte, recette) → il doit être résolu et ses
    // assignés par défaut (monteur/cm/vidéaste) reportés sur la mission.
    mockBindingFindFirst.mockResolvedValue({ id: "binding-1" });
    mockBindingFindUnique.mockResolvedValue({
      id: "binding-1",
      accountId: "account-A",
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      defaultAssigneeMonteurId: "monteur-1",
      defaultAssigneeCmId: "cm-1",
      defaultAssigneeVideasteId: "videaste-1",
      patternTemplate: {
        label: "Recette Compte",
        source: "auto_template",
        captionPresetId: "capt-1",
        descriptionPromptId: null,
        needsCaptions: false,
        needsDescription: "none",
        coverMode: "none",
        coverConfig: null,
      },
    });
    mockUserFindUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const roleById: Record<string, string> = {
          "monteur-1": "MONTEUR",
          "cm-1": "CM",
          "videaste-1": "VIDEASTE",
        };
        return Promise.resolve({ role: roleById[where.id] ?? "ADMIN" });
      },
    );

    const slot = await createSlot(
      { patternTemplateId: "tpl-1", accountId: "account-A" },
      makeAdminCtx(),
    );

    expect(mockBindingFindFirst).toHaveBeenCalled();
    expect(slot.assigneeMonteurId).toBe("monteur-1");
    expect(slot.assigneeCmId).toBe("cm-1");
    expect(slot.assigneeVideasteId).toBe("videaste-1");
    // Slot binding normal : patternBindingId renseigné, patternTemplateId nullifié.
    expect(slot.patternBindingId).toBe("binding-1");
    expect(slot.patternTemplateId).toBeNull();
  });

  it("mission SANS compte → pas de binding résolu, aucun assigné par défaut", async () => {
    mockPatternTemplateFindUnique.mockResolvedValue({
      id: "tpl-1",
      label: "Recette Mission",
      source: "auto_template",
      isArchived: false,
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      fieldSchema: "[]",
    });

    const slot = await createSlot({ patternTemplateId: "tpl-1" }, makeAdminCtx());

    expect(mockBindingFindFirst).not.toHaveBeenCalled();
    expect(slot.assigneeMonteurId).toBeNull();
    expect(slot.patternBindingId).toBeNull();
    expect(slot.patternTemplateId).toBe("tpl-1");
  });

  it("mission avec propertyId → référence le bien (résolution live, pas de copie)", async () => {
    mockPatternTemplateFindUnique.mockResolvedValue({
      id: "tpl-1",
      label: "Recette Mission",
      source: "auto_template",
      isArchived: false,
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      fieldSchema: "[]",
    });

    const slot = await createSlot(
      { patternTemplateId: "tpl-1", propertyId: "prop-1" },
      makeAdminCtx(),
    );

    expect(slot.entityId).toBe("prop-1");
    // Pas de copie des valeurs du bien dans slot.fields (résolues live à la génération).
    expect(slot.fields).toEqual({});
  });
});

// ─── Invariant 3 : pattern cross-account ────────────────────────────────────

describe("createSlot — binding cross-account guard", () => {
  it("Binding d'un autre compte rejeté", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({}, { id: "binding-B", accountId: "account-B" }), // ← autre compte !
    );

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternBindingId: "binding-B",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("Binding inexistant → ValidationError", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(null);
    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternBindingId: "binding-ghost",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 4 : préfill assignees + override admin prime ────────────────

describe("createSlot — préfill assignees depuis la recette", () => {
  it("Binding avec defaultAssigneeMonteurId → préfile dans le slot", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow(
        { source: "manual_rushes" },
        { defaultAssigneeMonteurId: "user-monteur-default" },
      ),
    );
    mockUserFindUnique.mockResolvedValueOnce({ role: "MONTEUR" });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as {
      data: { assigneeMonteurId: string | null };
    };
    expect(callArgs.data.assigneeMonteurId).toBe("user-monteur-default");
  });

  it("Override admin prime sur le default de la recette", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow(
        { source: "manual_rushes" },
        { defaultAssigneeMonteurId: "user-monteur-default" },
      ),
    );
    mockUserFindUnique.mockResolvedValueOnce({ role: "MONTEUR" });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
        assigneeMonteurId: "user-monteur-override", // ← override
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as {
      data: { assigneeMonteurId: string | null };
    };
    expect(callArgs.data.assigneeMonteurId).toBe("user-monteur-override");
  });

  it("Assignee avec rôle incorrect rejeté", async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: "CM" }); // ← pas MONTEUR
    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          assigneeMonteurId: "user-wrong-role",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 5 : status initial dérivé de pattern.source ─────────────────

describe("createSlot — status initial selon pattern.source", () => {
  it("source=auto_template → PLANNED", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(makeBindingRow({ source: "auto_template" }));

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("PLANNED");
  });

  it("source=manual_rushes → RUSHES_EXPECTED", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(makeBindingRow({ source: "manual_rushes" }));

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("RUSHES_EXPECTED");
  });

  it("source=external_upload → READY_FOR_CM", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(makeBindingRow({ source: "external_upload" }));

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("READY_FOR_CM");
  });

  it("Sans pattern → DRAFT", async () => {
    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("DRAFT");
  });
});

// ─── Invariant 6 : cross-field validation ──────────────────────────────────

describe("createSlot — cross-field validation", () => {
  it("needsCaptionsOverride=true + recette sans captionPresetId → rejet", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({ captionPresetId: null }), // ← rien
    );

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternBindingId: "binding-A",
          needsCaptionsModeOverride: "auto",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("needsDescriptionOverride=autoGenerate + recette sans prompt → rejet", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({ descriptionPromptId: null }), // ← rien
    );

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternBindingId: "binding-A",
          needsDescriptionOverride: "autoGenerate",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("coverModeOverride=autoPack sans coverPresetId sur la recette → accepté (fallback runtime)", async () => {
    // Phase 2.6 : pattern.coverConfig n'a plus à porter coverPresetId — le
    // preset vit sur le template (1 preset par défaut auto-créé dans le
    // builder). Le runtime coverAuto.ts résout via template.coverPresets en
    // fallback. createSlot ne doit donc PAS bloquer ce cas (le guard a été
    // retiré post-regression user 2026-06-05).
    mockBindingFindUnique.mockResolvedValueOnce(makeBindingRow());

    const result = await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
        coverModeOverride: "autoPack",
      },
      makeAdminCtx(),
    );
    expect(result).toBeDefined();
  });

  it("Overrides cohérents → création OK", async () => {
    mockBindingFindUnique.mockResolvedValueOnce(
      makeBindingRow({
        captionPresetId: "preset-1",
        descriptionPromptId: "prompt-1",
        coverConfig: { coverPresetId: "cover-preset-1" },
      }),
    );

    const result = await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternBindingId: "binding-A",
        needsCaptionsModeOverride: "auto",
        needsDescriptionOverride: "autoGenerate",
        coverModeOverride: "auto",
      },
      makeAdminCtx(),
    );
    expect(result).toBeDefined();
  });
});

// ─── Invariant 7 : compte inexistant ────────────────────────────────────────

describe("createSlot — compte inexistant", () => {
  it("accountId pointant vers un compte qui n'existe pas → NotFoundError", async () => {
    mockAccountFindUnique.mockResolvedValueOnce(null);
    await expect(
      createSlot(
        { accountId: "account-ghost", scheduledAt: "2026-06-01T10:00:00Z" },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Invariant 8 : isAuto=false ────────────────────────────────────────────

describe("createSlot — requiresProperty", () => {
  const tplRequiresProperty = {
    id: "tpl-req-prop",
    label: "Recette avec bien",
    source: "auto_template",
    isArchived: false,
    captionPresetId: null,
    descriptionPromptId: null,
    needsCaptions: false,
    needsDescription: "none",
    coverMode: "none",
    coverConfig: null,
    fieldSchema: "[]",
    requiresProperty: true,
  };

  it("recette requiresProperty=true SANS propertyId → ValidationError", async () => {
    mockPatternTemplateFindUnique.mockResolvedValueOnce(tplRequiresProperty);
    await expect(
      createSlot({ patternTemplateId: "tpl-req-prop" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("recette requiresProperty=true AVEC propertyId → créé sans erreur", async () => {
    mockPatternTemplateFindUnique.mockResolvedValueOnce(tplRequiresProperty);
    const slot = await createSlot(
      { patternTemplateId: "tpl-req-prop", propertyId: "prop-1" },
      makeAdminCtx(),
    );
    expect(slot.entityId).toBe("prop-1");
  });

  it("binding (calendrier/AddSlotModal) requiresProperty=true SANS propertyId → ValidationError", async () => {
    // Le guard doit aussi couvrir la branche binding (slot classique du calendrier),
    // pas seulement la recette globale directe (mission).
    mockBindingFindUnique.mockResolvedValueOnce({
      id: "binding-req",
      accountId: "account-A",
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
      patternTemplate: {
        label: "Recette Compte avec bien",
        source: "auto_template",
        captionPresetId: null,
        descriptionPromptId: null,
        needsCaptions: false,
        needsDescription: "none",
        coverMode: "none",
        coverConfig: null,
        requiresProperty: true,
      },
    });
    await expect(
      createSlot(
        { patternBindingId: "binding-req", accountId: "account-A" },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("binding requiresProperty=true AVEC propertyId → créé (chemin AddSlotModal)", async () => {
    mockBindingFindUnique.mockResolvedValueOnce({
      id: "binding-req",
      accountId: "account-A",
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
      patternTemplate: {
        label: "Recette Compte avec bien",
        source: "auto_template",
        captionPresetId: null,
        descriptionPromptId: null,
        needsCaptions: false,
        needsDescription: "none",
        coverMode: "none",
        coverConfig: null,
        requiresProperty: true,
      },
    });
    const slot = await createSlot(
      { patternBindingId: "binding-req", accountId: "account-A", propertyId: "prop-1" },
      makeAdminCtx(),
    );
    expect(slot.entityId).toBe("prop-1");
  });

  it("propertyId d'un bien inexistant → NotFoundError", async () => {
    mockEntityFindUnique.mockResolvedValueOnce(null);
    await expect(
      createSlot({ accountId: "account-A", propertyId: "ghost" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propertyId d'un bien archivé → ValidationError", async () => {
    mockEntityFindUnique.mockResolvedValueOnce({ id: "prop-arch", isArchived: true });
    await expect(
      createSlot({ accountId: "account-A", propertyId: "prop-arch" }, makeAdminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 9 : description mode "fixed" (texte fixe recette) ────────────

describe("createSlot — description fixe (mode fixed)", () => {
  const tplFixed = {
    id: "tpl-fixed",
    label: "Recette texte fixe",
    source: "auto_template",
    isArchived: false,
    captionPresetId: null,
    descriptionPromptId: null,
    needsCaptions: false,
    needsDescription: "fixed",
    descriptionSourceFieldKey: null,
    descriptionFixedText: "Visitez ce bien d'exception ✨",
    coverMode: "none",
    coverConfig: null,
    fieldSchema: "[]",
    requiresProperty: false,
  };

  it("mode fixed sans bien → slot.description = descriptionFixedText", async () => {
    mockPatternTemplateFindUnique.mockResolvedValueOnce(tplFixed);
    const slot = await createSlot({ patternTemplateId: "tpl-fixed" }, makeAdminCtx());
    expect(slot.description).toBe("Visitez ce bien d'exception ✨");
  });

  it("mode fixed avec input.description explicite → l'input l'emporte", async () => {
    mockPatternTemplateFindUnique.mockResolvedValueOnce(tplFixed);
    const slot = await createSlot(
      { patternTemplateId: "tpl-fixed", description: "Légende sur-mesure" },
      makeAdminCtx(),
    );
    expect(slot.description).toBe("Légende sur-mesure");
  });

  it("mode fixed sans texte configuré → slot.description null", async () => {
    mockPatternTemplateFindUnique.mockResolvedValueOnce({
      ...tplFixed,
      descriptionFixedText: null,
    });
    const slot = await createSlot({ patternTemplateId: "tpl-fixed" }, makeAdminCtx());
    expect(slot.description).toBeNull();
  });
});

describe("createSlot — isAuto=false (slot manuel)", () => {
  it("Création manuelle pose isAuto=false (distinction avec generateCalendarSlots)", async () => {
    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { isAuto: boolean } };
    expect(callArgs.data.isAuto).toBe(false);
  });
});

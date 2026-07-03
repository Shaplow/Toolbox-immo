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
const mockPatternFindUnique = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
// P2 — compat shim createSlot : on cherche un PatternBinding depuis le
// legacy patternId pour matérialiser slot.patternBindingId. En test on
// renvoie null par défaut (le test focus l'AccountPattern legacy path).
const mockBindingFindUnique = vi.fn().mockResolvedValue(null);
const mockBindingFindFirst = vi.fn().mockResolvedValue(null);
// Missions — résolution recette GLOBALE directe (patternTemplateId).
const mockPatternTemplateFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      create: (...args: unknown[]) => mockSlotCreate(...args),
    },
    accountPattern: {
      findUnique: (...args: unknown[]) => mockPatternFindUnique(...args),
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

beforeEach(() => {
  mockSlotCreate.mockReset();
  mockPatternFindUnique.mockReset();
  mockAccountFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockBindingFindUnique.mockReset().mockResolvedValue(null);
  mockBindingFindFirst.mockReset().mockResolvedValue(null);
  mockPatternTemplateFindUnique.mockReset().mockResolvedValue(null);

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
    // Champs personnalisés hérités de la recette.
    expect(slot.fieldSchema).toEqual(["adresse", "prix"]);
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

    expect(slot.propertyId).toBe("prop-1");
    // Pas de copie des valeurs du bien dans slot.fields (résolues live à la génération).
    expect(slot.fields).toEqual({});
  });
});

// ─── Invariant 3 : pattern cross-account ────────────────────────────────────

describe("createSlot — patternId cross-account guard", () => {
  it("Pattern d'un autre compte rejeté", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-B",
      accountId: "account-B", // ← autre compte !
      source: "auto_template",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternId: "pattern-B",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("Pattern inexistant → ValidationError", async () => {
    mockPatternFindUnique.mockResolvedValueOnce(null);
    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternId: "pattern-ghost",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── Invariant 4 : préfill assignees + override admin prime ────────────────

describe("createSlot — préfill assignees depuis pattern", () => {
  it("Pattern avec defaultAssigneeMonteurId → préfile dans le slot", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "manual_rushes",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: "user-monteur-default",
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    mockUserFindUnique.mockResolvedValueOnce({ role: "MONTEUR" });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as {
      data: { assigneeMonteurId: string | null };
    };
    expect(callArgs.data.assigneeMonteurId).toBe("user-monteur-default");
  });

  it("Override admin prime sur le default du pattern", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "manual_rushes",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: "user-monteur-default",
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });
    mockUserFindUnique.mockResolvedValueOnce({ role: "MONTEUR" });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
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
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "auto_template",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("PLANNED");
  });

  it("source=manual_rushes → RUSHES_EXPECTED", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "manual_rushes",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
      },
      makeAdminCtx(),
    );

    const callArgs = mockSlotCreate.mock.calls[0][0] as { data: { status: string } };
    expect(callArgs.data.status).toBe("RUSHES_EXPECTED");
  });

  it("source=external_upload → READY_FOR_CM", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "external_upload",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
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
  it("needsCaptionsOverride=true + pattern sans captionPresetId → rejet", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "auto_template",
      captionPresetId: null, // ← rien
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternId: "pattern-A",
          needsCaptionsOverride: true,
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("needsDescriptionOverride=autoGenerate + pattern sans prompt → rejet", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "auto_template",
      captionPresetId: null,
      descriptionPromptId: null, // ← rien
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    await expect(
      createSlot(
        {
          accountId: "account-A",
          scheduledAt: "2026-06-01T10:00:00Z",
          patternId: "pattern-A",
          needsDescriptionOverride: "autoGenerate",
        },
        makeAdminCtx(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("coverModeOverride=autoPack sans coverPresetId sur le pattern → accepté (fallback runtime)", async () => {
    // Phase 2.6 : pattern.coverConfig n'a plus à porter coverPresetId — le
    // preset vit sur le template (1 preset par défaut auto-créé dans le
    // builder). Le runtime coverAuto.ts résout via template.coverPresets en
    // fallback. createSlot ne doit donc PAS bloquer ce cas (le guard a été
    // retiré post-regression user 2026-06-05).
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "auto_template",
      captionPresetId: null,
      descriptionPromptId: null,
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: null,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    const result = await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
        coverModeOverride: "autoPack",
      },
      makeAdminCtx(),
    );
    expect(result).toBeDefined();
  });

  it("Overrides cohérents → création OK", async () => {
    mockPatternFindUnique.mockResolvedValueOnce({
      id: "pattern-A",
      accountId: "account-A",
      source: "auto_template",
      captionPresetId: "preset-1",
      descriptionPromptId: "prompt-1",
      needsCaptions: false,
      needsDescription: "none",
      coverMode: "none",
      coverConfig: { coverPresetId: "cover-preset-1" },
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
    });

    const result = await createSlot(
      {
        accountId: "account-A",
        scheduledAt: "2026-06-01T10:00:00Z",
        patternId: "pattern-A",
        needsCaptionsOverride: true,
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

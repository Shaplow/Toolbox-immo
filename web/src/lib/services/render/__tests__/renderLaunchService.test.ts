/**
 * Tests de renderLaunchService — lancement de rendu (plan « Lancer les rendus
 * depuis le calendrier », étapes 1 et 2).
 *
 * Prisma et les modules lourds (générateur, resolver de bibliothèque,
 * transitions, revert de curseurs, permissions, SSE) sont mockés au niveau
 * module — vitest unit pur, pas de DB. Le contexte utilisateur est ADMIN
 * (`canAdminBypass: true`) dans la plupart des tests, pour éviter de devoir
 * mocker le retour de `hasTool`/`canAccessTemplate` (court-circuités dans ce
 * cas, mêmes gardes que la route historique) — sauf dans le describe
 * « préflight avant verrou », qui a justement besoin d'un appelant non-admin
 * dont `hasTool` échoue.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserContext } from "@/lib/userContext";
import type { RenderRequestBody } from "@/lib/generate/buildRenderRequestBody";

// ── Mocks Prisma ─────────────────────────────────────────────────────────────
const mockRenderFindMany = vi.fn();
const mockRenderFindUnique = vi.fn();
const mockRenderUpdate = vi.fn();
const mockRenderUpdateMany = vi.fn();
const mockRenderCreate = vi.fn();
const mockRenderDelete = vi.fn();
const mockTemplateFindFirst = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockTemplateAccessFindUnique = vi.fn();
const mockListingFindFirst = vi.fn();
const mockListingCreate = vi.fn();
const mockMediaAssetFindMany = vi.fn();
const mockMediaAssetFindUnique = vi.fn();
const mockDataEntryFindUnique = vi.fn();
const mockMediaLibraryFindMany = vi.fn();
const mockMediaLibraryCount = vi.fn();
const mockInstagramAccountFindUnique = vi.fn();
const mockPublicationSlotFindUnique = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: {
      findMany: (...args: unknown[]) => mockRenderFindMany(...args),
      findUnique: (...args: unknown[]) => mockRenderFindUnique(...args),
      update: (...args: unknown[]) => mockRenderUpdate(...args),
      updateMany: (...args: unknown[]) => mockRenderUpdateMany(...args),
      create: (...args: unknown[]) => mockRenderCreate(...args),
      delete: (...args: unknown[]) => mockRenderDelete(...args),
    },
    template: {
      findFirst: (...args: unknown[]) => mockTemplateFindFirst(...args),
      findUnique: (...args: unknown[]) => mockTemplateFindUnique(...args),
    },
    templateAccess: {
      findUnique: (...args: unknown[]) => mockTemplateAccessFindUnique(...args),
    },
    listing: {
      findFirst: (...args: unknown[]) => mockListingFindFirst(...args),
      create: (...args: unknown[]) => mockListingCreate(...args),
    },
    mediaAsset: {
      findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args),
      findUnique: (...args: unknown[]) => mockMediaAssetFindUnique(...args),
    },
    dataEntry: {
      findUnique: (...args: unknown[]) => mockDataEntryFindUnique(...args),
    },
    mediaLibrary: {
      findMany: (...args: unknown[]) => mockMediaLibraryFindMany(...args),
      count: (...args: unknown[]) => mockMediaLibraryCount(...args),
    },
    instagramAccount: {
      findUnique: (...args: unknown[]) => mockInstagramAccountFindUnique(...args),
    },
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockPublicationSlotFindUnique(...args),
    },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

// ── Mocks des modules lourds (générateur, resolver, transitions, revert) ────
const mockStartRenderGeneration = vi.fn();
vi.mock("@/lib/renderer/generateRender", () => ({
  startRenderGeneration: (...args: unknown[]) => mockStartRenderGeneration(...args),
}));

const mockRevertLibraryCursors = vi.fn();
vi.mock("@/lib/recordLibraryUsage", () => ({
  revertLibraryCursors: (...args: unknown[]) => mockRevertLibraryCursors(...args),
}));

const mockAdvanceMediaUsageOnSubmit = vi.fn();
const mockAdvanceAudioUsageOnSubmit = vi.fn();
const mockAdvanceDataUsageOnSubmit = vi.fn();
vi.mock("@/lib/contentLibraryResolver", () => ({
  advanceMediaUsageOnSubmit: (...args: unknown[]) => mockAdvanceMediaUsageOnSubmit(...args),
  advanceAudioUsageOnSubmit: (...args: unknown[]) => mockAdvanceAudioUsageOnSubmit(...args),
  advanceDataUsageOnSubmit: (...args: unknown[]) => mockAdvanceDataUsageOnSubmit(...args),
}));

const mockApplyAutoTransitionFromPipeline = vi.fn();
vi.mock("@/lib/services/slot/transitions", () => ({
  applyAutoTransitionFromPipeline: (...args: unknown[]) => mockApplyAutoTransitionFromPipeline(...args),
}));

const mockNotifyUser = vi.fn();
vi.mock("@/lib/sseStore", () => ({
  notifyUser: (...args: unknown[]) => mockNotifyUser(...args),
}));

// `hasTool`/`canAccessTemplate` mockés (plutôt que la vraie implémentation,
// qui interroge `prisma.user` — non mocké ici) : nécessaire pour le describe
// « préflight avant verrou », qui a besoin d'un appelant non-admin dont
// `hasTool` échoue. Repli par défaut `true`, écrasé par ce describe.
const mockHasTool = vi.fn();
const mockCanAccessTemplate = vi.fn();
vi.mock("@/lib/permissions", () => ({
  hasTool: (...args: unknown[]) => mockHasTool(...args),
  canAccessTemplate: (...args: unknown[]) => mockCanAccessTemplate(...args),
  TOOLS: { TEMPLATES: "TEMPLATES" },
}));

// Import APRÈS les mocks
import {
  findMissingRequiredFields,
  createListingForRender,
  findInFlightRender,
  createAndStartRender,
} from "@/lib/services/render/renderLaunchService";
import { NotFoundError, ForbiddenError, MissingFieldsError, RenderInFlightError, ValidationError } from "@/lib/services/_runtime/errors";
import type { TemplateJSON, SchemaField } from "@/types/template";

function adminCtx(): UserContext {
  return {
    session: {} as unknown,
    actualUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" },
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as unknown as UserContext;
}

/** Utilisateur authentifié, non-admin — passe par `hasTool`/`canAccessTemplate` (mockés). */
function nonAdminCtx(userId = "user-1"): UserContext {
  return {
    session: {} as unknown,
    actualUser: { id: userId, role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    effectiveUser: { id: userId, role: "VIDEASTE", name: null, email: null, permissions: "[]" },
    isAdmin: false,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: false,
  } as unknown as UserContext;
}

function field(key: string, overrides: Partial<SchemaField> = {}): SchemaField {
  return { key, type: "text", label: key, required: false, ...overrides } as SchemaField;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Repli par défaut sûr pour tous les mocks Prisma, écrasé par test au besoin.
  mockRenderFindMany.mockResolvedValue([]);
  mockRenderFindUnique.mockResolvedValue(null);
  mockRenderUpdate.mockResolvedValue({});
  mockRenderUpdateMany.mockResolvedValue({ count: 1 });
  mockRenderDelete.mockResolvedValue({});
  mockTemplateAccessFindUnique.mockResolvedValue({});
  mockHasTool.mockResolvedValue(true);
  mockCanAccessTemplate.mockResolvedValue(true);
  mockNotifyUser.mockReturnValue(undefined);
  mockMediaAssetFindMany.mockResolvedValue([]);
  mockMediaAssetFindUnique.mockResolvedValue(null);
  mockDataEntryFindUnique.mockResolvedValue(null);
  mockMediaLibraryFindMany.mockResolvedValue([]);
  mockMediaLibraryCount.mockResolvedValue(0);
  mockInstagramAccountFindUnique.mockResolvedValue(null);
  mockPublicationSlotFindUnique.mockResolvedValue(null);
  mockExecuteRaw.mockResolvedValue(0);
  mockAdvanceMediaUsageOnSubmit.mockResolvedValue({ prevMediaUsageStates: [] });
  mockRevertLibraryCursors.mockResolvedValue(undefined);
  mockAdvanceAudioUsageOnSubmit.mockResolvedValue(null);
  mockAdvanceDataUsageOnSubmit.mockResolvedValue(null);
  mockApplyAutoTransitionFromPipeline.mockResolvedValue(null);
  mockStartRenderGeneration.mockResolvedValue("accepted");
  // jsonData illisible : fait sauter le bloc A.9 (appartenance/minDuration)
  // dans createAndStartRenderLocked sans avoir à modéliser un vrai template —
  // ce bloc n'est pas ce que ces tests couvrent.
  mockTemplateFindUnique.mockResolvedValue({ jsonData: "not-json" });
});

// ─── findMissingRequiredFields ───────────────────────────────────────────────

describe("findMissingRequiredFields", () => {
  const json: TemplateJSON = {
    schema: [field("title", { required: true }), field("subtitle")],
    formSections: [],
  } as unknown as TemplateJSON;

  it("relève un champ requis vide sur le schema brut", () => {
    const missing = findMissingRequiredFields({ json, values: {} });
    expect(missing).toEqual(["title"]);
  });

  it("ne relève rien quand le champ requis est rempli", () => {
    const missing = findMissingRequiredFields({ json, values: { title: "Villa" } });
    expect(missing).toEqual([]);
  });

  it("ignore un champ requis masqué par showIf", () => {
    const jsonWithCondition: TemplateJSON = {
      schema: [
        field("title", { required: true }),
        field("hiddenRequired", { required: true, showIf: { field: "title", operator: "equals", value: "never" } as never }),
      ],
      formSections: [],
    } as unknown as TemplateJSON;
    const missing = findMissingRequiredFields({ json: jsonWithCondition, values: { title: "Villa" } });
    expect(missing).toEqual([]);
  });

  it("fait l'union avec finalSchema sans dupliquer une clé déjà relevée", () => {
    const finalSchema: SchemaField[] = [field("title", { required: true }), field("extra", { required: true })];
    const missing = findMissingRequiredFields({ json, values: {}, finalSchema });
    expect(missing).toEqual(["title", "extra"]);
  });

  it("ne mute ni values ni finalSchema", () => {
    const values = Object.freeze({});
    const finalSchema = Object.freeze([field("extra", { required: true })]) as SchemaField[];
    expect(() => findMissingRequiredFields({ json, values, finalSchema })).not.toThrow();
  });
});

// ─── createListingForRender ──────────────────────────────────────────────────

describe("createListingForRender", () => {
  it("lève NotFoundError si le template n'existe pas", async () => {
    mockTemplateFindFirst.mockResolvedValue(null);
    await expect(
      createListingForRender({ templateId: "tpl-1", data: {} }, adminCtx()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockListingCreate).not.toHaveBeenCalled();
  });

  it("lève MissingFieldsError avec le détail missing quand un champ requis est vide", async () => {
    mockTemplateFindFirst.mockResolvedValue({
      id: "tpl-1",
      jsonData: JSON.stringify({ schema: [field("title", { required: true })], formSections: [] }),
    });
    const err = await createListingForRender({ templateId: "tpl-1", data: {} }, adminCtx()).catch((e) => e);
    expect(err).toBeInstanceOf(MissingFieldsError);
    expect((err as MissingFieldsError).details).toEqual({ missing: ["title"] });
    expect(mockListingCreate).not.toHaveBeenCalled();
  });

  it("crée le listing quand tous les champs requis sont remplis", async () => {
    mockTemplateFindFirst.mockResolvedValue({
      id: "tpl-1",
      jsonData: JSON.stringify({ schema: [field("title", { required: true })], formSections: [] }),
    });
    mockListingCreate.mockResolvedValue({ id: "listing-1" });
    const result = await createListingForRender({ templateId: "tpl-1", data: { title: "Villa" } }, adminCtx());
    expect(result.id).toBe("listing-1");
    expect(mockListingCreate).toHaveBeenCalledTimes(1);
  });
});

// ─── findInFlightRender ──────────────────────────────────────────────────────

describe("findInFlightRender", () => {
  it("renvoie null sans aucune mise à jour quand rien n'est en vol", async () => {
    mockRenderFindMany.mockResolvedValue([]);
    const result = await findInFlightRender("slot-1");
    expect(result).toBeNull();
    expect(mockRenderUpdateMany).not.toHaveBeenCalled();
    expect(mockRevertLibraryCursors).not.toHaveBeenCalled();
  });

  it("renvoie le rendu PROCESSING avec runpodJobId — pas un orphelin", async () => {
    mockRenderFindMany.mockResolvedValue([
      { id: "render-1", status: "PROCESSING", stage: "SEQ_RENDER_OVERLAYS", runpodJobId: "job-1", lastHeartbeatAt: new Date(), createdAt: new Date() },
    ]);
    const result = await findInFlightRender("slot-1");
    expect(result).toEqual({ id: "render-1", status: "PROCESSING" });
    expect(mockRenderUpdateMany).not.toHaveBeenCalled();
  });

  it("récupère (CAS updateMany + revert + notify) un PROCESSING sans runpodJobId dont le heartbeat est antérieur au boot du process", async () => {
    mockRenderFindMany.mockResolvedValue([
      {
        id: "orphan-1",
        status: "PROCESSING",
        stage: "SEQ_RENDER_OVERLAYS",
        runpodJobId: null,
        lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);
    mockRenderUpdateMany.mockResolvedValue({ count: 1 });
    mockRenderFindUnique.mockResolvedValue({ listing: { userId: "owner-1" } });

    const result = await findInFlightRender("slot-1");

    expect(result).toBeNull();
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockRenderUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: { status: string } };
    // CAS : ne retermine que ce qui est encore PENDING/PROCESSING sans runpodJobId.
    expect(call.where).toEqual({ id: "orphan-1", status: { in: ["PENDING", "PROCESSING"] }, runpodJobId: null });
    expect(call.data.status).toBe("ERROR");
    expect(mockRevertLibraryCursors).toHaveBeenCalledWith("orphan-1");
    expect(mockNotifyUser).toHaveBeenCalledWith("owner-1", expect.objectContaining({ jobType: "render", jobId: "orphan-1", status: "ERROR" }));
  });

  it("récupère un PENDING créé il y a plus de 2 minutes", async () => {
    mockRenderFindMany.mockResolvedValue([
      {
        id: "orphan-2",
        status: "PENDING",
        stage: "VALIDATE_LISTING",
        runpodJobId: null,
        lastHeartbeatAt: null,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);
    const result = await findInFlightRender("slot-1");
    expect(result).toBeNull();
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockRevertLibraryCursors).toHaveBeenCalledWith("orphan-2");
  });

  it("récupère l'orphelin ET renvoie le survivant restant", async () => {
    mockRenderFindMany.mockResolvedValue([
      { id: "survivor", status: "PROCESSING", stage: "SEQ_RENDER_OVERLAYS", runpodJobId: "job-1", lastHeartbeatAt: new Date(), createdAt: new Date() },
      {
        id: "orphan-3",
        status: "PENDING",
        stage: "VALIDATE_LISTING",
        runpodJobId: null,
        lastHeartbeatAt: null,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);
    const result = await findInFlightRender("slot-1");
    expect(result).toEqual({ id: "survivor", status: "PROCESSING" });
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockRenderUpdateMany.mock.calls[0][0] as { where: { id: string } };
    expect(call.where.id).toBe("orphan-3");
  });

  // ── finding orphan-recovery-vs-webhook-fallback ─────────────────────────
  it("un PROCESSING sans runpodJobId au stage SEQ_SUBMIT_RUNPOD n'est PAS orphelin avant la marge de grâce (RunPod a pu déjà accepter le job)", async () => {
    mockRenderFindMany.mockResolvedValue([
      {
        id: "maybe-running",
        status: "PROCESSING",
        stage: "SEQ_SUBMIT_RUNPOD",
        runpodJobId: null,
        // 10 min avant le boot du process : orphelin sous l'ancienne règle
        // (heartbeat < boot), mais toujours dans la marge de grâce du submit.
        lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);
    const result = await findInFlightRender("slot-1");
    expect(result).toEqual({ id: "maybe-running", status: "PROCESSING" });
    expect(mockRenderUpdateMany).not.toHaveBeenCalled();
    expect(mockRevertLibraryCursors).not.toHaveBeenCalled();
  });

  it("un PROCESSING sans runpodJobId au stage SEQ_SUBMIT_RUNPOD DEVIENT orphelin après la marge de grâce de 30 min", async () => {
    mockRenderFindMany.mockResolvedValue([
      {
        id: "truly-stuck",
        status: "PROCESSING",
        stage: "SEQ_SUBMIT_RUNPOD",
        runpodJobId: null,
        lastHeartbeatAt: new Date(Date.now() - 31 * 60 * 1000),
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    ]);
    mockRenderUpdateMany.mockResolvedValue({ count: 1 });
    const result = await findInFlightRender("slot-1");
    expect(result).toBeNull();
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockRevertLibraryCursors).toHaveBeenCalledWith("truly-stuck");
  });

  it("CAS miss (le webhook a déjà recouvré le rendu entre la lecture et l'écriture ERROR) : pas de revert, pas de notification", async () => {
    mockRenderFindMany.mockResolvedValue([
      {
        id: "recovered-by-webhook",
        status: "PROCESSING",
        stage: "SEQ_RENDER_OVERLAYS",
        runpodJobId: null,
        lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);
    // Le webhook a écrit DONE (ou posé runpodJobId) entre le findMany et
    // l'updateMany CAS : count=0, le CAS ne touche aucune ligne.
    mockRenderUpdateMany.mockResolvedValue({ count: 0 });

    const result = await findInFlightRender("slot-1");

    expect(result).toBeNull();
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockRevertLibraryCursors).not.toHaveBeenCalled();
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });
});

// ─── createAndStartRender ─────────────────────────────────────────────────────

function baseInput(overrides: Partial<RenderRequestBody> = {}): RenderRequestBody {
  return { templateId: "tpl-1", listingId: "listing-1", ...overrides };
}

describe("createAndStartRender — in-flight", () => {
  it("lève RenderInFlightError et ne pose aucun claim quand un rendu est déjà en vol", async () => {
    mockPublicationSlotFindUnique.mockResolvedValue({ id: "slot-1" });
    mockRenderFindMany.mockResolvedValue([
      { id: "render-inflight", status: "PROCESSING", runpodJobId: "job-1", lastHeartbeatAt: new Date(), createdAt: new Date() },
    ]);
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });

    const err = await createAndStartRender(baseInput({ publicationSlotId: "slot-1" }), adminCtx()).catch((e) => e);

    expect(err).toBeInstanceOf(RenderInFlightError);
    expect((err as RenderInFlightError).details).toEqual({ renderId: "render-inflight", status: "PROCESSING" });
    expect(mockRenderCreate).not.toHaveBeenCalled();
    expect(mockAdvanceMediaUsageOnSubmit).not.toHaveBeenCalled();
    expect(mockAdvanceAudioUsageOnSubmit).not.toHaveBeenCalled();
    expect(mockAdvanceDataUsageOnSubmit).not.toHaveBeenCalled();
  });
});

describe("createAndStartRender — revert des claims sur exception", () => {
  it("reverte les claims média quand le claim audio lève", async () => {
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    // Servi aussi bien au sanitize (select id) qu'à la dérivation setSequencedLibraryIds
    // (select id/libraryId/setTag/library.rotationMode) — rotationMode "none" pour
    // ne pas déclencher la garde per_account, hors sujet ici.
    mockMediaAssetFindMany.mockResolvedValue([{ id: "video-asset-1", libraryId: "lib-1", setTag: null, library: { rotationMode: "none" } }]);
    mockInstagramAccountFindUnique.mockResolvedValue({ id: "acc-1" });
    mockAdvanceMediaUsageOnSubmit.mockResolvedValue({
      prevMediaUsageStates: [{ assetId: "video-asset-1", accountId: "acc-1", prevLastUsedAt: "2024-01-01T00:00:00.000Z", claimedLastUsedAt: "2024-06-01T00:00:00.000Z" }],
    });
    // Sanitize de audioAssetId (existence) : trouvé.
    mockMediaAssetFindUnique.mockImplementation((args: { select?: Record<string, boolean> }) => {
      if (args?.select?.libraryId) return Promise.resolve({ libraryId: "lib-audio" });
      return Promise.resolve({ id: "audio-asset-1" });
    });
    mockAdvanceAudioUsageOnSubmit.mockRejectedValue(new Error("audio claim failed"));

    const input = baseInput({
      accountId: "acc-1",
      usedAssets: { videoAssets: { block1: "video-asset-1" }, audioAssetId: "audio-asset-1" },
    });

    await expect(createAndStartRender(input, adminCtx())).rejects.toThrow("audio claim failed");

    expect(mockRenderCreate).not.toHaveBeenCalled();
    // Revert : lastLastUsedAt non-null → UPDATE (pas DELETE) sur MediaAssetUsage.
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it("reverte les claims média quand le claim data lève", async () => {
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockMediaAssetFindMany.mockResolvedValue([{ id: "video-asset-1", libraryId: "lib-1", setTag: null, library: { rotationMode: "none" } }]);
    mockDataEntryFindUnique.mockResolvedValue({ id: "entry-1" });
    mockAdvanceMediaUsageOnSubmit.mockResolvedValue({
      prevMediaUsageStates: [{ assetId: "video-asset-1", accountId: "__shared__", prevLastUsedAt: null, claimedLastUsedAt: "2024-06-01T00:00:00.000Z" }],
    });
    mockAdvanceDataUsageOnSubmit.mockRejectedValue(new Error("data claim failed"));

    const input = baseInput({
      usedAssets: { videoAssets: { block1: "video-asset-1" }, dataEntryId: "entry-1" },
    });

    await expect(createAndStartRender(input, adminCtx())).rejects.toThrow("data claim failed");

    expect(mockRenderCreate).not.toHaveBeenCalled();
    // prevLastUsedAt null → DELETE (le claim avait créé la ligne) sur MediaAssetUsage.
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });
});

describe("createAndStartRender — kickoff qui lève", () => {
  it("passe le render en ERROR, reverte les claims, puis rethrow", async () => {
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-1", status: "PENDING" });
    mockStartRenderGeneration.mockRejectedValue(new Error("db unreachable"));

    const input = baseInput();
    await expect(createAndStartRender(input, adminCtx())).rejects.toThrow("db unreachable");

    expect(mockRenderUpdate).toHaveBeenCalledTimes(1);
    const call = mockRenderUpdate.mock.calls[0][0] as { where: { id: string }; data: { status: string; errorMsg: string } };
    expect(call.where.id).toBe("render-1");
    expect(call.data.status).toBe("ERROR");
    expect(call.data.errorMsg).toBe("db unreachable");
  });

  it("kickoff 'missing' supprime le render orphelin et reverte, sans le passer en ERROR", async () => {
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-2", status: "PENDING" });
    mockStartRenderGeneration.mockResolvedValue("missing");

    const input = baseInput();
    await expect(createAndStartRender(input, adminCtx())).rejects.toThrow("Render introuvable après création");

    expect(mockRenderDelete).toHaveBeenCalledWith({ where: { id: "render-2" } });
    expect(mockRenderUpdate).not.toHaveBeenCalled();
  });
});

describe("createAndStartRender — verrou par slot", () => {
  it("deux lancements concurrents sur le même slot ne produisent qu'un seul render.create", async () => {
    mockPublicationSlotFindUnique.mockResolvedValue({ id: "slot-1" });
    mockRenderFindMany.mockResolvedValue([]); // aucun in-flight en DB pour les deux appels
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-1", status: "PENDING" });

    const ctx = adminCtx();
    const inputA = baseInput({ publicationSlotId: "slot-1" });
    const inputB = baseInput({ publicationSlotId: "slot-1" });

    // Appels non attendus l'un après l'autre : la préflight de A se résout
    // avant celle de B (même ordre, mêmes mocks), et `withSlotRenderLock` est
    // appelé de façon synchrone dès que la préflight se résout — B voit donc
    // le verrou déjà tenu par A au moment où il l'atteint lui-même.
    const pA = createAndStartRender(inputA, ctx);
    const pB = createAndStartRender(inputB, ctx);
    const [rA, rB] = await Promise.allSettled([pA, pB]);

    const settled = [rA, rB];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RenderInFlightError);
    expect(mockRenderCreate).toHaveBeenCalledTimes(1);
  });
});

describe("createAndStartRender — récupération d'orphelin puis lancement", () => {
  it("marque l'orphelin en ERROR, reverte, et le lancement passe quand même", async () => {
    mockPublicationSlotFindUnique.mockResolvedValue({ id: "slot-1" });
    mockRenderFindMany.mockResolvedValue([
      {
        id: "orphan-1",
        status: "PENDING",
        runpodJobId: null,
        lastHeartbeatAt: null,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    ]);
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-new", status: "PENDING" });

    const input = baseInput({ publicationSlotId: "slot-1" });
    const result = await createAndStartRender(input, adminCtx());

    expect(result.id).toBe("render-new");
    // L'orphelin a bien été récupéré (CAS updateMany, cf. describe
    // findInFlightRender) avant que le lancement ne procède.
    expect(mockRenderUpdateMany).toHaveBeenCalledTimes(1);
    expect((mockRenderUpdateMany.mock.calls[0][0] as { where: { id: string } }).where.id).toBe("orphan-1");
    expect(mockRevertLibraryCursors).toHaveBeenCalledWith("orphan-1");
    expect(mockRenderCreate).toHaveBeenCalledTimes(1);
    expect(mockStartRenderGeneration).toHaveBeenCalledWith("render-new");
  });
});

describe("createAndStartRender — préflight avant verrou (findings slot-lock-before-authz / render-lock-before-authz)", () => {
  it("un appelant sans outil TEMPLATES ne prend jamais le verrou : un lancement admin concurrent sur le même slot réussit", async () => {
    // Avant ce fix, `createAndStartRender` prenait `withSlotRenderLock` avant
    // le check `hasTool` — l'appel non autorisé, en gagnant la course pour
    // entrer en premier, aurait gelé le verrou du slot et fait échouer
    // l'appel admin concurrent en `RenderInFlightError` (409). Ici, le check
    // hasTool tourne en préflight, hors verrou : il rejette avant même
    // d'atteindre `withSlotRenderLock`.
    mockHasTool.mockResolvedValue(false);
    mockPublicationSlotFindUnique.mockResolvedValue({ id: "slot-1" });
    mockRenderFindMany.mockResolvedValue([]);
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-1", status: "PENDING" });

    const unauthorized = createAndStartRender(
      baseInput({ publicationSlotId: "slot-1" }),
      nonAdminCtx("unauthorized-user"),
    );
    const authorized = createAndStartRender(baseInput({ publicationSlotId: "slot-1" }), adminCtx());

    const [rUnauthorized, rAuthorized] = await Promise.allSettled([unauthorized, authorized]);

    expect(rUnauthorized.status).toBe("rejected");
    expect((rUnauthorized as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenError);
    expect(rAuthorized.status).toBe("fulfilled");
    expect((rAuthorized as PromiseFulfilledResult<{ id: string }>).value.id).toBe("render-1");
    expect(mockRenderCreate).toHaveBeenCalledTimes(1);
  });

  it("lève ForbiddenError si l'accès au template est refusé, sans jamais créer de listing ni de render", async () => {
    mockHasTool.mockResolvedValue(true);
    mockTemplateAccessFindUnique.mockResolvedValue(null);

    const err = await createAndStartRender(baseInput(), nonAdminCtx()).catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(mockListingFindFirst).not.toHaveBeenCalled();
    expect(mockRenderCreate).not.toHaveBeenCalled();
  });

  it("mode lot (opts.lockHeld) : la préflight tourne quand même, sans reprendre de second verrou", async () => {
    mockPublicationSlotFindUnique.mockResolvedValue({ id: "slot-1" });
    mockRenderFindMany.mockResolvedValue([]);
    mockListingFindFirst.mockResolvedValue({ id: "listing-1" });
    mockRenderCreate.mockResolvedValue({ id: "render-1", status: "PENDING" });

    const result = await createAndStartRender(
      baseInput({ publicationSlotId: "slot-1" }),
      adminCtx(),
      { lockHeld: true },
    );

    expect(result.id).toBe("render-1");
    expect(mockRenderCreate).toHaveBeenCalledTimes(1);
  });
});

describe("createAndStartRender — garde de base", () => {
  it("lève ValidationError si templateId ou listingId manque", async () => {
    await expect(
      createAndStartRender({ templateId: "", listingId: "listing-1" }, adminCtx()),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockRenderCreate).not.toHaveBeenCalled();
  });

  it("lève NotFoundError si le listing n'existe pas", async () => {
    mockListingFindFirst.mockResolvedValue(null);
    await expect(createAndStartRender(baseInput(), adminCtx())).rejects.toBeInstanceOf(NotFoundError);
    expect(mockRenderCreate).not.toHaveBeenCalled();
  });
});

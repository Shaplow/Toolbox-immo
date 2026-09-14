/**
 * Tests autoActivateForAccount — activation automatique des recettes.
 *
 * Le besoin : « à chaque nouveau compte je dois penser à activer certains types
 * de vidéos, je vais sans doute oublier ». Une recette déclare les clients dont
 * les comptes la reçoivent d'office.
 *
 * Ce qui compte ici :
 *  1. Un compte SANS client n'attend rien — et ne coûte aucune requête.
 *  2. Un binding qui existe déjà n'est jamais recréé, même désactivé à la main
 *     (le désactiver est une décision, pas un oubli).
 *  3. Résultats PARTIELS : une recette archivée ne fait pas échouer les autres.
 *  4. Le déploiement existant est RÉUTILISÉ, pas réécrit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccountFindUnique = vi.fn();
const mockAutoActivationFindMany = vi.fn();
const mockBindingFindMany = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockDeploy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findUnique: (...a: unknown[]) => mockAccountFindUnique(...a) },
    patternTemplateAutoActivation: {
      findMany: (...a: unknown[]) => mockAutoActivationFindMany(...a),
    },
    patternBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    patternTemplate: { findUnique: (...a: unknown[]) => mockTemplateFindUnique(...a) },
  },
}));

vi.mock("@/lib/services/pattern/deployTemplate", () => ({
  DEPLOY_MAX_ACCOUNTS: 50,
  deployTemplateToAccounts: (...a: unknown[]) => mockDeploy(...a),
}));

import {
  applyAutoActivations,
  listMissingAutoActivations,
} from "@/lib/services/pattern/autoActivateForAccount";

function ctx() {
  const user = { id: "admin-1", role: "ADMIN", name: null, email: null, permissions: "[]" };
  return {
    session: {} as unknown,
    actualUser: user,
    effectiveUser: user,
    isAdmin: true,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: true,
  } as Parameters<typeof applyAutoActivations>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccountFindUnique.mockResolvedValue({ clientId: "client-1" });
  mockAutoActivationFindMany.mockResolvedValue([
    { patternTemplateId: "pt1", patternTemplate: { label: "RVA1" } },
    { patternTemplateId: "pt2", patternTemplate: { label: "RVA2" } },
    { patternTemplateId: "pt3", patternTemplate: { label: "RPOD" } },
  ]);
  mockBindingFindMany.mockResolvedValue([]);
  mockTemplateFindUnique.mockResolvedValue({
    autoActivateDayOfWeek: [1, 4],
    autoActivatePublishTime: "18:00",
  });
  mockDeploy.mockResolvedValue({ createdCount: 1, skippedCount: 0, bindingIds: ["b1"] });
});

describe("listMissingAutoActivations", () => {
  it("un compte SANS client n'attend rien, et ne coûte aucune requête", async () => {
    mockAccountFindUnique.mockResolvedValue({ clientId: null });
    expect(await listMissingAutoActivations("acc-1")).toEqual([]);
    expect(mockAutoActivationFindMany).not.toHaveBeenCalled();
  });

  it("un compte inexistant n'attend rien", async () => {
    mockAccountFindUnique.mockResolvedValue(null);
    expect(await listMissingAutoActivations("nope")).toEqual([]);
  });

  it("liste les recettes du client absentes du compte", async () => {
    mockBindingFindMany.mockResolvedValue([{ patternTemplateId: "pt2" }]);
    expect(await listMissingAutoActivations("acc-1")).toEqual([
      { patternTemplateId: "pt1", label: "RVA1" },
      { patternTemplateId: "pt3", label: "RPOD" },
    ]);
  });

  /**
   * Un binding désactivé à la main est une DÉCISION, pas un oubli. Le
   * re-proposer reviendrait à défaire ce choix en boucle — d'où l'absence de
   * filtre `isActive` dans la requête des bindings existants.
   */
  it("un binding désactivé compte comme présent", async () => {
    mockBindingFindMany.mockResolvedValue([
      { patternTemplateId: "pt1" },
      { patternTemplateId: "pt2" },
      { patternTemplateId: "pt3" },
    ]);
    expect(await listMissingAutoActivations("acc-1")).toEqual([]);
    expect(mockBindingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ isActive: true }) }),
    );
  });

  it("les recettes archivées ne sont pas proposées", async () => {
    await listMissingAutoActivations("acc-1");
    expect(mockAutoActivationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patternTemplate: { isArchived: false } }),
      }),
    );
  });
});

describe("applyAutoActivations", () => {
  it("déploie chaque recette manquante avec le planning de la recette", async () => {
    mockBindingFindMany.mockResolvedValue([{ patternTemplateId: "pt2" }]);

    const result = await applyAutoActivations("acc-1", ctx());

    expect(result.ok.map((r) => r.patternTemplateId)).toEqual(["pt1", "pt3"]);
    expect(result.failed).toEqual([]);
    expect(mockDeploy).toHaveBeenCalledWith(
      {
        patternTemplateId: "pt1",
        accountIds: ["acc-1"],
        publishTime: "18:00",
        dayOfWeek: [1, 4],
      },
      expect.anything(),
    );
  });

  // Le planning vide est le cas NOMINAL des recettes de reels : elles naissent
  // en banque, la génération hebdo ne les concerne pas.
  it("un planning vide est transmis tel quel", async () => {
    mockAutoActivationFindMany.mockResolvedValue([
      { patternTemplateId: "pt1", patternTemplate: { label: "RVA1" } },
    ]);
    mockTemplateFindUnique.mockResolvedValue({
      autoActivateDayOfWeek: [],
      autoActivatePublishTime: "09:00",
    });

    await applyAutoActivations("acc-1", ctx());

    expect(mockDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ dayOfWeek: [], publishTime: "09:00" }),
      expect.anything(),
    );
  });

  it("une recette en échec n'empêche pas les autres", async () => {
    mockDeploy.mockImplementation(async (input: { patternTemplateId: string }) => {
      if (input.patternTemplateId === "pt2") throw new Error("Recette archivée");
      return { createdCount: 1, skippedCount: 0, bindingIds: ["b"] };
    });

    const result = await applyAutoActivations("acc-1", ctx());

    expect(result.ok.map((r) => r.patternTemplateId)).toEqual(["pt1", "pt3"]);
    expect(result.failed).toEqual([
      { patternTemplateId: "pt2", label: "RVA2", error: "Recette archivée" },
    ]);
  });

  it("`only` restreint aux recettes demandées", async () => {
    const result = await applyAutoActivations("acc-1", ctx(), ["pt3"]);
    expect(mockDeploy).toHaveBeenCalledTimes(1);
    expect(result.ok).toEqual([{ patternTemplateId: "pt3", label: "RPOD" }]);
  });

  it("un compte sans client ne déploie rien", async () => {
    mockAccountFindUnique.mockResolvedValue({ clientId: null });
    const result = await applyAutoActivations("acc-1", ctx());
    expect(result).toEqual({ ok: [], failed: [] });
    expect(mockDeploy).not.toHaveBeenCalled();
  });

  it("rien à activer → aucun déploiement", async () => {
    mockAutoActivationFindMany.mockResolvedValue([]);
    const result = await applyAutoActivations("acc-1", ctx());
    expect(result).toEqual({ ok: [], failed: [] });
    expect(mockDeploy).not.toHaveBeenCalled();
  });
});

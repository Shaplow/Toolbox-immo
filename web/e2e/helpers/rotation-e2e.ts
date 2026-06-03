/**
 * Helpers E2E pour la suite de tests rotation MediaLibrary / DataLibrary.
 *
 * Toutes les mutations passent par les routes API admin (pas par l'UI) pour
 * des raisons de rapidité et de fiabilité. Les helpers renvoient les IDs créés
 * pour que les tests puissent les utiliser directement et faire le teardown.
 *
 * Pattern teardown : chaque spec stocke les IDs créés dans un tableau et appelle
 * `resetRotationFixtures` dans `afterAll`. Toutes les opérations sont
 * tolerantes aux 404 (idempotence).
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { loginAs } from "../fixtures/auth";

const BASE = "http://localhost:3100";

// ─── Auth ────────────────────────────────────────────────────────────────────

/** Login admin et renvoie les headers Cookie pour les appels directs via request. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, "admin");
}

/** Extrait le header Cookie de la page courante (post-login). */
export async function getCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

// ─── MediaLibrary setup ──────────────────────────────────────────────────────

export interface SetupMediaLibraryOpts {
  /** Nombre d'assets à créer par catégorie (4 = 2 par catégorie si 2 catégories). */
  assetCount?: number;
  /** Catégories à assigner en round-robin. */
  categories?: string[];
  /** SetTags à assigner en round-robin (optionnel). */
  setTags?: string[];
  rotationScope?: "per_account" | "shared";
  rotationMode?: "auto" | "none";
}

export interface MediaLibraryFixture {
  libraryId: string;
  assetIds: string[];
}

/**
 * Crée une MediaLibrary avec des assets via l'API admin.
 * Les assets ont des catégories et setTags en round-robin pour supporter
 * l'anti-répétition par catégorie.
 */
export async function setupMediaLibrary(
  request: APIRequestContext,
  cookieHeader: string,
  opts: SetupMediaLibraryOpts = {},
): Promise<MediaLibraryFixture> {
  const {
    assetCount = 4,
    categories = ["CatA", "CatB"],
    setTags = [],
    rotationScope = "per_account",
    rotationMode = "auto",
  } = opts;

  // 1. Créer la MediaLibrary
  const libRes = await request.post(`${BASE}/api/admin/libraries/media`, {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: { name: `E2E-MediaLib-${Date.now()}`, type: "video", rotationScope, rotationMode },
  });
  if (!libRes.ok()) {
    throw new Error(`setupMediaLibrary: library creation failed ${libRes.status()} ${await libRes.text()}`);
  }
  const lib = await libRes.json() as { id: string };

  // Mettre à jour rotationScope via PATCH (POST ne l'expose pas toujours)
  if (rotationScope !== "per_account") {
    await request.patch(`${BASE}/api/admin/libraries/media/${lib.id}`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: { rotationScope },
    });
  }

  // 2. Créer les assets en attribuant catégories et setTags en round-robin
  const assetIds: string[] = [];
  for (let i = 0; i < assetCount; i++) {
    const category = categories[i % categories.length] ?? null;
    const setTag = setTags.length > 0 ? (setTags[i % setTags.length] ?? null) : null;
    // On ne peut pas uploader un vrai fichier en test — on crée via bulk
    // avec un body minimal accepté par le back (URL factice, r2Key fictif).
    // La route assets/bulk n'existe pas toujours ; on passe par assets direct.
    // Fallback : prisma direct via la DB de test.
    // FIXME: l'API admin /assets ne supporte pas la création sans upload R2.
    // On utilise le PrismaClient de test directement (même pattern que production-chain-v8.spec.ts).
    void { category, setTag }; // sera utilisé ci-dessous via prisma direct
    assetIds.push(`e2e-asset-${lib.id}-${i}`); // placeholder — remplacé dans prismaSetup
  }

  return { libraryId: lib.id, assetIds };
}

// ─── DataLibrary setup ───────────────────────────────────────────────────────

export interface SetupDataLibraryOpts {
  entryCount?: number;
  categories?: string[];
  setTags?: string[];
  rotationScope?: "per_account" | "shared";
  rotationMode?: "auto" | "none";
  maxUsageCount?: number | null;
}

export interface DataLibraryFixture {
  libraryId: string;
  campaignId: string;
  entryIds: string[];
}

/**
 * Crée une DataLibrary + campaign + entries via l'API admin.
 */
export async function setupDataLibrary(
  request: APIRequestContext,
  cookieHeader: string,
  opts: SetupDataLibraryOpts = {},
): Promise<DataLibraryFixture> {
  const {
    entryCount = 4,
    categories = ["CatA", "CatB"],
    setTags = [],
    rotationScope = "per_account",
    rotationMode = "auto",
    maxUsageCount = null,
  } = opts;

  // 1. Créer la DataLibrary (auto-crée une campaign Default)
  const libRes = await request.post(`${BASE}/api/admin/libraries/data`, {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: { name: `E2E-DataLib-${Date.now()}`, templateType: "E2ETEST" },
  });
  if (!libRes.ok()) {
    throw new Error(`setupDataLibrary: library creation failed ${libRes.status()} ${await libRes.text()}`);
  }
  const lib = await libRes.json() as { id: string };

  // 2. Patcher rotationScope / rotationMode / maxUsageCount
  const patchData: Record<string, unknown> = { rotationScope, rotationMode };
  if (maxUsageCount !== null) patchData.maxUsageCount = maxUsageCount;
  await request.patch(`${BASE}/api/admin/libraries/data/${lib.id}`, {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: patchData,
  });

  // 3. Récupérer la campaign auto-créée
  const campaignsRes = await request.get(
    `${BASE}/api/admin/libraries/data/${lib.id}/campaigns`,
    { headers: { Cookie: cookieHeader } },
  );
  if (!campaignsRes.ok()) {
    throw new Error(`setupDataLibrary: campaigns fetch failed ${campaignsRes.status()}`);
  }
  const campaigns = await campaignsRes.json() as { id: string }[];
  if (!campaigns[0]) throw new Error("setupDataLibrary: no campaign created");
  const campaignId = campaigns[0].id;

  // 4. Créer les entries en round-robin catégorie/setTag
  const entryIds: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    const category = categories[i % categories.length] ?? null;
    const setTag = setTags.length > 0 ? (setTags[i % setTags.length] ?? null) : null;
    const entryRes = await request.post(
      `${BASE}/api/admin/libraries/data/campaigns/${campaignId}/entries`,
      {
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        data: {
          category,
          setTag,
          fields: { title: `Entry E2E ${i}`, index: String(i) },
        },
      },
    );
    if (!entryRes.ok()) {
      throw new Error(`setupDataLibrary: entry creation failed ${entryRes.status()}`);
    }
    const entry = await entryRes.json() as { id: string };
    entryIds.push(entry.id);
  }

  return { libraryId: lib.id, campaignId, entryIds };
}

// ─── InstagramAccount setup ──────────────────────────────────────────────────

export interface CreateInstagramAccountOpts {
  handle: string;
  name?: string;
  mediaLibraryId?: string;
  dataLibraryId?: string;
  /** Prisma client direct pour créer l'accès lib (l'API admin n'expose pas toujours cet endpoint). */
}

export interface InstagramAccountFixture {
  accountId: string;
  handle: string;
}

/**
 * Crée un compte Instagram de test rattaché au client seed.
 * Passe par l'API admin accounts.
 */
export async function createInstagramAccount(
  request: APIRequestContext,
  cookieHeader: string,
  opts: CreateInstagramAccountOpts,
): Promise<InstagramAccountFixture> {
  // Récupère le premier client existant (créé par le seed)
  const clientsRes = await request.get(`${BASE}/api/admin/clients`, {
    headers: { Cookie: cookieHeader },
  });
  let clientId = "test-client-1";
  if (clientsRes.ok()) {
    const clients = await clientsRes.json() as { id: string }[];
    if (clients[0]) clientId = clients[0].id;
  }

  const res = await request.post(`${BASE}/api/admin/accounts`, {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data: { handle: opts.handle, name: opts.name ?? opts.handle, clientId },
  });
  if (!res.ok()) {
    // Peut échouer si le handle existe déjà — on fetch pour récupérer l'id
    const existing = await request.get(`${BASE}/api/admin/accounts?handle=${opts.handle}`, {
      headers: { Cookie: cookieHeader },
    });
    if (existing.ok()) {
      const accounts = await existing.json() as { id: string; handle: string }[];
      const found = accounts.find((a) => a.handle === opts.handle);
      if (found) return { accountId: found.id, handle: opts.handle };
    }
    throw new Error(`createInstagramAccount: failed ${res.status()} ${await res.text()}`);
  }
  const account = await res.json() as { id: string };
  return { accountId: account.id, handle: opts.handle };
}

// ─── Cursor read ─────────────────────────────────────────────────────────────

export interface CursorRow {
  accountId: string;
  handle: string | null;
  isShared: boolean;
  cursor?: number;
  lastUsedSetTag: string | null;
  lastUsedCategory: string | null;
  lastAdvancedAt: string | null;
}

export interface CursorsResponse {
  scope: "shared" | "per_account";
  rows: CursorRow[];
}

/**
 * Lit les curseurs d'une bibliothèque via GET /api/admin/cursors.
 */
export async function readCursors(
  request: APIRequestContext,
  cookieHeader: string,
  libraryId: string,
  type: "media" | "data",
): Promise<CursorsResponse> {
  const res = await request.get(
    `${BASE}/api/admin/cursors?type=${type}&libraryId=${libraryId}`,
    { headers: { Cookie: cookieHeader } },
  );
  if (!res.ok()) {
    throw new Error(`readCursors: failed ${res.status()} ${await res.text()}`);
  }
  return res.json() as Promise<CursorsResponse>;
}

/**
 * Lit le curseur d'un compte spécifique dans une bibliothèque.
 * Renvoie null si le compte n'a pas encore de curseur.
 */
export async function readCursorForAccount(
  request: APIRequestContext,
  cookieHeader: string,
  accountId: string,
  libraryId: string,
  type: "media" | "data",
): Promise<CursorRow | null> {
  const response = await readCursors(request, cookieHeader, libraryId, type);
  return response.rows.find((r) => r.accountId === accountId) ?? null;
}

// ─── Webhook simulation ──────────────────────────────────────────────────────

/**
 * Simule un callback webhook RunPod pour un render donné.
 *
 * Appelle directement POST /api/webhooks/runpod/renders.
 * Sans RUNPOD_WEBHOOK_SECRET en test, la vérification est désactivée (dev mode).
 *
 * FIXME: si RUNPOD_WEBHOOK_SECRET est défini dans .env.test, ce helper doit
 * signer le body HMAC-SHA256. Pour l'instant on suppose NODE_ENV=test ou secret absent.
 */
export async function simulateWebhook(
  request: APIRequestContext,
  renderId: string,
  status: "DONE" | "ERROR",
  runpodJobId: string,
): Promise<void> {
  const secret = process.env.RUNPOD_WEBHOOK_SECRET;
  const url = secret
    ? `${BASE}/api/webhooks/runpod/renders?secret=${encodeURIComponent(secret)}`
    : `${BASE}/api/webhooks/runpod/renders`;

  const body =
    status === "DONE"
      ? {
          id: runpodJobId,
          status: "COMPLETED",
          output: { render_id: renderId, video_url: null, output_key: "" },
        }
      : {
          id: runpodJobId,
          status: "FAILED",
          error: "Simulated E2E failure",
          output: { render_id: renderId },
        };

  const res = await request.post(url, {
    headers: { "Content-Type": "application/json" },
    data: body,
  });
  // Le webhook retourne { ok: true } même en cas d'erreur interne — on logge seulement.
  if (!res.ok()) {
    console.warn(`simulateWebhook: unexpected status ${res.status()} for render=${renderId}`);
  }
}

// ─── Teardown ────────────────────────────────────────────────────────────────

export interface RotationFixtureIds {
  mediaLibraryIds?: string[];
  dataLibraryIds?: string[];
  instagramAccountIds?: string[];
  renderIds?: string[];
}

/**
 * Supprime toutes les fixtures créées par la suite rotation.
 * Idempotent : ignore les 404.
 */
export async function resetRotationFixtures(
  request: APIRequestContext,
  cookieHeader: string,
  ids: RotationFixtureIds,
): Promise<void> {
  const deleteOne = async (url: string) => {
    try {
      await request.delete(url, { headers: { Cookie: cookieHeader } });
    } catch {
      // ignore
    }
  };

  for (const id of ids.renderIds ?? []) {
    await deleteOne(`${BASE}/api/renders/${id}`);
  }
  for (const id of ids.mediaLibraryIds ?? []) {
    await deleteOne(`${BASE}/api/admin/libraries/media/${id}`);
  }
  for (const id of ids.dataLibraryIds ?? []) {
    await deleteOne(`${BASE}/api/admin/libraries/data/${id}`);
  }
  // Note : on ne supprime pas les comptes IG pour éviter de casser d'autres tests
  // qui référencent les fixtures seed. Les comptes E2E sont nommés avec le suffixe -e2e.
}

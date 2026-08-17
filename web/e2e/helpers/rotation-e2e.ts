/**
 * Helpers E2E pour la suite de tests folder-draw (MediaLibrary / DataLibrary).
 *
 * Plan simplification Phase 4 (2026-08) : les curseurs (AccountLibraryCursor /
 * AccountDataLibraryCursor), leurs routes admin (`/api/admin/cursors*`) et le
 * wrapper DataCampaign (`/api/admin/libraries/data/campaigns/**`,
 * `/api/admin/libraries/data/[id]/campaigns`) sont décommissionnés. Les
 * helpers de lecture de curseur (`readCursors` / `readCursorForAccount`) et
 * les setups qui passaient par ces routes ont été retirés — les specs
 * folder-draw créent leurs fixtures directement via PrismaClient (pattern de
 * l'ancien `rotation-flow.spec.ts`, cf. `folder-draw.spec.ts`).
 *
 * Toutes les mutations restantes passent par les routes API admin (pas par
 * l'UI) pour des raisons de rapidité et de fiabilité. Les helpers renvoient
 * les IDs créés pour que les tests puissent les utiliser directement et faire
 * le teardown.
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

// ─── InstagramAccount setup ──────────────────────────────────────────────────

export interface CreateInstagramAccountOpts {
  handle: string;
  name?: string;
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

// ─── Webhook simulation ──────────────────────────────────────────────────────

/**
 * Simule un callback webhook RunPod pour un render donné.
 *
 * Appelle directement POST /api/webhooks/runpod/renders.
 * Sans RUNPOD_WEBHOOK_SECRET en test, la vérification est désactivée (dev mode).
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
 * Supprime toutes les fixtures créées par la suite folder-draw.
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

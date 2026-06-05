/**
 * Shared helpers for RunPod webhook route handlers.
 *
 * Usage in a webhook route:
 *
 *   const parsed = await verifyAndParseRunpodWebhook<MyOutput>(req);
 *   if (!parsed.ok) return parsed.response;
 *
 *   const { id: runpodJobId, status, output, error } = parsed.body;
 *
 * Sécurité : `verifyAndParseRunpodWebhook` priorise la signature HMAC posée
 * par le worker render-engine (`X-Toolbox-Signature` / `X-Toolbox-Timestamp`)
 * et retombe sur le `?secret=` query-param tant que la migration n'est pas
 * confirmée en prod. Ne JAMAIS introduire d'autre primitive de verify ici —
 * une seule fonction = pas de drift sur les sentinels d'auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.RUNPOD_WEBHOOK_SECRET;

/**
 * Security-auditor Critical-1 (2026-06-01) — HMAC body-signing optionnel.
 *
 * Le secret en query param (?secret=...) fuite dans les logs serveur (CDN,
 * proxy, RunPod history). Migration vers HMAC body-signed via header
 * `X-Toolbox-Signature: sha256=<hex>` + `X-Toolbox-Timestamp: <iso>`.
 *
 * Phase de transition : on accepte les DEUX méthodes pendant 7 jours pour
 * éviter de casser les jobs en vol. Le worker render-engine doit ensuite
 * être migré pour signer le body et plus passer le secret en query.
 *
 * Replay attack protection : timestamp doit être < 5min du now serveur,
 * sinon reject même si signature valide.
 */
const HMAC_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Vérifie une signature HMAC-SHA256 sur le body brut.
 * Retourne true si valide ET timestamp dans la fenêtre anti-replay.
 */
function verifyHmacSignature(rawBody: string, signatureHeader: string | null, timestampHeader: string | null): boolean {
  if (!WEBHOOK_SECRET || !signatureHeader || !timestampHeader) return false;

  // Format header attendu : "sha256=<hex>"
  const sigMatch = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader);
  if (!sigMatch) return false;
  const providedHex = sigMatch[1];

  // Timestamp dans la fenêtre anti-replay
  const ts = Date.parse(timestampHeader);
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  if (Math.abs(now - ts) > HMAC_REPLAY_WINDOW_MS) return false;

  // Calcul HMAC sur `timestamp.body` pour binding (sinon attaquant peut rejouer
  // un body avec un nouveau timestamp et reconstruire la signature).
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestampHeader}.${rawBody}`)
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(providedHex, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

if (!WEBHOOK_SECRET && process.env.NODE_ENV !== "test") {
  // Non gated par NODE_ENV=production : staging / preview deployments
  // sont aussi exposés à internet et doivent surfacer le warning. Seul
  // l'environnement de test (vitest) reste silencieux pour ne pas polluer.
  const env = process.env.NODE_ENV ?? "development";
  console.error(
    `[security] RUNPOD_WEBHOOK_SECRET is not set (NODE_ENV=${env}). ` +
    "RunPod webhook endpoints are unauthenticated — anyone can fake job completions. " +
    "Set RUNPOD_WEBHOOK_SECRET in your environment variables."
  );
}

if (!process.env.NEXTAUTH_URL && process.env.NODE_ENV === "production") {
  console.error(
    "[config] NEXTAUTH_URL is not set in production. " +
    "RunPod jobs will be submitted without a webhook callback URL — " +
    "their status will never be updated automatically in the database, " +
    "and all jobs will appear stuck in PROCESSING indefinitely. " +
    "Set NEXTAUTH_URL to the public-facing URL of this server."
  );
}

/**
 * Vérifie en priorité une signature HMAC body-signed du webhook RunPod.
 * Le caller doit fournir le rawBody (avant parse JSON). Toutes les routes
 * webhook RunPod doivent utiliser `verifyAndParseRunpodWebhook` qui s'en
 * occupe automatiquement.
 *
 * Migration recommandée :
 * 1. Worker render-engine signe `X-Toolbox-Signature: sha256=hex(hmac(SECRET, ts.body))`
 * 2. Worker envoie aussi `X-Toolbox-Timestamp: <iso>`
 * 3. Côté Next : `const raw = await req.text(); const body = JSON.parse(raw); verifyRunpodWebhookWithBody(req, raw);`
 * 4. Une fois tous les workers migrés (~7j), retirer le fallback query param.
 */
export function verifyRunpodWebhookWithBody(req: NextRequest, rawBody: string): NextResponse | null {
  if (!WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Webhook secret not configured on server" },
        { status: 503 },
      );
    }
    return null;
  }

  const sigHeader = req.headers.get("x-toolbox-signature");
  const tsHeader = req.headers.get("x-toolbox-timestamp");
  if (verifyHmacSignature(rawBody, sigHeader, tsHeader)) {
    return null; // HMAC valide
  }

  // Fallback legacy query param (à retirer post-migration)
  const provided = req.nextUrl.searchParams.get("secret");
  if (!provided) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const providedBuf = Buffer.from(provided, "utf8");
  const secretBuf = Buffer.from(WEBHOOK_SECRET, "utf8");
  if (providedBuf.length !== secretBuf.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!timingSafeEqual(providedBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export interface RunpodWebhookBody<TOutput = Record<string, unknown>> {
  id: string;
  status: string;
  output?: TOutput;
  error?: string;
}

/**
 * One-shot helper : lit le body, vérifie l'auth (HMAC priorité, fallback query
 * secret legacy), parse le JSON. Tous les webhook routes RunPod doivent passer
 * par ici — c'est la seule fonction de verify exportée.
 */
export async function verifyAndParseRunpodWebhook<TOutput = Record<string, unknown>>(
  req: NextRequest,
): Promise<
  | { ok: true; body: RunpodWebhookBody<TOutput> }
  | { ok: false; response: NextResponse }
> {
  // Lire le body RAW une seule fois — req.body est une stream non-rewindable.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Cannot read body" }, { status: 400 }),
    };
  }

  // Auth : HMAC en priorité, fallback query secret legacy.
  const authError = verifyRunpodWebhookWithBody(req, rawBody);
  if (authError) {
    return { ok: false, response: authError };
  }

  // Parse JSON
  let body: RunpodWebhookBody<TOutput>;
  try {
    body = JSON.parse(rawBody) as RunpodWebhookBody<TOutput>;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }

  if (!body.id || !body.status) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing id or status" }, { status: 400 }),
    };
  }

  // Non-blocking : decrement active job count and maybe stop the pod.
  // Cf. parseRunpodWebhookBody pour le rationale.
  if (body.id.startsWith("pod-")) {
    void import("@/lib/podOrchestrator").then(({ onPodJobComplete }) => {
      void onPodJobComplete();
    });
  }

  return { ok: true, body };
}

/**
 * Parses and validates the JSON body sent by RunPod on job completion.
 * Returns { ok: true, body } on success, or { ok: false, response } on parse error.
 *
 * Also triggers a non-blocking idle-stop check on the pod after each completed
 * job — this is the single call site for maybeStopIdlePod() across all webhooks.
 *
 * @deprecated Use `verifyAndParseRunpodWebhook` instead (supports HMAC body-signing).
 */
export async function parseRunpodWebhookBody<TOutput = Record<string, unknown>>(
  req: NextRequest
): Promise<
  | { ok: true; body: RunpodWebhookBody<TOutput> }
  | { ok: false; response: NextResponse }
> {
  let body: RunpodWebhookBody<TOutput>;
  try {
    body = (await req.json()) as RunpodWebhookBody<TOutput>;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }

  if (!body.id || !body.status) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing id or status" }, { status: 400 }),
    };
  }

  // Non-blocking: decrement active job count and maybe stop the pod.
  // Only for pod-dispatched jobs (id "pod-*") — Serverless jobs never call
  // recordPodActivity(), so must not decrement activeJobCount.
  if (body.id.startsWith("pod-")) {
    void import("@/lib/podOrchestrator").then(({ onPodJobComplete }) => {
      void onPodJobComplete();
    });
  }

  return { ok: true, body };
}

/**
 * Builds the callback URL that RunPod will POST to when a job completes.
 *
 * Uses NEXTAUTH_URL (public-facing URL) so RunPod (an external service) can
 * reach the endpoint. NEXTAUTH_URL_INTERNAL is intentionally NOT used here —
 * it is a Docker-internal hostname unreachable from the internet.
 *
 * Le worker render-engine pose désormais une signature HMAC dans les headers
 * (`X-Toolbox-Signature` + `X-Toolbox-Timestamp`) — le query-param `?secret=`
 * reste appendé pour couvrir les workers non-migrés. À retirer une fois la
 * télémetrie prod confirme 100% des callbacks en HMAC sur ~7 jours.
 *
 * Returns an empty string if NEXTAUTH_URL is not set — callers must skip
 * attaching the webhook field in that case (dev without tunnel, etc.).
 */
export function getRunpodWebhookUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  if (!base) {
    console.warn(
      `[runpod/webhook] getRunpodWebhookUrl("${path}") called but NEXTAUTH_URL is not set. ` +
      "The RunPod job will be submitted without a callback URL — its status will never be " +
      "updated automatically. Set NEXTAUTH_URL to fix this."
    );
    return "";
  }
  const url = new URL(`${base}${path}`);
  if (WEBHOOK_SECRET) {
    url.searchParams.set("secret", WEBHOOK_SECRET);
  }
  return url.toString();
}

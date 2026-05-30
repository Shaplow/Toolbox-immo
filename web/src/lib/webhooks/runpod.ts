/**
 * Shared helpers for RunPod webhook route handlers.
 *
 * Usage in a webhook route:
 *
 *   const authError = verifyRunpodWebhook(req);
 *   if (authError) return authError;
 *
 *   const parsed = await parseRunpodWebhookBody<MyOutput>(req);
 *   if (!parsed.ok) return parsed.response;
 *
 *   const { id: runpodJobId, status, output, error } = parsed.body;
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.RUNPOD_WEBHOOK_SECRET;

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
 * Verifies the ?secret= query parameter against RUNPOD_WEBHOOK_SECRET.
 * RunPod does not support custom request headers in webhooks — the secret is
 * embedded in the webhook URL as a query parameter by getRunpodWebhookUrl and
 * forwarded verbatim by RunPod when it POSTs the callback.
 * Returns a NextResponse 4xx/5xx if verification fails, null if OK.
 *
 * Fix bug audit 2026-05-30 (M3) : si RUNPOD_WEBHOOK_SECRET absent en prod,
 * on retourne 503 au lieu d'accepter aveuglément. En dev (NODE_ENV !== "production"),
 * on tolère l'absence du secret (log warning) pour faciliter le développement local.
 */
export function verifyRunpodWebhook(req: NextRequest): NextResponse | null {
  if (!WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.error("[verifyRunpodWebhook] RUNPOD_WEBHOOK_SECRET non défini en PROD — webhook refusé.");
      return NextResponse.json(
        { error: "Webhook secret not configured on server" },
        { status: 503 },
      );
    }
    console.warn(
      "[verifyRunpodWebhook] RUNPOD_WEBHOOK_SECRET non défini — vérification désactivée (dev only).",
    );
    return null;
  }
  const provided = req.nextUrl.searchParams.get("secret");
  if (!provided) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Comparaison timing-safe : un `provided !== WEBHOOK_SECRET` court-circuite
  // au premier byte qui diffère, ce qui permet à un attaquant qui mesure
  // précisément la latence de reconstruire le secret caractère par caractère.
  // Buffer length doit être identique sinon timingSafeEqual throw — d'où le
  // guard de longueur avant.
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
 * Parses and validates the JSON body sent by RunPod on job completion.
 * Returns { ok: true, body } on success, or { ok: false, response } on parse error.
 *
 * Also triggers a non-blocking idle-stop check on the pod after each completed
 * job — this is the single call site for maybeStopIdlePod() across all webhooks.
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
 * If RUNPOD_WEBHOOK_SECRET is set it is appended as ?secret=<value> so
 * verifyRunpodWebhook can validate it (RunPod forwards query params verbatim).
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

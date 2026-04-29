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

const WEBHOOK_SECRET = process.env.RUNPOD_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET && process.env.NODE_ENV === "production") {
  console.error(
    "[security] RUNPOD_WEBHOOK_SECRET is not set in production. " +
    "RunPod webhook endpoints are unauthenticated — anyone can fake job completions. " +
    "Set RUNPOD_WEBHOOK_SECRET in your environment variables."
  );
}

/**
 * Verifies the X-Webhook-Secret header against RUNPOD_WEBHOOK_SECRET.
 * Returns a 401 NextResponse if verification fails, null if OK.
 * If RUNPOD_WEBHOOK_SECRET is not set, the check is skipped (dev / unprotected).
 */
export function verifyRunpodWebhook(req: NextRequest): NextResponse | null {
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

  return { ok: true, body };
}

/**
 * Builds the callback URL that RunPod will POST to when a job completes.
 *
 * Uses NEXTAUTH_URL_INTERNAL first (Docker internal routing) then NEXTAUTH_URL.
 * Returns an empty string if neither env var is set — callers must skip attaching
 * the webhook field in that case (dev without tunnel, local render-engine, etc.).
 */
export function getRunpodWebhookUrl(path: string): string {
  const base = (
    process.env.NEXTAUTH_URL_INTERNAL ??
    process.env.NEXTAUTH_URL ??
    ""
  ).replace(/\/$/, "");
  if (!base) return "";
  return `${base}${path}`;
}

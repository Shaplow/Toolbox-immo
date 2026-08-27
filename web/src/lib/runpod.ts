const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

/** Returns true when both RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are set. */
export function runpodConfigured(): boolean {
  return !!(RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID);
}

export interface RunpodStatusResponse<TOutput = unknown> {
  id: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: TOutput;
  error?: string;
}

/**
 * Fetch the status of a RunPod job.
 * Throws on HTTP error or network failure (no retry — callers poll on their own schedule).
 */
export async function fetchRunpodStatus<TOutput = unknown>(
  endpointId: string,
  apiKey: string,
  runpodJobId: string
): Promise<RunpodStatusResponse<TOutput>> {
  const res = await fetch(
    `https://api.runpod.ai/v2/${endpointId}/status/${runpodJobId}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) {
    throw new Error(`RunPod status API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<RunpodStatusResponse<TOutput>>;
}

// ─── Pod On-Demand helpers ────────────────────────────────────────────────────

/**
 * Prefix used to identify pod-dispatched job IDs in DB.
 * These IDs must NOT be polled via RunPod Serverless status API.
 */
export const POD_JOB_ID_PREFIX = "pod-";

/** Returns true when the given runpodJobId originated from a pod dispatch. */
export function isPodJobId(runpodJobId: string): boolean {
  return runpodJobId.startsWith(POD_JOB_ID_PREFIX);
}

// ─── Job phase resolver ───────────────────────────────────────────────────────

/**
 * Resolved phase returned by resolveRunpodJobPhase.
 *
 *   completed   — RunPod job finished successfully; output is populated.
 *   failed      — RunPod job finished with an error; error is populated.
 *   in_progress — job is still IN_QUEUE or IN_PROGRESS; no action needed.
 *                  runpodStatus is populated for Serverless jobs ("IN_QUEUE" | "IN_PROGRESS").
 *   stalled     — job exceeded the stall window; caller should mark it FAILED.
 *   unreachable — RunPod API threw; job age is within stall window; caller may
 *                 surface a warning but should NOT mark it FAILED yet.
 */
export type RunpodJobPhase<TOutput> =
  | { phase: "completed"; output: TOutput }
  | { phase: "failed"; error: string }
  | { phase: "in_progress"; runpodStatus?: "IN_QUEUE" | "IN_PROGRESS" }
  | { phase: "stalled" }
  | { phase: "unreachable" };

/**
 * Central RunPod poll + stall detection helper used by all status routes.
 *
 * Pod-dispatched jobs (isPodJobId=true) are never polled via RunPod API —
 * their result arrives via webhook. This function handles them gracefully
 * by returning in_progress until the stall window expires.
 *
 * @param endpointId       RUNPOD_ENDPOINT_ID
 * @param apiKey           RUNPOD_API_KEY
 * @param runpodJobId      The RunPod job to query.
 * @param jobUpdatedAt     job.updatedAt — used for stall detection.
 * @param stallMs          How long PROCESSING without resolution is considered stalled.
 */
export async function resolveRunpodJobPhase<TOutput = unknown>(
  endpointId: string,
  apiKey: string,
  runpodJobId: string,
  jobUpdatedAt: Date,
  stallMs: number
): Promise<RunpodJobPhase<TOutput>> {
  // Pod-dispatched jobs are handled by webhooks — never poll RunPod Serverless API.
  if (isPodJobId(runpodJobId)) {
    const ageMs = Date.now() - jobUpdatedAt.getTime();
    if (ageMs > stallMs) {
      return { phase: "stalled" };
    }
    return { phase: "in_progress" };
  }

  try {
    const rp = await fetchRunpodStatus<TOutput>(endpointId, apiKey, runpodJobId);

    if (rp.status === "COMPLETED") {
      return { phase: "completed", output: rp.output as TOutput };
    }

    if (
      rp.status === "FAILED" ||
      rp.status === "CANCELLED" ||
      rp.status === "TIMED_OUT"
    ) {
      return { phase: "failed", error: rp.error ?? `RunPod job ${rp.status}` };
    }

    // IN_QUEUE or IN_PROGRESS — check stall before returning
    const ageMs = Date.now() - jobUpdatedAt.getTime();
    if (ageMs > stallMs) {
      return { phase: "stalled" };
    }

    return { phase: "in_progress", runpodStatus: rp.status as "IN_QUEUE" | "IN_PROGRESS" };
  } catch (err) {
    // RunPod unreachable — apply stall check anyway so genuinely abandoned jobs
    // eventually surface as FAILED even when RunPod stays down.
    const ageMs = Date.now() - jobUpdatedAt.getTime();
    if (ageMs > stallMs) {
      return { phase: "stalled" };
    }
    console.error("[runpod/resolveRunpodJobPhase] RunPod status fetch failed:", err);
    return { phase: "unreachable" };
  }
}

// ─── Submit helpers ───────────────────────────────────────────────────────────

const TRANSIENT_RUNPOD_STATUS = new Set([429, 502, 503, 504]);

type SubmitRunpodJobOptions = {
  timeoutMs?: number;
  retryDelaysMs?: number[];
  /**
   * Interdit le chemin Pod On-Demand : le job part en Serverless, quitte à
   * attendre en file.
   *
   * Le pod n'a qu'une GPU et `pod_server.py` le protège par un `Semaphore(1)` —
   * il ne traite qu'un job à la fois. Or le routage ci-dessous y bascule
   * précisément quand Serverless n'a plus de worker idle, c'est-à-dire pendant
   * une rafale. Un job purement CPU (extraction de frames) n'a donc rien à y
   * faire : il y démarrerait une GPU pour rien, et bloquerait derrière lui un
   * render ou une transcription qui, eux, en ont besoin.
   */
  serverlessOnly?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch a job directly to the pod FastAPI /api/run.
 * Returns immediately with { id: "pod-xxx" }; result arrives via webhook.
 * Internal — callers use submitRunpodJob which includes pod-first logic.
 */
async function _dispatchJobToPod<TResponse>(
  podUrl: string,
  payload: unknown,
  timeoutMs = 15_000
): Promise<TResponse> {
  const res = await fetch(`${podUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Pod /api/run ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<TResponse>;
}

/**
 * Send a job directly to RunPod Serverless (no pod logic).
 * Internal — callers use submitRunpodJob which includes pod-first logic.
 */
async function _submitToServerless<TResponse>(
  endpointId: string,
  apiKey: string,
  payload: unknown,
  options: SubmitRunpodJobOptions = {}
): Promise<TResponse> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retryDelaysMs = options.retryDelaysMs ?? [2_000, 5_000, 10_000, 20_000];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return await response.json() as TResponse;
      }

      const body = await response.text();
      const message = `RunPod API ${response.status}: ${body}`;
      if (!TRANSIENT_RUNPOD_STATUS.has(response.status) || attempt === retryDelaysMs.length) {
        throw new Error(message);
      }
      console.warn(
        `[runpod] transient submit failure (attempt ${attempt + 1}/${retryDelaysMs.length + 1})`,
        message
      );
      lastError = new Error(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const isAbort = err.name === "TimeoutError" || err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if ((!isAbort && !isNetwork) || attempt === retryDelaysMs.length) {
        throw err;
      }
      console.warn(
        `[runpod] submit retry after ${isAbort ? "timeout" : "network error"} ` +
        `(attempt ${attempt + 1}/${retryDelaysMs.length + 1})`,
        err.message
      );
      lastError = err;
    }

    await sleep(retryDelaysMs[attempt]);
  }

  // lastError is always set when we reach here — the loop only continues after catching
  throw lastError!;
}

// ─── Serverless health check ─────────────────────────────────────────────────

interface ServerlessHealth {
  workers: { idle: number; running: number };
  jobs: { inQueue: number; inProgress: number; completed: number; failed: number };
}

// Short-lived cache: avoids a 5s HTTP round-trip on every job submission.
const _serverlessHealthCacheMap = new Map<string, { value: boolean; expiresAt: number }>();

/**
 * Check whether the Serverless endpoint has idle workers ready to pick up a job.
 * Returns true when at least one idle worker is available (expect <5s cold start).
 * Returns false on network error or if no workers are idle.
 * Result is cached for 15s to avoid blocking every job on a health call.
 */
async function serverlessHasIdleWorkers(endpointId: string, apiKey: string): Promise<boolean> {
  const cached = _serverlessHealthCacheMap.get(endpointId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  try {
    const res = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      _serverlessHealthCacheMap.set(endpointId, { value: false, expiresAt: Date.now() + 5_000 });
      return false;
    }
    const data = await res.json() as ServerlessHealth;
    const idle = data?.workers?.idle ?? 0;
    console.log(`[runpod] Serverless health (${endpointId}): ${idle} workers idle, ${data?.jobs?.inQueue ?? 0} en queue`);
    const result = idle > 0;
    _serverlessHealthCacheMap.set(endpointId, { value: result, expiresAt: Date.now() + 15_000 });
    return result;
  } catch {
    _serverlessHealthCacheMap.set(endpointId, { value: false, expiresAt: Date.now() + 5_000 });
    return false;
  }
}

// ─── Public submit API ────────────────────────────────────────────────────────

/**
 * Submit a job to RunPod — Serverless-first when workers are idle, Pod as fallback.
 *
 * Strategy:
 *   1. If Serverless has idle workers → dispatch to Serverless immediately (<5s cold start).
 *   2. Otherwise, if pod mode is configured → start/reuse Pod On-Demand and dispatch there.
 *      The pod is cheaper per-minute and avoids Serverless queue when workers are saturated.
 *   3. If pod is unavailable (cold start timeout, GPU unavailable) → fall back to Serverless
 *      and wait in queue rather than failing the job entirely.
 *
 * Drop-in replacement: zero changes required in existing route files.
 */
export async function submitRunpodJob<TResponse>(
  endpointId: string,
  apiKey: string,
  payload: unknown,
  options: SubmitRunpodJobOptions = {}
): Promise<TResponse> {
  // Lazy import — avoids circular deps and keeps pod logic tree-shakeable
  const { podModeConfigured, ensurePodReady, recordPodActivity, onPodJobComplete, PodUnavailableError } =
    await import("@/lib/podOrchestrator");

  // Step 1 — check Serverless availability first (only when pod mode is configured;
  // if pod mode is off, always use Serverless directly).
  if (podModeConfigured() && !options.serverlessOnly) {
    const hasIdleWorkers = await serverlessHasIdleWorkers(endpointId, apiKey);

    if (hasIdleWorkers) {
      // Serverless has idle capacity — use it immediately, no cold start.
      console.log("[runpod] Worker Serverless idle disponible → Serverless direct");
      return _submitToServerless<TResponse>(endpointId, apiKey, payload, options);
    }

    // Step 2 — no idle Serverless workers, use Pod On-Demand.
    console.log("[runpod] Aucun worker Serverless idle → dispatch Pod On-Demand");
    try {
      const podUrl = await ensurePodReady();
      // Increment BEFORE dispatching so the counter is in DB if the process crashes
      // between dispatch and the following await. On dispatch failure, roll back.
      await recordPodActivity();
      let result: TResponse;
      try {
        result = await _dispatchJobToPod<TResponse>(podUrl, payload);
      } catch (dispatchErr) {
        // Dispatch failed — undo the increment (no webhook will arrive to decrement it)
        void onPodJobComplete();
        throw dispatchErr;
      }
      console.log("[runpod] Job dispatché via pod On-Demand ✓");
      return result;
    } catch (err) {
      if (err instanceof PodUnavailableError) {
        console.warn("[runpod] Pod indisponible → fallback Serverless (attente queue):", err.message);
      } else {
        console.warn("[runpod] Erreur dispatch pod → fallback Serverless (attente queue):", err);
      }
    }
  }

  // Step 3 — Serverless fallback (pod unavailable or pod mode not configured).
  return _submitToServerless<TResponse>(endpointId, apiKey, payload, options);
}

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

// ─── Job phase resolver ───────────────────────────────────────────────────────

/**
 * Resolved phase returned by resolveRunpodJobPhase.
 *
 *   completed   — RunPod job finished successfully; `output` is populated.
 *   failed      — RunPod job finished with an error; `error` is populated.
 *   in_progress — job is still IN_QUEUE or IN_PROGRESS; no action needed.
 *   stalled     — job exceeded the stall window; caller should mark it FAILED.
 *   unreachable — RunPod API threw; job age is within stall window; caller may
 *                 surface a warning but should NOT mark it FAILED yet.
 */
export type RunpodJobPhase<TOutput> =
  | { phase: "completed"; output: TOutput }
  | { phase: "failed"; error: string }
  | { phase: "in_progress" }
  | { phase: "stalled" }
  | { phase: "unreachable" };

/**
 * Central RunPod poll + stall detection helper used by all status routes.
 *
 * Callers pass the already-loaded job fields; this function calls RunPod,
 * applies stall detection, and returns a discriminated union so each route
 * can update its own DB model without duplicating the decision logic.
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

    return { phase: "in_progress" };
  } catch (err) {
    // RunPod unreachable — apply stall check anyway so genuinely abandoned jobs
    // eventually surface as FAILED even when RunPod stays down.
    const ageMs = Date.now() - jobUpdatedAt.getTime();
    if (ageMs > stallMs) {
      return { phase: "stalled" };
    }
    // Log here so every caller gets the error without duplicating the log line.
    console.error("[runpod/resolveRunpodJobPhase] RunPod status fetch failed:", err);
    return { phase: "unreachable" };
  }
}

const TRANSIENT_RUNPOD_STATUS = new Set([429, 502, 503, 504]);

type SubmitRunpodJobOptions = {
  timeoutMs?: number;
  retryDelaysMs?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitRunpodJob<TResponse>(
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
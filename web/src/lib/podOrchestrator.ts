/**
 * Pod Orchestrator — gestion du cycle de vie du pod On-Demand RunPod
 *
 * Stratégie :
 *   1. Si un pod existe en DB et est RUNNING + FastAPI OK → dispatch direct.
 *   2. Si le pod existe mais est EXITED → restart. Si le GPU n'est plus dispo
 *      → terminer l'ancien pod et créer un nouveau depuis le template.
 *   3. Si aucun pod en DB → créer un nouveau pod depuis le template.
 *   4. Si échec total → throw PodUnavailableError → fallback Serverless.
 *
 * Le pod ID est stocké en DB (PodState.podId) pour survivre aux redémarrages
 * de l'app web. Plus besoin de RUNPOD_POD_ID dans les env vars.
 *
 * Variables d'environnement :
 *   RUNPOD_POD_TEMPLATE_ID   — ID de la template RunPod (requis pour pod mode)
 *   RUNPOD_NETWORK_VOLUME_ID — ID du volume réseau persistant (optionnel)
 *   RUNPOD_POD_FASTAPI_PORT  — port interne exposé (défaut : 8080)
 *   RUNPOD_POD_IDLE_MINUTES  — minutes d'inactivité avant auto-stop (défaut : 10)
 *   RUNPOD_API_KEY           — clé API RunPod (partagée avec Serverless)
 */

import { prisma } from "@/lib/prisma";
import {
  startRunpodPod,
  stopRunpodPod,
  getRunpodPodInfo,
  buildPodFastapiUrl,
  createRunpodPod,
  terminateRunpodPod,
  PREFERRED_GPU_TYPES,
} from "@/lib/runpodPod";

// ─── Config ───────────────────────────────────────────────────────────────────

const TEMPLATE_ID      = process.env.RUNPOD_POD_TEMPLATE_ID;
const NETWORK_VOLUME_ID = process.env.RUNPOD_NETWORK_VOLUME_ID ?? null;
const FASTAPI_PORT     = parseInt(process.env.RUNPOD_POD_FASTAPI_PORT ?? "8080", 10);
const IDLE_MINUTES     = parseInt(process.env.RUNPOD_POD_IDLE_MINUTES ?? "10", 10);
const API_KEY          = process.env.RUNPOD_API_KEY;

/**
 * Max time to wait for a freshly created pod (image pull can take 5-10 min).
 * Phase 1: pulling image (runtime=null) → up to this total budget.
 * Phase 2: container up (runtime≠null) → FASTAPI_INIT_TIMEOUT_MS from that point.
 */
const POD_CREATE_TIMEOUT_MS = 600_000; // 10 min total budget for new pod
/** Max time to wait when restarting a stopped pod (image already cached, ~15-30s container start + Python boot). */
const POD_RESTART_TIMEOUT_MS = 180_000;
/**
 * Once container runtime is confirmed up, max time for FastAPI to respond.
 * Python cold start with torch/whisperx/fastapi imports can take 2-4 min.
 */
const FASTAPI_INIT_TIMEOUT_MS = 300_000;
/** Polling interval while waiting for pod to be RUNNING (ms). */
const POD_POLL_INTERVAL_MS = 4_000;
/** HTTP timeout for health check requests to the FastAPI (ms). */
const FASTAPI_HEALTH_TIMEOUT_MS = 5_000;
/**
 * If activeJobCount > 0 but no webhook has arrived for this many hours,
 * assume the webhook was permanently lost (network failure, app restart, etc.)
 * and reset the counter so the idle-stop logic can proceed.
 */
const STALE_JOB_HOURS = 4;

// ─── In-process concurrency lock ─────────────────────────────────────────────
// Prevents duplicate pod creation when concurrent requests all see status="stopped".
// Works within a single Node.js process (PM2 single instance).
let _ensurePodReadyInFlight: Promise<string> | null = null;

// Single pending idle-stop timer. Only one at a time — replaced on each job
// completion, cancelled when a new job starts.
let _idleStopTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true when pod mode is fully configured.
 * Requires RUNPOD_POD_TEMPLATE_ID + RUNPOD_API_KEY.
 */
export function podModeConfigured(): boolean {
  return !!(TEMPLATE_ID && API_KEY);
}

/**
 * Ensure a pod is running and its FastAPI is reachable.
 * Returns the base URL of the pod's FastAPI server.
 *
 * Throws `PodUnavailableError` if:
 *   - pod mode is not configured
 *   - no GPU is available and pod creation fails
 *   - FastAPI does not respond within POD_READY_TIMEOUT_MS
 *
 * Callers should catch `PodUnavailableError` and fall back to Serverless.
 *
 * Concurrent calls share the same in-flight promise — only one pod creation
 * attempt runs at a time within this process.
 */
export function ensurePodReady(): Promise<string> {
  if (_ensurePodReadyInFlight) {
    console.log("[pod] ensurePodReady déjà en cours — attente du résultat partagé");
    return _ensurePodReadyInFlight;
  }
  _ensurePodReadyInFlight = _ensurePodReadyImpl().finally(() => {
    _ensurePodReadyInFlight = null;
  });
  return _ensurePodReadyInFlight;
}

async function _ensurePodReadyImpl(): Promise<string> {
  if (!TEMPLATE_ID || !API_KEY) {
    throw new PodUnavailableError("Pod non configuré (RUNPOD_POD_TEMPLATE_ID manquant)");
  }

  const state = await getPodState();
  const currentPodId = state?.podId ?? null;

  // ── Handle "stopping" transitional state ────────────────────────────────────
  // "stopping" is set by maybeStopIdlePod CAS before calling RunPod stop API.
  // - If recently set (< 2min): the stop is in progress — dispatching to this
  //   pod would race the stop and lose the job. Throw so the caller falls back
  //   to Serverless instead.
  // - If stuck > 2min: the process crashed between CAS and setPodState("stopped").
  //   Recover by resetting to "stopped" and falling through to the restart path.
  if (state?.status === "stopping") {
    const stuckMs = Date.now() - state.updatedAt.getTime();
    if (stuckMs < 2 * 60_000) {
      throw new PodUnavailableError("Pod en cours d'arrêt — fallback Serverless");
    }
    console.warn(`[pod] Status "stopping" bloqué depuis ${Math.round(stuckMs / 60_000)}min — recovery`);
    await setPodState("stopped", null, currentPodId);
    // Fall through — currentPodId is still valid, the EXITED/create paths handle restart
  }

  // ── Fast path: DB says running and health check OK ──────────────────────────
  if (state?.status === "running" && state.podUrl && currentPodId) {
    if (await checkFastapiHealth(state.podUrl)) {
      console.log("[pod] Pod déjà running et health OK ✓");
      return state.podUrl;
    }
    console.warn("[pod] Pod marqué running en DB mais health échoué, re-vérification...");
  }

  // ── Try to use the existing pod ─────────────────────────────────────────────
  if (currentPodId) {
    try {
      const podInfo = await getRunpodPodInfo(currentPodId, API_KEY);

      if (podInfo.desiredStatus === "RUNNING") {
        const podUrl = buildPodFastapiUrl(currentPodId, FASTAPI_PORT);
        console.log("[pod] Pod RUNNING, attente FastAPI...");
        await waitForFastapiReady(podUrl, POD_RESTART_TIMEOUT_MS, currentPodId, API_KEY);
        await setPodState("running", podUrl, currentPodId);
        return podUrl;
      }

      if (podInfo.desiredStatus === "EXITED") {
        console.log(`[pod] Pod EXITED — démarrage du pod ${currentPodId}...`);
        await setPodState("starting", null, currentPodId);
        try {
          await startRunpodPod(currentPodId, API_KEY);
          const podUrl = buildPodFastapiUrl(currentPodId, FASTAPI_PORT);
          await waitForFastapiReady(podUrl, POD_RESTART_TIMEOUT_MS, currentPodId, API_KEY);
          await setPodState("running", podUrl, currentPodId);
          console.log(`[pod] Pod redémarré ✓ — ${podUrl}`);
          return podUrl;
        } catch (startErr) {
          console.warn(
            `[pod] Échec démarrage pod ${currentPodId} (GPU indisponible?) — création d'un nouveau pod:`,
            startErr
          );
          // Terminate orphan pod to avoid idle billing
          try {
            await terminateRunpodPod(currentPodId, API_KEY);
            console.log(`[pod] Ancien pod ${currentPodId} terminé`);
          } catch (termErr) {
            console.warn("[pod] Impossible de terminer l'ancien pod (à nettoyer manuellement):", termErr);
          }
        }
      }
      // TERMINATED or start failed — fall through to create new pod
    } catch (err) {
      console.warn(`[pod] Impossible de vérifier le pod ${currentPodId}:`, err);
    }
  }

  // ── Create a new pod from template ──────────────────────────────────────────
  console.log(`[pod] Création d'un nouveau pod depuis template ${TEMPLATE_ID}...`);
  await setPodState("starting", null, null);

  let newPodId: string;
  try {
    if (NETWORK_VOLUME_ID) {
      // Try with network volume first (models cached = faster init)
      try {
        newPodId = await createRunpodPod(TEMPLATE_ID, NETWORK_VOLUME_ID, PREFERRED_GPU_TYPES, API_KEY);
        console.log(`[pod] Nouveau pod créé avec volume réseau: ${newPodId}`);
      } catch (volumeErr) {
        // Volume can fail if no datacenter has both the volume AND an available GPU.
        // Retry without volume — slower init but works anywhere.
        console.warn("[pod] Création avec volume échouée, retry sans volume:", volumeErr);
        newPodId = await createRunpodPod(TEMPLATE_ID, null, PREFERRED_GPU_TYPES, API_KEY);
        console.log(`[pod] Nouveau pod créé sans volume réseau (fallback): ${newPodId}`);
      }
    } else {
      newPodId = await createRunpodPod(TEMPLATE_ID, null, PREFERRED_GPU_TYPES, API_KEY);
      console.log(`[pod] Nouveau pod créé: ${newPodId}`);
    }
  } catch (err) {
    await setPodState("stopped", null, null);
    throw new PodUnavailableError(`Impossible de créer un pod depuis le template: ${err}`);
  }

  const podUrl = buildPodFastapiUrl(newPodId, FASTAPI_PORT);
  // Save pod ID immediately so next requests can reuse it even if FastAPI isn't ready yet
  await setPodState("starting", null, newPodId);

  try {
    await waitForFastapiReady(podUrl, POD_CREATE_TIMEOUT_MS, newPodId, API_KEY);
  } catch (err) {
    // FastAPI never came up — stop the pod (don't terminate).
    // The Docker image stays cached on the GPU node so the next request can
    // restart this pod in ~30s instead of pulling the full image again.
    // Next ensurePodReady will find it EXITED and take the restart path.
    console.warn(`[pod] FastAPI timeout sur nouveau pod ${newPodId} — arrêt du pod (image conservée pour restart rapide)`);
    try {
      await stopRunpodPod(newPodId, API_KEY);
      console.log(`[pod] Pod ${newPodId} arrêté ✓ (image conservée)`);
    } catch (stopErr) {
      console.warn(`[pod] Impossible d'arrêter le pod ${newPodId}:`, stopErr);
    }
    // Preserve podId so next request restarts this pod instead of creating a new one
    await setPodState("stopped", null, newPodId);
    throw new PodUnavailableError(`FastAPI non joignable après création du pod ${newPodId}: ${err}`);
  }

  await setPodState("running", podUrl, newPodId);
  console.log(`[pod] Nouveau pod prêt ✓ — ${podUrl}`);
  return podUrl;
}

/**
 * Record that a job was dispatched to the pod.
 * Increments activeJobCount and resets the idle timer.
 */
export async function recordPodActivity(): Promise<void> {
  // A new job is starting — cancel any pending idle-stop timer so the pod
  // isn't stopped while a job is about to be dispatched.
  if (_idleStopTimer !== null) {
    clearTimeout(_idleStopTimer);
    _idleStopTimer = null;
  }
  try {
    await prisma.podState.upsert({
      where: { id: "singleton" },
      update: { lastJobAt: new Date(), activeJobCount: { increment: 1 } },
      create: {
        id: "singleton",
        status: "running",
        lastJobAt: new Date(),
        activeJobCount: 1,
      },
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Called when a pod-dispatched job webhook is received (completed or failed).
 * Decrements activeJobCount and triggers an idle-stop check.
 *
 * Safe to call for Serverless jobs too — it's a no-op when pod mode is off
 * or when activeJobCount is already 0.
 */
export async function onPodJobComplete(): Promise<void> {
  try {
    // Atomic decrement + update lastJobAt to completion time.
    // lastJobAt tracks "when was the last job completed" (not started), so that
    // the idle timer counts from the moment the pod became free, not from dispatch.
    await prisma.$executeRaw`
      UPDATE "PodState"
      SET "activeJobCount" = GREATEST(0, "activeJobCount" - 1),
          "lastJobAt" = NOW()
      WHERE id = 'singleton'
    `;
  } catch {
    // Non-fatal
  }
  // Immediate check: handles the case where the pod was already past the idle
  // threshold (e.g. a very long-running job, or stale counter recovery).
  await maybeStopIdlePod();

  // Single deferred timer — replaces any previous pending check so only one
  // timer is ever active at a time (avoids N timers accumulating over the day).
  if (_idleStopTimer !== null) clearTimeout(_idleStopTimer);
  const idleMs = IDLE_MINUTES * 60_000;
  _idleStopTimer = setTimeout(() => {
    _idleStopTimer = null;
    void maybeStopIdlePod();
  }, idleMs + 5_000);
}

/**
 * Check if the pod has been idle long enough and stop it if so.
 * Call this after each job completes (fire-and-forget).
 *
 * Also detects stale activeJobCount: if a job has been "in flight" for more
 * than STALE_JOB_HOURS hours, its webhook was permanently lost (network
 * failure, app restart, wrong NEXTAUTH_URL…). The counter is reset so the
 * idle-stop logic can proceed rather than blocking forever.
 */
export async function maybeStopIdlePod(): Promise<void> {
  if (!API_KEY) return;

  const state = await getPodState();
  if (!state || state.status !== "running" || !state.podId) return;
  // Extract podId once so TypeScript keeps the non-null narrowing even after
  // state is mutated or spread further down.
  const podId: string = state.podId;

  // ── Stale counter detection ────────────────────────────────────────────────
  // If activeJobCount > 0 but lastJobAt was more than STALE_JOB_HOURS ago,
  // the webhook was definitively lost — reset the counter and continue.
  if (state.activeJobCount > 0) {
    const lastJob = state.lastJobAt ?? state.updatedAt;
    const staleSince = Date.now() - lastJob.getTime();
    if (staleSince > STALE_JOB_HOURS * 3_600_000) {
      console.warn(
        `[pod] activeJobCount=${state.activeJobCount} depuis ` +
        `${Math.round(staleSince / 3_600_000 * 10) / 10}h — ` +
        `webhook définitivement perdu, remise à 0 du compteur`
      );
      await prisma.$executeRaw`
        UPDATE "PodState" SET "activeJobCount" = 0 WHERE id = 'singleton'
      `;
    } else {
      console.log(`[pod] ${state.activeJobCount} job(s) en cours — arrêt différé`);
      return;
    }
  }

  const idleMs = IDLE_MINUTES * 60_000;
  const lastJob = state.lastJobAt ?? state.updatedAt;
  const idleSince = Date.now() - lastJob.getTime();

  if (idleSince < idleMs) {
    console.log(`[pod] Pas encore idle (${Math.round(idleSince / 1000)}s / ${IDLE_MINUTES * 60}s)`);
    return;
  }

  console.log(`[pod] Pod idle depuis ${Math.round(idleSince / 60_000)} min — arrêt...`);
  // Atomic CAS: transition to "stopping" only when still "running" with no active jobs.
  // Prevents double-stop when two onPodJobComplete calls run concurrently.
  const acquired = await prisma.podState.updateMany({
    where: { id: "singleton", status: "running", activeJobCount: 0 },
    data: { status: "stopping", podUrl: null },
  });
  if (acquired.count === 0) {
    console.log("[pod] CAS arrêt échoué — état changé entre-temps, abandon");
    return;
  }

  try {
    await stopRunpodPod(podId, API_KEY);
    await setPodState("stopped", null, podId);
    console.log("[pod] Pod arrêté ✓");
  } catch (err) {
    console.error("[pod] Erreur lors de l'arrêt du pod:", err);
    // Revert so next idle check retries
    await setPodState("running", state.podUrl ?? null, podId);
  }
}

/**
 * Force-stop the pod on RunPod and reset DB state + activeJobCount.
 * Use from the admin panel when a webhook was lost and the pod is stuck running.
 * Preserves podId in DB so the next request restarts the same pod (fast restart).
 *
 * @returns The pod ID that was stopped (or null if no pod was configured).
 */
export async function forceStopPod(): Promise<{ podId: string | null }> {
  const state = await getPodState();
  const podId = state?.podId ?? null;

  if (podId && API_KEY) {
    try {
      await stopRunpodPod(podId, API_KEY);
      console.log(`[pod] Force-stop ✓ — pod ${podId}`);
    } catch (err) {
      // Log but continue — we still reset DB state so the next dispatch works.
      console.warn(`[pod] Force-stop RunPod API error (DB reset quand même):`, err);
    }
  }

  // setPodState("stopped") resets activeJobCount to 0 via the resetCount guard.
  await setPodState("stopped", null, podId);
  console.log("[pod] PodState réinitialisé (force-stop admin)");
  return { podId };
}

/**
 * Permanently terminate the pod on RunPod and wipe podId from DB.
 * Use when the pod has a stale Docker image and needs a full re-pull on next dispatch.
 * The next ensurePodReady will create a fresh pod from the template (pulling :latest).
 *
 * @returns The pod ID that was terminated (or null if no pod was configured).
 */
export async function forceTerminatePod(): Promise<{ podId: string | null }> {
  const state = await getPodState();
  const podId = state?.podId ?? null;

  if (podId && API_KEY) {
    try {
      await terminateRunpodPod(podId, API_KEY);
      console.log(`[pod] Force-terminate ✓ — pod ${podId} supprimé`);
    } catch (err) {
      console.warn(`[pod] Force-terminate RunPod API error (DB reset quand même):`, err);
    }
  }

  // Clear podId so next request creates a brand new pod (re-pulls :latest).
  await setPodState("stopped", null, null);
  console.log("[pod] PodState réinitialisé (force-terminate admin)");
  return { podId };
}

/**
 * Reset activeJobCount to 0 without touching the pod on RunPod.
 * Use when the counter is stuck but a real job is still running and you
 * do not want to interrupt it — only the counter is wrong.
 *
 * After reset, triggers an idle-stop check (non-blocking) — if the pod is
 * genuinely idle, it will stop on its own within IDLE_MINUTES.
 */
export async function resetPodJobCounter(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "PodState" SET "activeJobCount" = 0 WHERE id = 'singleton'
  `;
  console.log("[pod] Compteur de jobs remis à 0 (reset admin)");
  // Non-blocking: let idle-stop logic decide whether to stop.
  void maybeStopIdlePod();
}

// ─── PodUnavailableError ──────────────────────────────────────────────────────

export class PodUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PodUnavailableError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Poll health until FastAPI responds or deadline is reached.
 *
 * Phase-aware timeouts:
 * - While runtime=null (image pull / container init): keep waiting up to full timeoutMs.
 * - Once runtime≠null (container up): if FastAPI still silent after FASTAPI_INIT_TIMEOUT_MS
 *   from that moment, fail fast (something is wrong with the app, not the pull).
 * - If desiredStatus becomes EXITED/TERMINATED at any point: fail immediately.
 */
async function waitForFastapiReady(
  podUrl: string,
  timeoutMs: number,
  podId?: string,
  apiKey?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${podUrl}/health`;
  const STATUS_CHECK_EVERY = 3; // check pod status every 3 health polls (~12s)
  let pollCount = 0;
  let containerUpSince: number | null = null; // timestamp when runtime became non-null

  while (Date.now() < deadline) {
    await sleep(POD_POLL_INTERVAL_MS);
    pollCount++;

    // Check pod runtime status periodically
    if (podId && apiKey && pollCount % STATUS_CHECK_EVERY === 0) {
      try {
        const info = await getRunpodPodInfo(podId, apiKey);

        if (info.desiredStatus === "EXITED" || info.desiredStatus === "TERMINATED") {
          throw new PodUnavailableError(
            `Container en échec (status: ${info.desiredStatus}) — vérifier l'image Docker dans le template RunPod`
          );
        }

        if (info.runtime !== null && containerUpSince === null) {
          containerUpSince = Date.now();
          console.log(`[pod] Container up (uptime: ${info.runtime.uptimeInSeconds}s) — attente FastAPI...`);
        } else if (info.runtime === null) {
          const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
          console.log(`[pod] Image en cours de téléchargement... (${elapsed}s écoulées)`);
        }

        // Once container is up, apply a shorter deadline for FastAPI
        if (containerUpSince !== null) {
          const fastapiDeadline = containerUpSince + FASTAPI_INIT_TIMEOUT_MS;
          if (Date.now() > fastapiDeadline) {
            throw new PodUnavailableError(
              `FastAPI non joignable ${FASTAPI_INIT_TIMEOUT_MS / 1000}s après démarrage du container — vérifier les logs du pod`
            );
          }
        }
      } catch (err) {
        if (err instanceof PodUnavailableError) throw err;
        // Network error on status check — ignore, continue polling health
      }
    }

    const ok = await checkFastapiHealth(podUrl);
    if (ok) {
      console.log(`[pod] FastAPI health check OK ✓ (${healthUrl})`);
      return;
    }

    if (containerUpSince !== null) {
      const waitingSince = Math.round((Date.now() - containerUpSince) / 1000);
      console.log(`[pod] Container up mais FastAPI pas encore prête (${waitingSince}s)...`);
    } else {
      console.log(`[pod] FastAPI pas encore prête — image en cours de téléchargement...`);
    }
  }

  throw new PodUnavailableError(`FastAPI non joignable après ${timeoutMs / 1000}s — ${healthUrl}`);
}

async function checkFastapiHealth(podUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${podUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FASTAPI_HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getPodState() {
  try {
    return await prisma.podState.findUnique({ where: { id: "singleton" } });
  } catch {
    return null;
  }
}

async function setPodState(
  status: "stopped" | "starting" | "running" | "stopping",
  podUrl: string | null,
  podId: string | null
): Promise<void> {
  try {
    // Reset activeJobCount when transitioning to a clean state.
    // Recovers from stuck counters caused by crashed jobs or missed webhooks.
    const resetCount = status === "stopped" || status === "starting";
    await prisma.podState.upsert({
      where: { id: "singleton" },
      update: {
        status, podUrl, podId, updatedAt: new Date(),
        ...(resetCount ? { activeJobCount: 0 } : {}),
      },
      create: { id: "singleton", status, podUrl, podId },
    });
  } catch (err) {
    console.warn("[pod] Impossible de persister PodState:", err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

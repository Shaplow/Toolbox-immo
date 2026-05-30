/**
 * Server-side in-memory pub/sub for SSE connections.
 *
 * Safe for single-process deployments (ecosystem.config.js: instances: 1).
 * Each authenticated user can hold multiple concurrent connections (tabs).
 */

export type JobEventPayload = {
  jobType: "captions" | "transcription" | "render" | "media-edit" | "media-autocut" | "cover" | "description";
  jobId: string;
  status: string;
  [key: string]: unknown;
};

type SseController = ReadableStreamDefaultController<Uint8Array>;

// Map<userId, Set<controller>>
const store = new Map<string, Set<SseController>>();
const encoder = new TextEncoder();

export function addSseConnection(userId: string, controller: SseController): void {
  let set = store.get(userId);
  if (!set) {
    set = new Set();
    store.set(userId, set);
  }
  set.add(controller);
}

export function removeSseConnection(userId: string, controller: SseController): void {
  const set = store.get(userId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) store.delete(userId);
}

/**
 * Push a job event to all active SSE connections for this user.
 * Stale controllers (client disconnected) are pruned automatically.
 */
export function notifyUser(userId: string, event: JobEventPayload): void {
  const controllers = store.get(userId);
  if (!controllers?.size) return;

  const frame = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  for (const controller of controllers) {
    try {
      controller.enqueue(frame);
    } catch {
      // Controller is closed — prune stale entry
      controllers.delete(controller);
    }
  }

  if (controllers.size === 0) store.delete(userId);
}

/**
 * Broadcast un event SSE à toutes les connexions actives, tous users confondus.
 * Utilisé pour les jobs sans userId trackable (ex. MediaAutocutBatch admin-tool).
 * À utiliser avec parcimonie — préférer notifyUser quand l'userId est connu.
 */
export function notifyAll(event: JobEventPayload): void {
  const frame = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  for (const [userId, controllers] of store.entries()) {
    for (const controller of controllers) {
      try {
        controller.enqueue(frame);
      } catch {
        controllers.delete(controller);
      }
    }
    if (controllers.size === 0) store.delete(userId);
  }
}

/**
 * GET /api/events/jobs
 *
 * Server-Sent Events endpoint. Opens a long-lived stream scoped to the
 * authenticated user. The server pushes a job event whenever a RunPod
 * webhook completes or fails a job (captions, transcription).
 *
 * The `X-Accel-Buffering: no` header disables nginx proxy buffering so
 * events are delivered immediately without waiting for a buffer flush.
 *
 * The connection auto-reconnects — EventSource handles it natively on
 * the client side. A keepalive comment is sent every 25 s to prevent
 * the proxy from timing out the idle connection.
 */

import { NextRequest } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { addSseConnection, removeSseConnection } from "@/lib/sseStore";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = userContext.effectiveUser.id;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      addSseConnection(userId, controller);

      // Confirm connection with a comment (not dispatched as a message event)
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } catch { /* ignore */ }

      // Keepalive every 25 s — below nginx default proxy_read_timeout of 60 s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 25_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        removeSseConnection(userId, controller);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      // Tell nginx not to buffer this response — essential for SSE
      "X-Accel-Buffering": "no",
    },
  });
}

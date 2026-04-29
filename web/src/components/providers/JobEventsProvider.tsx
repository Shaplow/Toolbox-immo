"use client";

import { useEffect } from "react";
import { dispatchJobEvent, type JobEventPayload } from "@/lib/hooks/jobEventBus";

/**
 * Opens a single SSE connection to /api/events/jobs for the authenticated user.
 * Dispatches all received events to the module-level jobBus so any component
 * can subscribe via useJobEvent / useAllJobEvents without duplicating the connection.
 *
 * Mount once inside the authenticated app layout (app/(app)/layout.tsx).
 * EventSource auto-reconnects on transient errors — no manual retry needed.
 */
export function JobEventsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const es = new EventSource("/api/events/jobs");

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as JobEventPayload;
        dispatchJobEvent(event);
      } catch {
        // Ignore malformed events (e.g. keepalive comments don't trigger onmessage)
      }
    };

    // EventSource handles reconnection automatically on network errors
    return () => es.close();
  }, []);

  return <>{children}</>;
}

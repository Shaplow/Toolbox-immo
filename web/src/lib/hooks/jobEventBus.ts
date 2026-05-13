"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Client-side module-level event bus for SSE job events.
 *
 * Uses a native EventTarget instead of React Context to avoid re-rendering
 * the whole component tree on every incoming event. Each component subscribes
 * to the events it cares about via useJobEvent / useAllJobEvents.
 *
 * JobEventsProvider calls dispatchJobEvent() when the EventSource receives a
 * message. Components react to specific jobIds or all job events.
 */

export type JobEventPayload = {
  jobType: "captions" | "transcription" | "derush" | "derush_export" | "render" | "media-edit";
  jobId: string;
  status: string;
  [key: string]: unknown;
};

type JobDomEvent = Event & { detail: JobEventPayload };

// Module-level singleton — shared across all components in the same tab
const jobBus = typeof window !== "undefined" ? new EventTarget() : null;

/** Called by JobEventsProvider when the EventSource receives a message. */
export function dispatchJobEvent(event: JobEventPayload): void {
  if (!jobBus) return;
  const e = new Event("job") as JobDomEvent;
  e.detail = event;
  jobBus.dispatchEvent(e);
}

/**
 * Subscribe to SSE events for a specific job ID.
 * Returns the latest event payload for that job, or null if none received yet.
 */
export function useJobEvent(jobId: string): JobEventPayload | null {
  const [event, setEvent] = useState<JobEventPayload | null>(null);

  useEffect(() => {
    if (!jobBus) return;

    const handler = (e: Event) => {
      const payload = (e as JobDomEvent).detail;
      if (payload.jobId === jobId) setEvent(payload);
    };

    jobBus.addEventListener("job", handler);
    return () => jobBus.removeEventListener("job", handler);
  }, [jobId]);

  return event;
}

/**
 * Subscribe to all SSE job events.
 * The callback is stable-ref'd — it is never re-subscribed on re-renders,
 * so you can safely use an inline arrow function.
 */
export function useAllJobEvents(callback: (event: JobEventPayload) => void): void {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (!jobBus) return;

    const handler = (e: Event) => {
      callbackRef.current((e as JobDomEvent).detail);
    };

    jobBus.addEventListener("job", handler);
    return () => jobBus.removeEventListener("job", handler);
  }, []);
}

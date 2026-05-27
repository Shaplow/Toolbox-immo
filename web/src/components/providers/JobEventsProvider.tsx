"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { dispatchJobEvent, type JobEventPayload } from "@/lib/hooks/jobEventBus";

/**
 * Routes qui consomment réellement des jobs en temps réel (renders, covers,
 * captions, transcriptions, descriptions). Les pages admin pures (clients,
 * libraries, users, fonts, prompts) n'ont pas besoin d'ouvrir un SSE.
 */
const PIPELINE_PATH_PREFIXES = [
  "/home",
  "/calendar",
  "/publications",
  "/generate",
  "/renders",
  "/listings",
  "/captions",
  "/transcriptions",
  "/descriptions",
];

function shouldOpenJobEvents(pathname: string | null): boolean {
  if (!pathname) return false;
  return PIPELINE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function JobEventsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldSubscribe = shouldOpenJobEvents(pathname);

  useEffect(() => {
    if (!shouldSubscribe) return;

    const es = new EventSource("/api/events/jobs");

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as JobEventPayload;
        dispatchJobEvent(event);
      } catch {
        // Ignore malformed events (e.g. keepalive comments don't trigger onmessage)
      }
    };

    return () => es.close();
  }, [shouldSubscribe]);

  return <>{children}</>;
}

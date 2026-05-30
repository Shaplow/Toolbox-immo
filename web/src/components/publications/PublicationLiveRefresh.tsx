"use client";

/**
 * PublicationLiveRefresh — composant invisible qui écoute les events SSE
 * via le bus jobEvent et déclenche un router.refresh() côté fiche dès qu'un
 * job lié au slot change d'état.
 *
 * Sans ce composant, l'utilisateur devait F5 pour voir l'avancement du
 * pipeline (render, captions, transcription, description, cover). Maintenant
 * la fiche se met à jour automatiquement quand :
 *  - un job déjà connu (renderId, captionJobId, descriptionJobId, coverPackId)
 *    change de status,
 *  - OU un job d'un type attendu apparaît (captions/description auto créés
 *    par le pipeline post-validation sans qu'on ait encore leur ID).
 *
 * Le composant ne rend rien (return null). Il sert juste à attacher un
 * abonnement au bus côté client.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAllJobEvents } from "@/lib/hooks/jobEventBus";

interface Props {
  /** IDs des jobs déjà connus côté serveur — refresh sur tout event matchant. */
  knownJobIds: Array<string | null | undefined>;
  /** Types de jobs attendus (e.g. ["captions", "description"]) pour lesquels
   *  on accepte un event "nouveau job" et déclenche un refresh. */
  expectedJobTypes: Array<"captions" | "transcription" | "render" | "media-edit" | "cover" | "description">;
}

export function PublicationLiveRefresh({ knownJobIds, expectedJobTypes }: Props) {
  const router = useRouter();
  // Throttle pour ne pas spammer router.refresh() si plusieurs events arrivent
  // dans la même fenêtre (e.g. transcription COMPLETED + caption QUEUED instantané).
  const lastRefreshRef = useRef(0);
  const MIN_REFRESH_INTERVAL_MS = 500;

  const knownSet = new Set(knownJobIds.filter((id): id is string => !!id));
  const expectedSet = new Set(expectedJobTypes);

  useAllJobEvents((evt) => {
    const isKnown = knownSet.has(evt.jobId);
    const isExpectedType = expectedSet.has(evt.jobType);
    if (!isKnown && !isExpectedType) return;

    const now = Date.now();
    if (now - lastRefreshRef.current < MIN_REFRESH_INTERVAL_MS) return;
    lastRefreshRef.current = now;
    router.refresh();
  });

  // Pas de UI — purement comportemental.
  useEffect(() => {
    return () => { lastRefreshRef.current = 0; };
  }, []);

  return null;
}

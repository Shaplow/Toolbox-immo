"use client";

/**
 * Une session de téléchargement vue depuis la page : lancement du moteur,
 * progression, arrêt, bilan envoyé à l'admin.
 *
 * Le moteur n'a aucune notion d'écran : la page lui prête un AbortSignal, un
 * relais vers l'API publique pour signer les URLs, et reçoit en retour des
 * instantanés de progression (≤ 4 par seconde, objets neufs à chaque fois) et
 * un `EngineResult`. Il ne rejette jamais : toute issue se lit dans `reason`.
 */

import { useEffect, useRef, useState } from "react";
import {
  LinkGoneError,
  runDownload,
  type EngineProgress,
  type EngineResult,
} from "@/lib/clientExport/downloadEngine";
import type { ExportManifest } from "@/lib/clientExport/types";
import { signUrls, startSessionEvents, type SessionEvents } from "./exportApi";
import { EMPTY_REPORT, reportFromProgress, smoothRate } from "./exportModel";

export type RunView =
  | { kind: "idle" }
  | {
      kind: "running";
      /** null jusqu'au premier instantané du moteur. */
      progress: EngineProgress | null;
      /** Débit lissé (octets/s), null tant qu'aucun instantané n'est arrivé. */
      rate: number | null;
      /** Arrêt demandé, le moteur referme proprement les fichiers en cours. */
      stopping: boolean;
      /** Le serveur ne répond plus : les appels sont relancés tout seuls. */
      connectionIssue: boolean;
    }
  | { kind: "finished"; result: EngineResult }
  /** Garde-fou : le moteur a levé une erreur qu'il aurait dû convertir en résultat. */
  | { kind: "crashed"; message: string };

export function useExportRun(token: string, manifest: ExportManifest) {
  const [view, setView] = useState<RunView>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const latestProgressRef = useRef<EngineProgress | null>(null);
  const rateRef = useRef<number | null>(null);

  // Quitter la page pendant un téléchargement l'arrête proprement : le fichier
  // en cours est abandonné, jamais laissé à moitié écrit.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  function setConnectionIssue(connectionIssue: boolean) {
    // Même objet renvoyé quand rien ne change : pas de rendu à chaque lot d'URLs.
    setView((current) =>
      current.kind === "running" && current.connectionIssue !== connectionIssue
        ? { ...current, connectionIssue }
        : current,
    );
  }

  function finish(result: EngineResult, events: SessionEvents) {
    setView({ kind: "finished", result });
    // Un lien révoqué ne peut plus recevoir de bilan.
    if (result.reason === "link_gone") return;
    void events.finish({ type: result.reason === "done" ? "completed" : "stopped", ...result.report });
  }

  /** Lance (ou relance) le téléchargement dans `root`. Ne rejette jamais. */
  async function start(root: FileSystemDirectoryHandle): Promise<void> {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    latestProgressRef.current = null;
    rateRef.current = null;
    setView({ kind: "running", progress: null, rate: null, stopping: false, connectionIssue: false });
    // Chaque lancement compte, reprises comprises : l'admin voit combien de fois le client a dû relancer.
    // Le bilan final de cette session passe par `events` : il ne part jamais avant ce « started ».
    const events = startSessionEvents(token, { type: "started", ...EMPTY_REPORT });

    try {
      const result = await runDownload({
        root,
        files: manifest.files,
        signal: controller.signal,
        signUrls: async (refs) => {
          const response = await signUrls(token, refs, {
            signal: controller.signal,
            onRetry: () => setConnectionIssue(true),
          });
          setConnectionIssue(false);
          return response;
        },
        onProgress: (progress) => {
          latestProgressRef.current = progress;
          const rate = smoothRate(rateRef.current, progress.bytesPerSecond);
          rateRef.current = rate;
          setView((current) => (current.kind === "running" ? { ...current, progress, rate } : current));
        },
      });
      finish(result, events);
    } catch (error) {
      const partial = reportFromProgress(latestProgressRef.current);
      if (error instanceof LinkGoneError) {
        finish({ reason: "link_gone", report: partial, failures: [], missing: [] }, events);
      } else {
        const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
        setView({ kind: "crashed", message: `Le téléchargement s'est arrêté de façon inattendue${detail}.` });
        void events.finish({ type: "stopped", ...partial });
      }
    } finally {
      controllerRef.current = null;
    }
  }

  /** « Arrêter » : le moteur répond `aborted` une fois ses écritures refermées. */
  function stop() {
    const controller = controllerRef.current;
    if (!controller) return;
    setView((current) => (current.kind === "running" ? { ...current, stopping: true } : current));
    controller.abort();
  }

  return { view, start, stop };
}

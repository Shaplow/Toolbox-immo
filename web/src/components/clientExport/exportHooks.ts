"use client";

/**
 * Hooks de la page publique /export/[token] : prise en charge du navigateur,
 * chargement du manifeste, dossier mémorisé, et les deux garde-fous d'un
 * téléchargement long (écran qui ne s'éteint pas, avertissement à la fermeture).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { LinkGoneError } from "@/lib/clientExport/downloadEngine";
import { clearRootHandle, loadRootHandle } from "@/lib/clientExport/handleStore";
import type { ExportManifest } from "@/lib/clientExport/types";
import { ExportApiError, fetchManifest } from "./exportApi";
import { isExportBrowserSupported } from "./exportModel";

// ─── Prise en charge du navigateur ───────────────────────────────────────────

export type BrowserSupport = "checking" | "supported" | "unsupported";

function subscribeNever(): () => void {
  return () => {};
}

function readSupport(): BrowserSupport {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const supported = isExportBrowserSupported({
    hasDirectoryPicker: typeof window.showDirectoryPicker === "function",
    userAgent: nav.userAgent,
    uaDataMobile: nav.userAgentData?.mobile,
  });
  return supported ? "supported" : "unsupported";
}

/** Rendu serveur : le navigateur du visiteur n'est pas connu, on ne tranche pas. */
function readServerSupport(): BrowserSupport {
  return "checking";
}

/**
 * `useSyncExternalStore` plutôt qu'un effet : le premier rendu client reprend
 * l'instantané serveur (« checking », pas d'écart d'hydratation), puis bascule
 * aussitôt sur la vraie réponse sans passer par un setState dans un effet.
 */
export function useBrowserSupport(): BrowserSupport {
  return useSyncExternalStore(subscribeNever, readSupport, readServerSupport);
}

// ─── Manifeste ───────────────────────────────────────────────────────────────

export type ManifestState =
  | {
      kind: "loading";
      /** Au moins un essai a échoué : le serveur est lent ou en cours de déploiement. */
      slow: boolean;
    }
  | { kind: "ready"; manifest: ExportManifest }
  /** 404 : lien révoqué ou expiré depuis l'ouverture de la page. */
  | { kind: "gone" }
  | { kind: "error"; message: string };

/**
 * Charge le manifeste une fois le navigateur validé : sur Safari ou mobile, la
 * liste (qui peut prendre plusieurs secondes à calculer) ne servirait à rien.
 */
export function useExportManifest(token: string, enabled: boolean) {
  const [state, setState] = useState<ManifestState>({ kind: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchManifest(token, {
      signal: controller.signal,
      onRetry: () => setState((current) => (current.kind === "loading" ? { kind: "loading", slow: true } : current)),
    }).then(
      (manifest) => setState({ kind: "ready", manifest }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof LinkGoneError) {
          setState({ kind: "gone" });
          return;
        }
        setState({
          kind: "error",
          // Seuls nos propres messages (français, destinés au visiteur) sont montrés tels quels.
          message: error instanceof ExportApiError ? error.message : "Une erreur inattendue est survenue.",
        });
      },
    );
    return () => controller.abort();
  }, [token, enabled, attempt]);

  function reload() {
    setState({ kind: "loading", slow: false });
    setAttempt((n) => n + 1);
  }

  return { state, reload };
}

// ─── Dossier mémorisé ────────────────────────────────────────────────────────

/**
 * Dossier choisi lors d'une visite précédente (IndexedDB), pour proposer
 * « Reprendre » après un rechargement, un onglet déchargé ou un autre jour.
 */
export function useSavedRoot(linkId: string) {
  const [savedRoot, setSavedRoot] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRootHandle(linkId).then(
      (handle) => {
        if (!cancelled) setSavedRoot(handle);
      },
      () => {
        // IndexedDB indisponible (navigation privée…) : pas de « Reprendre », le choix du dossier reste possible.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [linkId]);

  /** Dossier supprimé ou déplacé : on cesse de le proposer. */
  function forgetSavedRoot() {
    setSavedRoot(null);
    clearRootHandle(linkId).catch(() => {});
  }

  return { savedRoot, forgetSavedRoot };
}

// ─── Garde-fous d'un téléchargement long ─────────────────────────────────────

/**
 * Empêche l'écran de s'éteindre pendant le téléchargement. Le navigateur
 * relâche le verrou dès que l'onglet est masqué : on le redemande au retour.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    let acquiring = false;

    async function acquire() {
      if (disposed || acquiring || sentinel) return;
      acquiring = true;
      try {
        const lock = await navigator.wakeLock?.request("screen");
        if (!lock) return;
        if (disposed) {
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener("release", () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        // Refusé (économie d'énergie, onglet masqué) : le téléchargement continue, l'écran pourra s'éteindre.
      } finally {
        acquiring = false;
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const lock = sentinel;
      sentinel = null;
      lock?.release().catch(() => {});
    };
  }, [active]);
}

/** Avertit avant de fermer ou recharger la page tant qu'un téléchargement tourne. */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Requis par certains navigateurs pour afficher la confirmation.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

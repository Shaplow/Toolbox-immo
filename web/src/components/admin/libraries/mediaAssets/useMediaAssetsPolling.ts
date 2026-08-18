"use client";

/**
 * useMediaAssetsPolling — poll léger des jobs d'édition asset (spinner sur
 * la card en cours de traitement) + fetch du badge « jobs autocut à
 * valider ». Extrait de MediaAssetsPanel (split C1-v2).
 *
 * Le poll des jobs actifs tourne en continu (interval 5s) mais ne fait un
 * fetch réseau que si au moins un asset a un `pendingEditJob` (hasPendingRef)
 * — évite un appel inutile à chaque montage du panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { MediaAsset } from "./types";

interface UseMediaAssetsPollingParams {
  libraryId: string;
  libraryType: "video" | "audio";
  /** Sans droits assets, l'atelier « Analyse auto » n'est pas rendu — inutile
   *  d'aller chercher son badge (la route est de toute façon gatée côté API). */
  canManageAssets: boolean;
  /** Rejoue le fetch du badge à chaque fermeture de l'atelier (l'admin peut
   *  y avoir validé/passé des jobs). */
  showAtelier: boolean;
  assets: MediaAsset[];
  setAssets: Dispatch<SetStateAction<MediaAsset[]>>;
}

interface UseMediaAssetsPollingResult {
  /** F2.3 — count des jobs autocut en attente de review (badge « Analyse auto »). */
  autocutPendingCount: number;
}

export function useMediaAssetsPolling({
  libraryId,
  libraryType,
  canManageAssets,
  showAtelier,
  assets,
  setAssets,
}: UseMediaAssetsPollingParams): UseMediaAssetsPollingResult {
  const hasPendingRef = useRef(false);

  useEffect(() => {
    hasPendingRef.current = assets.some((a) => a.pendingEditJob !== null);
  }, [assets]);

  /**
   * Met à jour silencieusement les champs qui changent en arrière-plan
   * (pendingEditJob, url, duration) sans toucher loading ni réinitialiser le scroll.
   *
   * L'endpoint retourne deux groupes :
   * - Jobs actifs (pending/processing) : mise à jour du statut/url/duration
   * - Jobs récemment terminés (done/failed < 120s) : vidage du pendingEditJob + url/duration frais
   * Aucun rechargement complet n'est déclenché.
   */
  const silentPoll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/active-jobs`);
      if (!res.ok) return;
      type ActiveJobEntry = {
        id: string;
        url: string;
        duration: number | null;
        pendingEditJob: { id: string; status: string } | null;
        recentlyCompleted: boolean;
      };
      const entries = (await res.json()) as ActiveJobEntry[];
      const activeMap = new Map(entries.filter((e) => !e.recentlyCompleted).map((e) => [e.id, e]));
      const completedMap = new Map(entries.filter((e) => e.recentlyCompleted).map((e) => [e.id, e]));

      setAssets((prev) => {
        let changed = false;
        const next = prev.map((a) => {
          if (!a.pendingEditJob) return a; // pas de job connu — rien à faire
          const active = activeMap.get(a.id);
          const completed = completedMap.get(a.id);
          if (active) {
            // Job toujours en cours — mettre à jour si quelque chose a changé
            if (
              active.pendingEditJob?.id === a.pendingEditJob?.id &&
              active.pendingEditJob?.status === a.pendingEditJob?.status &&
              active.url === a.url &&
              active.duration === a.duration
            ) return a;
            changed = true;
            return { ...a, pendingEditJob: active.pendingEditJob, url: active.url, duration: active.duration };
          } else if (completed) {
            // Job venant de se terminer — url/duration déjà mis à jour par le worker
            changed = true;
            return { ...a, pendingEditJob: null, url: completed.url, duration: completed.duration };
          } else {
            // Job terminé il y a > 120s (cas limite) — vider le spinner, garder l'url courante
            changed = true;
            return { ...a, pendingEditJob: null };
          }
        });
        return changed ? next : prev;
      });
    } catch {
      // silencieux — le poll ne doit pas perturber l'UI
    }
  }, [libraryId, setAssets]);

  // Poll toutes les 5s — tourne en continu, ne fait rien si aucun job actif (hasPendingRef)
  useEffect(() => {
    const timer = setInterval(() => { if (hasPendingRef.current) void silentPoll(); }, 5000);
    return () => clearInterval(timer);
  }, [silentPoll]);

  // F2.3 — Fetch le count des jobs autocut en attente de review (badge sur
  // "Analyse auto"). Refresh à chaque fermeture de l'atelier. Pas de fetch
  // pour les bibliothèques audio (pas d'autocut).
  const [autocutPendingCount, setAutocutPendingCount] = useState(0);
  useEffect(() => {
    if (libraryType !== "video") return;
    if (!canManageAssets) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/libraries/media/${libraryId}/autocut-queue?reviewStatus=pending_review&pageSize=1&lean=1`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { total?: number };
        if (!cancelled) setAutocutPendingCount(data.total ?? 0);
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, [libraryId, libraryType, showAtelier, canManageAssets]);

  return { autocutPendingCount };
}

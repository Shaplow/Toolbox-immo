"use client";

/**
 * useAssetSequence — gère le seqState (ordre personnalisé des setTags
 * dans la rotation) + les helpers (move/add/remove + persist).
 *
 * Phase D9-step6 du split C1-v2 (plan F1). Hook utility pour le panel —
 * sortie en bloc { seqState, saveSequence, moveSetTag, addToSequence,
 * removeFromSequence } pour passage aux vues Rotation / Grouped /
 * GroupColumn.
 *
 * La séquence est persistée côté serveur via PATCH
 * /api/admin/libraries/media/{libraryId} body { setSequence }. La
 * mise à jour locale est optimiste (setSeqState avant le fetch).
 */

import { useState } from "react";
import { toast } from "@/components/ui/Toast";
import { useMediaLibraryPermissions } from "./mediaLibraryPermissions";

interface UseAssetSequenceParams {
  libraryId: string;
  /** Sérialisation initiale depuis library.setSequence (JSON string[]) */
  initialSequence: string;
}

export interface UseAssetSequenceResult {
  seqState: string[];
  saveSequence: (newSeq: string[]) => Promise<void>;
  moveSetTag: (tag: string, direction: -1 | 1) => void;
  addToSequence: (tag: string) => void;
  removeFromSequence: (tag: string) => void;
}

export function useAssetSequence({
  libraryId,
  initialSequence,
}: UseAssetSequenceParams): UseAssetSequenceResult {
  const [seqState, setSeqState] = useState<string[]>(() => {
    try { return JSON.parse(initialSequence) as string[]; } catch { return []; }
  });

  // La séquence est une propriété de la BIBLIOTHÈQUE (PATCH media/[id], gaté
  // `canManageMediaLibraries`) et non des assets — d'où `canManageLibraries`
  // ici et non `canManageAssets`. Un VIDEASTE gère les assets mais ne réordonne
  // pas la rotation : sans cette garde, son état local partirait en avant d'un
  // 403 et afficherait un ordre que le serveur n'a jamais accepté.
  const { canManageLibraries } = useMediaLibraryPermissions();

  async function saveSequence(newSeq: string[]) {
    if (!canManageLibraries) {
      toast.error("Réservé aux administrateurs");
      return;
    }
    setSeqState(newSeq);
    await fetch(`/api/admin/libraries/media/${libraryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setSequence: newSeq }),
    });
  }

  function moveSetTag(tag: string, direction: -1 | 1) {
    const idx = seqState.indexOf(tag);
    if (idx === -1) return;
    const next = [...seqState];
    const target = idx + direction;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    void saveSequence(next);
  }

  function addToSequence(tag: string) {
    if (seqState.includes(tag)) return;
    void saveSequence([...seqState, tag]);
  }

  function removeFromSequence(tag: string) {
    void saveSequence(seqState.filter((t) => t !== tag));
  }

  return { seqState, saveSequence, moveSetTag, addToSequence, removeFromSequence };
}

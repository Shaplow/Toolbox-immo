"use client";

/**
 * useBulkEditDataEntries — état + handlers pour la sélection multiple et les
 * actions bulk (add account, remove_all) sur les DataEntry.
 *
 * Mirror fonctionnel de useBulkEdit (mediaAssets/) : accès comptes + bulk
 * Set / catégorie (handleBulkApplyFields). Les tags ne sont pas gérés en bulk
 * côté data (pas de champ tags sur DataEntry).
 *
 * Le hook isole l'état de sélection + les handlers async qui appellent
 * POST /api/admin/libraries/data/campaigns/[campaignId]/entries/bulk.
 * Après chaque mutation, refetch via `reload` (callback passé par le panel).
 */

import { useCallback, useState } from "react";
import { toast } from "@/components/ui/Toast";
import type { InstagramAccount } from "@/components/admin/libraries/DataEntriesPanel";

interface UseBulkEditDataEntriesArgs {
  campaignId: string;
  /** Liste des comptes IG disponibles — pour afficher le @handle dans les toasts. */
  accounts: InstagramAccount[];
  /** Callback pour refetch les entries après mutation. */
  reload: () => void;
}

export interface UseBulkEditDataEntriesResult {
  // State sélection
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  // Actions
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  // Bulk apply
  bulkApplying: boolean;
  handleBulkApplyAccess: (action: "add" | "remove_all", accountId?: string) => Promise<void>;
  /** Bulk Set / catégorie : valeur vide ("") → null (efface le champ). */
  handleBulkApplyFields: (patch: { setTag?: string | null; category?: string | null }) => Promise<void>;
}

export function useBulkEditDataEntries({
  campaignId,
  accounts,
  reload,
}: UseBulkEditDataEntriesArgs): UseBulkEditDataEntriesResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkApplyAccess = useCallback(
    async (action: "add" | "remove_all", accountId?: string) => {
      if (selectedIds.size === 0) return;
      setBulkApplying(true);

      const body: Record<string, unknown> = {
        entryIds: Array.from(selectedIds),
        accessAction: action,
      };
      if (accountId) body.accountId = accountId;

      try {
        const res = await fetch(
          `/api/admin/libraries/data/campaigns/${campaignId}/entries/bulk`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(d.error ?? "Erreur lors de l'opération");
          return;
        }

        const d = await res.json() as { updated: number };

        if (action === "add" && accountId) {
          const acc = accounts.find((a) => a.id === accountId);
          toast.success(`Accès ajouté : @${acc?.handle ?? accountId} (${selectedIds.size} fiche${selectedIds.size > 1 ? "s" : ""})`);
        } else {
          toast.success(`Accès réinitialisé (global) — ${d.updated} ligne${d.updated !== 1 ? "s" : ""} retirée${d.updated !== 1 ? "s" : ""}`);
        }

        // Garde la sélection pour permettre d'enchaîner plusieurs bulk
        // (ex: ajouter accès compte A puis compte B sur les mêmes lignes).
        // L'user peut clearSelection manuellement via "Tout désélectionner".
        reload();
      } catch {
        toast.error("Erreur réseau — opération annulée");
      } finally {
        setBulkApplying(false);
      }
    },
    [accounts, campaignId, reload, selectedIds],
  );

  const handleBulkApplyFields = useCallback(
    async (patch: { setTag?: string | null; category?: string | null }) => {
      if (selectedIds.size === 0) return;
      if (patch.setTag === undefined && patch.category === undefined) return;
      setBulkApplying(true);
      try {
        const res = await fetch(
          `/api/admin/libraries/data/campaigns/${campaignId}/entries/bulk`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entryIds: Array.from(selectedIds),
              ...patch,
            }),
          },
        );
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(d.error ?? "Erreur lors de l'opération");
          return;
        }
        const d = (await res.json()) as { updated: number };
        const label =
          patch.setTag !== undefined && patch.category !== undefined
            ? "Set + catégorie"
            : patch.setTag !== undefined
              ? "Set"
              : "Catégorie";
        toast.success(
          `${label} appliqué — ${d.updated} fiche${d.updated !== 1 ? "s" : ""}`,
        );
        reload();
      } catch {
        toast.error("Erreur réseau — opération annulée");
      } finally {
        setBulkApplying(false);
      }
    },
    [campaignId, reload, selectedIds],
  );

  return {
    selectedIds,
    setSelectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    bulkApplying,
    handleBulkApplyAccess,
    handleBulkApplyFields,
  };
}

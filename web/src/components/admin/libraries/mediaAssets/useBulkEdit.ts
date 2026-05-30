"use client";

/**
 * useBulkEdit — état + handlers pour la sélection multiple et les actions
 * bulk (apply pack/setTag, tags, category, access, delete) sur les MediaAsset.
 *
 * Phase D4 (plan §19). Le hook isole 8 useState + 6 handlers async qui
 * appellent /api/admin/libraries/media/[id]/assets/bulk. Après chaque
 * mutation, met à jour le state local via le `setAssets` passé par le
 * parent (qui vient lui-même de useMediaAssetsLoader).
 *
 * Les 5 handlers async retournent void et signalent leur état via
 * bulkApplying / bulkError / bulkSuccess (auto-clear après 2.5s).
 */

import { useCallback, useState } from "react";
import type { MediaAsset, InstagramAccount } from "./types";

/**
 * Fonction de confirmation asynchrone fournie par le composant parent
 * (via `useConfirm()`). Permet de garder le hook découplé de l'UI tout en
 * remplaçant les `window.confirm()` natifs par un `ConfirmDialog` stylé.
 */
export type ConfirmFn = (options: {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
}) => Promise<boolean>;

interface UseBulkEditArgs {
  libraryId: string;
  setAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  /** Pour afficher le @handle dans le toast après bulk apply access. */
  accounts: InstagramAccount[];
  /** Confirmation asynchrone (cf. useConfirm hook). */
  confirm: ConfirmFn;
}

export interface UseBulkEditResult {
  // State
  selectMode: boolean;
  setSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  bulkSetTagInput: string;
  setBulkSetTagInput: React.Dispatch<React.SetStateAction<string>>;
  bulkTagsInput: string;
  setBulkTagsInput: React.Dispatch<React.SetStateAction<string>>;
  bulkCategoryInput: string;
  setBulkCategoryInput: React.Dispatch<React.SetStateAction<string>>;
  bulkApplying: boolean;
  bulkError: string | null;
  bulkSuccess: string | null;
  // Actions
  toggleSelect: (id: string) => void;
  exitSelectMode: () => void;
  handleBulkApplySetTag: () => Promise<void>;
  handleBulkApplyTags: () => Promise<void>;
  handleBulkApplyAccess: (action: "add" | "remove_all", accountId?: string) => Promise<void>;
  handleBulkApplyCategory: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;
}

export function useBulkEdit({ libraryId, setAssets, accounts, confirm }: UseBulkEditArgs): UseBulkEditResult {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSetTagInput, setBulkSetTagInput] = useState("");
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [bulkCategoryInput, setBulkCategoryInput] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Phase D — auto-active selectMode dès qu'au moins 1 asset est sélectionné,
      // pour que la BulkActionBar s'affiche sans toggle manuel. exitSelectMode()
      // remet à false + clear.
      if (next.size > 0) setSelectMode(true);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkSetTagInput("");
    setBulkTagsInput("");
    setBulkError(null);
  }, []);

  const handleBulkApplySetTag = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const value = bulkSetTagInput.trim() || null;
    setBulkApplying(true);
    setBulkError(null);
    setBulkSuccess(null);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), setTag: value }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, setTag: value } : a)));
    setBulkSuccess(value ? `Pack « ${value} » appliqué` : "Pack retiré");
    setTimeout(() => setBulkSuccess(null), 2500);
  }, [bulkSetTagInput, libraryId, selectedIds, setAssets]);

  const handleBulkApplyTags = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const newTags = bulkTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    setBulkApplying(true);
    setBulkError(null);
    setBulkSuccess(null);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), tags: newTags }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, tags: newTags } : a)));
    setBulkSuccess(newTags.length > 0 ? "Tags appliqués" : "Tags retirés");
    setTimeout(() => setBulkSuccess(null), 2500);
  }, [bulkTagsInput, libraryId, selectedIds, setAssets]);

  const handleBulkApplyAccess = useCallback(
    async (action: "add" | "remove_all", accountId?: string) => {
      if (selectedIds.size === 0) return;
      setBulkApplying(true);
      setBulkError(null);
      setBulkSuccess(null);
      const body: Record<string, unknown> = { assetIds: Array.from(selectedIds), accessAction: action };
      if (accountId) body.accountId = accountId;
      const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setBulkApplying(false);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setBulkError(d.error ?? "Erreur lors de l'application");
        return;
      }
      if (action === "add" && accountId) {
        setAssets((prev) =>
          prev.map((a) =>
            selectedIds.has(a.id)
              ? { ...a, accessAccountIds: Array.from(new Set([...a.accessAccountIds, accountId])) }
              : a,
          ),
        );
        const acc = accounts.find((a) => a.id === accountId);
        setBulkSuccess(`Accès ajouté : @${acc?.handle ?? accountId}`);
      } else {
        setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, accessAccountIds: [] } : a)));
        setBulkSuccess("Accès réinitialisé (global)");
      }
      setTimeout(() => setBulkSuccess(null), 2500);
    },
    [accounts, libraryId, selectedIds, setAssets],
  );

  const handleBulkApplyCategory = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const value = bulkCategoryInput.trim() || null;
    setBulkApplying(true);
    setBulkError(null);
    setBulkSuccess(null);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), category: value }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, category: value } : a)));
    setBulkSuccess(value ? `Catégorie « ${value} » appliquée` : "Catégorie retirée");
    setTimeout(() => setBulkSuccess(null), 2500);
  }, [bulkCategoryInput, libraryId, selectedIds, setAssets]);

  const handleBulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    const ok = await confirm({
      title: `Supprimer ${count} asset${count > 1 ? "s" : ""} ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    setBulkApplying(true);
    setBulkError(null);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds) }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setAssets((prev) => prev.filter((a) => !selectedIds.has(a.id)));
    exitSelectMode();
  }, [exitSelectMode, libraryId, selectedIds, setAssets, confirm]);

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    bulkSetTagInput,
    setBulkSetTagInput,
    bulkTagsInput,
    setBulkTagsInput,
    bulkCategoryInput,
    setBulkCategoryInput,
    bulkApplying,
    bulkError,
    bulkSuccess,
    toggleSelect,
    exitSelectMode,
    handleBulkApplySetTag,
    handleBulkApplyTags,
    handleBulkApplyAccess,
    handleBulkApplyCategory,
    handleBulkDelete,
  };
}

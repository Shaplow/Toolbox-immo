"use client";

/**
 * useBulkEdit — état + handlers pour la sélection multiple et les actions
 * bulk (apply dossier/setTag, tags, access, delete) sur les MediaAsset.
 *
 * Phase D4 (plan §19). Le hook isole les useState + handlers async qui
 * appellent /api/admin/libraries/media/[id]/assets/bulk. Après chaque
 * mutation, met à jour le state local via le `setAssets` passé par le
 * parent (qui vient lui-même de useMediaAssetsLoader).
 *
 * Les handlers async retournent void et signalent leur état via
 * bulkApplying + toast.success/error (cohérence Coastal Studio).
 */

import { useCallback, useState } from "react";
import type { MediaAsset, InstagramAccount } from "./types";
import { toast } from "@/components/ui/Toast";
import { useMediaLibraryReadOnly } from "./mediaLibraryPermissions";

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
  /** Liste courante — sert à écarter les assets désactivés d'une relance d'analyse. */
  assets: MediaAsset[];
  setAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  /** Pour afficher le @handle dans le toast après bulk apply access. */
  accounts: InstagramAccount[];
  /** Confirmation asynchrone (cf. useConfirm hook). */
  confirm: ConfirmFn;
  /** Appelé après une relance d'analyse acceptée par l'API — rejoue le fetch du
   *  badge « Analyse auto » (des analyses à valider ont pu être remplacées). */
  onAutocutRelaunched?: () => void | Promise<void>;
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
  bulkApplying: boolean;
  // Actions
  toggleSelect: (id: string) => void;
  exitSelectMode: () => void;
  handleBulkApplySetTag: () => Promise<void>;
  handleBulkApplyTags: () => Promise<void>;
  handleBulkApplyAccess: (action: "add" | "remove_all", accountId?: string) => Promise<void>;
  handleBulkDelete: () => Promise<void>;
  handleBulkRelaunchAutocut: () => Promise<void>;
}

export function useBulkEdit({
  libraryId,
  assets,
  setAssets,
  accounts,
  confirm,
  onAutocutRelaunched,
}: UseBulkEditArgs): UseBulkEditResult {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSetTagInput, setBulkSetTagInput] = useState("");
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);

  // Garde lecture seule — cf. `useAssetInlineEdits`. Le mode sélection reste
  // ouvert (il porte le téléchargement en lot), seules les mutations tombent.
  const readOnly = useMediaLibraryReadOnly();
  const blocked = useCallback((): boolean => {
    if (!readOnly) return false;
    toast.error("Médiathèque en lecture seule");
    return true;
  }, [readOnly]);
  // W4.5 : bulkError/bulkSuccess state remplacé par toast.error/success — la
  // UI feedback est désormais cohérente avec le reste du design system (Toast
  // overlay) au lieu de rendus inline ad-hoc dans la BulkActionBar.

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
    
  }, []);

  const handleBulkApplySetTag = useCallback(async () => {
    if (blocked()) return;
    if (selectedIds.size === 0) return;
    const value = bulkSetTagInput.trim() || null;
    setBulkApplying(true);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), setTag: value }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, setTag: value } : a)));
    toast.success(value ? `Pack « ${value} » appliqué` : "Pack retiré");
  }, [blocked, bulkSetTagInput, libraryId, selectedIds, setAssets]);

  const handleBulkApplyTags = useCallback(async () => {
    if (blocked()) return;
    if (selectedIds.size === 0) return;
    const newTags = bulkTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    setBulkApplying(true);
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), tags: newTags }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, tags: newTags } : a)));
    toast.success(newTags.length > 0 ? "Tags appliqués" : "Tags retirés");
  }, [blocked, bulkTagsInput, libraryId, selectedIds, setAssets]);

  const handleBulkApplyAccess = useCallback(
    async (action: "add" | "remove_all", accountId?: string) => {
      if (blocked()) return;
      if (selectedIds.size === 0) return;
      setBulkApplying(true);
      
      
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
        toast.error(d.error ?? "Erreur lors de l'application");
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
        toast.success(`Accès ajouté : @${acc?.handle ?? accountId}`);
      } else {
        setAssets((prev) => prev.map((a) => (selectedIds.has(a.id) ? { ...a, accessAccountIds: [] } : a)));
        toast.success("Accès réinitialisé (global)");
      }
    },
    [blocked, accounts, libraryId, selectedIds, setAssets],
  );

  const handleBulkDelete = useCallback(async () => {
    if (blocked()) return;
    const count = selectedIds.size;
    const ok = await confirm({
      title: `Supprimer ${count} asset${count > 1 ? "s" : ""} ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    setBulkApplying(true);
    
    const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds) }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setAssets((prev) => prev.filter((a) => !selectedIds.has(a.id)));
    exitSelectMode();
  }, [blocked, exitSelectMode, libraryId, selectedIds, setAssets, confirm]);

  /**
   * Relance forcée de l'analyse auto (autocut) sur la sélection.
   *
   * L'atelier « Analyse auto » ne propose que les assets sans analyse ou en
   * échec — une fois coupé, un média n'y est plus cochable. Ce chemin est la
   * porte de sortie : `force` remplace aussi les analyses à valider, validées ou
   * déjà appliquées. Le trim étant destructif, une relance sur un média coupé
   * analyse le fichier actuel, pas l'original.
   *
   * Les assets désactivés sont écartés ici (l'API les refuse en 403 pour tout le
   * lot) ; ceux dont un traitement tourne sont ignorés par l'API et remontés dans
   * `skipped`.
   */
  const handleBulkRelaunchAutocut = useCallback(async () => {
    if (blocked()) return;
    if (selectedIds.size === 0) return;
    const eligible = assets.filter((a) => selectedIds.has(a.id) && !a.disabled);
    const disabledCount = assets.filter((a) => selectedIds.has(a.id) && a.disabled).length;
    if (eligible.length === 0) {
      toast.error("Aucun média actif dans la sélection");
      return;
    }
    const n = eligible.length;
    const ok = await confirm({
      title: `Relancer l'analyse sur ${n} média${n > 1 ? "s" : ""} ?`,
      description:
        "Les analyses existantes de ces médias (à valider, validées ou déjà appliquées) sont remplacées par une nouvelle analyse. " +
        "Les fichiers déjà coupés ne sont pas modifiés : l'analyse repart du fichier actuel. " +
        "Les médias en cours de traitement sont ignorés.",
      confirmLabel: "Relancer",
    });
    if (!ok) return;
    setBulkApplying(true);
    let res: Response;
    try {
      res = await fetch(`/api/admin/libraries/media/${libraryId}/autocut-packs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: eligible.map((a) => a.id), force: true }),
      });
    } catch {
      setBulkApplying(false);
      toast.error("Erreur réseau lors de la relance de l'analyse");
      return;
    }
    setBulkApplying(false);
    const data = (await res.json().catch(() => ({}))) as { skipped?: string[]; error?: string };
    if (!res.ok) {
      toast.error(data.error ?? "Erreur lors de la relance de l'analyse");
      return;
    }
    const skipped = data.skipped?.length ?? 0;
    const launched = Math.max(0, n - skipped);
    const parts: string[] = [
      launched > 0
        ? `Analyse relancée sur ${launched} média${launched > 1 ? "s" : ""}`
        : "Aucune analyse relancée",
    ];
    if (skipped > 0) parts.push(`${skipped} ignoré${skipped > 1 ? "s" : ""} (traitement en cours)`);
    if (disabledCount > 0) {
      parts.push(`${disabledCount} désactivé${disabledCount > 1 ? "s" : ""} ignoré${disabledCount > 1 ? "s" : ""}`);
    }
    if (launched > 0) toast.success(parts.join(" · "));
    else toast.info(parts.join(" · "));
    void onAutocutRelaunched?.();
    exitSelectMode();
  }, [blocked, assets, selectedIds, confirm, libraryId, onAutocutRelaunched, exitSelectMode]);

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    bulkSetTagInput,
    setBulkSetTagInput,
    bulkTagsInput,
    setBulkTagsInput,
    bulkApplying,
    toggleSelect,
    exitSelectMode,
    handleBulkApplySetTag,
    handleBulkApplyTags,
    handleBulkApplyAccess,
    handleBulkDelete,
    handleBulkRelaunchAutocut,
  };
}

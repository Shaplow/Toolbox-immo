"use client";

/**
 * useAssetInlineEdits — regroupe tous les states et handlers d'inline
 * editing d'un MediaAsset (setTag, category, tags, usage, lastUsedAt,
 * metadata, access, disabled, delete) pour éviter de propager 30+ props
 * à chaque sous-composant de MediaAssetsPanel.
 *
 * Phase D9 du split C1-v2 (plan §19 / nouveau plan F1). Le hook est
 * consommé par le panel parent qui en récupère un objet plat et le
 * destructure ou le passe en bloc aux cards (VideoCard, AudioList,
 * GroupColumn, CompactCard).
 *
 * Convention : chaque "champ" éditable a 2 states (editing target id +
 * input value) sauf metadata qui utilise un objet { assetId, key }. Les
 * setters portent le nom React standard (setEditingXxxId / setXxxInput).
 *
 * Les handlers gardent leur signature historique (asset, value) et
 * encapsulent : optimistic update via setAssets + fetch PATCH + clear
 * du state d'inline edit en cas de succès.
 */

import { useState } from "react";
import { toast } from "@/components/ui/Toast";
import type { Dispatch, SetStateAction } from "react";
import type { MediaAsset, MetadataField } from "./types";

/** Confirmation asynchrone fournie par le composant parent (via `useConfirm`). */
export type ConfirmFn = (options: {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
}) => Promise<boolean>;

interface UseAssetInlineEditsParams {
  libraryId: string;
  setAssets: Dispatch<SetStateAction<MediaAsset[]>>;
  accountFilter: string | null;
  metadataSchema: MetadataField[];
  confirm: ConfirmFn;
}

export interface UseAssetInlineEditsResult {
  // setTag inline edit
  editingSetTagId: string | null;
  setEditingSetTagId: Dispatch<SetStateAction<string | null>>;
  setTagValue: string;
  setSetTagValue: Dispatch<SetStateAction<string>>;
  setTagError: string | null;
  setSetTagError: Dispatch<SetStateAction<string | null>>;
  // category (family) inline edit
  editingFamilyKey: string | null;
  setEditingFamilyKey: Dispatch<SetStateAction<string | null>>;
  familyInput: string;
  setFamilyInput: Dispatch<SetStateAction<string>>;
  // tags inline edit
  editingTagsId: string | null;
  setEditingTagsId: Dispatch<SetStateAction<string | null>>;
  tagInput: string;
  setTagInput: Dispatch<SetStateAction<string>>;
  // usage inline edit
  editingUsageId: string | null;
  setEditingUsageId: Dispatch<SetStateAction<string | null>>;
  usageInput: string;
  setUsageInput: Dispatch<SetStateAction<string>>;
  // lastUsed inline edit
  editingLastUsedId: string | null;
  setEditingLastUsedId: Dispatch<SetStateAction<string | null>>;
  lastUsedInput: string;
  setLastUsedInput: Dispatch<SetStateAction<string>>;
  // metadata inline edit
  editingMetaKey: { assetId: string; key: string } | null;
  setEditingMetaKey: Dispatch<SetStateAction<{ assetId: string; key: string } | null>>;
  metaInput: string;
  setMetaInput: Dispatch<SetStateAction<string>>;
  savedMetaFlash: { assetId: string; key: string } | null;
  metaSaveError: { assetId: string; key: string } | null;
  // misc
  resetError: string | null;
  setResetError: Dispatch<SetStateAction<string | null>>;
  // handlers
  handleSaveCategory: (asset: MediaAsset, value: string) => Promise<void>;
  handleSaveCategoryForGroup: (groupAssets: MediaAsset[], value: string) => Promise<void>;
  handleToggleAccess: (asset: MediaAsset, accountId: string, addAccess: boolean) => Promise<void>;
  handleToggleDisabled: (asset: MediaAsset) => Promise<void>;
  handleSaveMetadata: (asset: MediaAsset, key: string, value: string) => Promise<void>;
  handleSaveUsage: (asset: MediaAsset, raw: string) => Promise<void>;
  handleResetAssetUsage: (asset: MediaAsset) => Promise<void>;
  handleSaveTags: (asset: MediaAsset, newTags: string[]) => Promise<void>;
  handleSaveSetTag: (asset: MediaAsset, raw: string) => Promise<void>;
  handleSaveLastUsed: (asset: MediaAsset, dateStr: string) => Promise<void>;
  handleDelete: (asset: MediaAsset) => Promise<void>;
  toDateInputValue: (iso: string | null) => string;
}

export function useAssetInlineEdits({
  libraryId,
  setAssets,
  accountFilter,
  metadataSchema,
  confirm,
}: UseAssetInlineEditsParams): UseAssetInlineEditsResult {
  // ── States ────────────────────────────────────────────────────────────
  const [editingSetTagId, setEditingSetTagId] = useState<string | null>(null);
  const [setTagValue, setSetTagValue] = useState("");
  const [setTagError, setSetTagError] = useState<string | null>(null);
  const [editingFamilyKey, setEditingFamilyKey] = useState<string | null>(null);
  const [familyInput, setFamilyInput] = useState("");
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [editingUsageId, setEditingUsageId] = useState<string | null>(null);
  const [usageInput, setUsageInput] = useState("");
  const [editingLastUsedId, setEditingLastUsedId] = useState<string | null>(null);
  const [lastUsedInput, setLastUsedInput] = useState("");
  const [editingMetaKey, setEditingMetaKey] = useState<{ assetId: string; key: string } | null>(null);
  const [metaInput, setMetaInput] = useState("");
  const [savedMetaFlash, setSavedMetaFlash] = useState<{ assetId: string; key: string } | null>(null);
  const [metaSaveError, setMetaSaveError] = useState<{ assetId: string; key: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────
  async function handleSaveCategory(asset: MediaAsset, categoryValue: string) {
    const val = categoryValue.trim() || null;
    await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: val }),
    });
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, category: val } : a));
  }

  async function handleSaveCategoryForGroup(groupAssets: MediaAsset[], categoryValue: string) {
    const val = categoryValue.trim() || null;
    await Promise.all(
      groupAssets.map((a) =>
        fetch(`/api/admin/libraries/media/assets/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: val }),
        })
      )
    );
    setAssets((prev) => prev.map((a) => groupAssets.some((g) => g.id === a.id) ? { ...a, category: val } : a));
  }

  async function handleToggleAccess(asset: MediaAsset, accountId: string, addAccess: boolean) {
    const current = asset.accessAccountIds;
    const next = addAccess
      ? [...current, accountId]
      : current.filter((id) => id !== accountId);
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessAccountIds: next }),
    });
    if (!res.ok) return;
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, accessAccountIds: next } : a));
  }

  async function handleToggleDisabled(asset: MediaAsset) {
    const next = !asset.disabled;
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: next }),
    });
    if (!res.ok) return;
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, disabled: next } : a));
  }

  async function handleSaveMetadata(asset: MediaAsset, key: string, value: string) {
    setEditingMetaKey(null);
    const currentMeta = asset.metadata ?? {};
    const schemaField = metadataSchema.find((f) => f.key === key);
    const parsed: string | number | null = value.trim() === ""
      ? null
      : schemaField?.type === "number" ? (Number.isFinite(Number(value)) ? Number(value) : null) : value.trim();
    const nextMeta = { ...currentMeta, [key]: parsed };
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, metadata: nextMeta } : a));
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: nextMeta }),
    });
    if (res.ok) {
      setSavedMetaFlash({ assetId: asset.id, key });
      setTimeout(() => setSavedMetaFlash(null), 1200);
    } else {
      setMetaSaveError({ assetId: asset.id, key });
      setTimeout(() => setMetaSaveError(null), 3000);
      setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, metadata: currentMeta } : a));
    }
  }

  async function handleSaveUsage(asset: MediaAsset, raw: string) {
    const val = parseInt(raw, 10);
    setEditingUsageId(null);
    setUsageInput("");
    if (isNaN(val) || val < 0 || val === asset.usageCount) return;
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usageCount: val }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors de la mise à jour");
      return;
    }
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, usageCount: val, lastUsedAt: val === 0 ? null : new Date().toISOString() } : a));
  }

  async function handleResetAssetUsage(asset: MediaAsset) {
    const body = accountFilter
      ? { resetUsageForAccount: accountFilter }
      : { resetUsage: true };
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
      return;
    }
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, usageCount: 0, lastUsedAt: null } : a));
  }

  async function handleSaveTags(asset: MediaAsset, newTags: string[]) {
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: newTags }),
    });
    if (!res.ok) return;
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, tags: newTags } : a));
    setEditingTagsId(null);
    setTagInput("");
  }

  async function handleSaveSetTag(asset: MediaAsset, raw: string) {
    const value = raw.trim() || null;
    if (value === (asset.setTag ?? null)) {
      setEditingSetTagId(null);
      setSetTagValue("");
      return;
    }
    setSetTagError(null);
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setTag: value }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setSetTagError(d.error ?? "Erreur lors de la sauvegarde");
      return;
    }
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, setTag: value } : a));
    setEditingSetTagId(null);
    setSetTagValue("");
    setSetTagError(null);
  }

  async function handleSaveLastUsed(asset: MediaAsset, dateStr: string) {
    setEditingLastUsedId(null);
    setLastUsedInput("");
    const lastUsedAt = dateStr ? new Date(dateStr).toISOString() : null;
    if (lastUsedAt === asset.lastUsedAt) return;
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastUsedAt }),
    });
    if (!res.ok) return;
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, lastUsedAt } : a));
  }

  async function handleDelete(asset: MediaAsset) {
    const ok = await confirm({
      title: `Supprimer « ${asset.filename} » ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
  }

  function toDateInputValue(iso: string | null): string {
    if (!iso) return "";
    return new Date(iso).toISOString().split("T")[0] ?? "";
  }

  // libraryId est utilisé indirectement via les URLs des handlers ci-dessus
  // (encore conservé comme paramètre pour la lisibilité — même si en l'état
  // les routes admin n'ont pas besoin du libraryId dans l'URL).
  void libraryId;

  return {
    editingSetTagId, setEditingSetTagId,
    setTagValue, setSetTagValue,
    setTagError, setSetTagError,
    editingFamilyKey, setEditingFamilyKey,
    familyInput, setFamilyInput,
    editingTagsId, setEditingTagsId,
    tagInput, setTagInput,
    editingUsageId, setEditingUsageId,
    usageInput, setUsageInput,
    editingLastUsedId, setEditingLastUsedId,
    lastUsedInput, setLastUsedInput,
    editingMetaKey, setEditingMetaKey,
    metaInput, setMetaInput,
    savedMetaFlash, metaSaveError,
    resetError, setResetError,
    handleSaveCategory,
    handleSaveCategoryForGroup,
    handleToggleAccess,
    handleToggleDisabled,
    handleSaveMetadata,
    handleSaveUsage,
    handleResetAssetUsage,
    handleSaveTags,
    handleSaveSetTag,
    handleSaveLastUsed,
    handleDelete,
    toDateInputValue,
  };
}

"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Trash2, Upload, Clock, BarChart2, Search, Play, Music2, ArrowUpDown, CheckCircle2, Tag, X, RotateCcw, Scissors, LayoutGrid, Layers, Square, CheckSquare, ChevronUp, ChevronDown, ListOrdered, PlusCircle, MinusCircle, FolderOpen, Film, Globe, Lock, Users } from "lucide-react";
import { MediaAssetEditModal } from "./MediaAssetEditModal";

interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  duration: number | null;
  tags: string[];
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  accessAccountIds: string[];
}

interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
}

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  setSequence: string; // JSON string[]
}

interface Props {
  library: MediaLibrary;
}

function formatDuration(s: number | null): string {
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(d: string | null): string {
  if (!d) return "Jamais";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

type SortKey = "date_desc" | "date_asc" | "usage_desc" | "usage_asc" | "name_asc";

export function MediaAssetsPanel({ library }: Props) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [tagFilter, setTagFilter] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [editingUsageId, setEditingUsageId] = useState<string | null>(null);
  const [usageInput, setUsageInput] = useState("");
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [editingSetTagId, setEditingSetTagId] = useState<string | null>(null);
  const [setTagValue, setSetTagValue] = useState("");
  const [setTagError, setSetTagError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "grouped" | "rotation">("grid");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSetTagInput, setBulkSetTagInput] = useState("");
  const [bulkTagsInput, setBulkTagsInput] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [editingLastUsedId, setEditingLastUsedId] = useState<string | null>(null);
  const [lastUsedInput, setLastUsedInput] = useState("");
  const [seqState, setSeqState] = useState<string[]>(() => {
    try { return JSON.parse(library.setSequence) as string[]; } catch { return []; }
  });
  const [editingFamilyKey, setEditingFamilyKey] = useState<string | null>(null);
  const [familyInput, setFamilyInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = accountFilter
        ? `/api/admin/libraries/media/${library.id}/assets?accountId=${encodeURIComponent(accountFilter)}`
        : `/api/admin/libraries/media/${library.id}/assets`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as (Omit<MediaAsset, "tags" | "accessAccountIds"> & { tags: string; accessAccountIds?: string[] })[]
      const data: MediaAsset[] = raw.map((a) => ({
        ...a,
        setTag: (a as unknown as { setTag?: string | null }).setTag ?? null,
        category: (a as unknown as { category?: string | null }).category ?? null,
        tags: (() => { try { return JSON.parse(a.tags) as string[]; } catch { return []; } })(),
        accessAccountIds: a.accessAccountIds ?? [],
      }));
      setAssets(data);
    } catch (err) {
      console.error("[MediaAssetsPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [library.id, accountFilter]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  // Load accounts list for access management and account filter
  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: unknown) => setAccounts(data as InstagramAccount[]))
      .catch(() => {});
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [assets]);

  const allSetTags = useMemo(() => {
    const s = new Set<string>();
    assets.forEach((a) => { if (a.setTag) s.add(a.setTag); });
    return Array.from(s).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    let list = assets;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.filename.toLowerCase().includes(q));
    }
    if (tagFilter) {
      list = list.filter((a) => a.tags.includes(tagFilter));
    }
    return [...list].sort((a, b) => {
      switch (sort) {
        case "date_asc":    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "usage_desc":  return b.usageCount - a.usageCount;
        case "usage_asc":   return a.usageCount - b.usageCount;
        case "name_asc":    return a.filename.localeCompare(b.filename);
        case "date_desc":
        default:            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [assets, search, sort, tagFilter]);

  // Composite key helpers
  const toGroupKey = (category: string | null, setTag: string | null) =>
    `${category ?? ""}\u00a7\u00a7${setTag ?? ""}`;
  const fromGroupKey = (k: string) => {
    const idx = k.indexOf("\u00a7\u00a7");
    const cat = k.slice(0, idx) || null;
    const st = k.slice(idx + 2) || null;
    return { category: cat, setTag: st };
  };

  const groupedBySetTag = useMemo(() => {
    const groups = new Map<string, MediaAsset[]>();
    filtered.forEach((a) => {
      const key = toGroupKey(a.category, a.setTag);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    });

    // Only use assets accessible to the filtered account when computing last-used date.
    // Without this, inaccessible assets (restricted to other accounts) can skew group ordering.
    const getLastUsed = (groupAssets: MediaAsset[]) => {
      const pool = accountFilter
        ? groupAssets.filter((a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
        : groupAssets;
      return pool.reduce<string | null>((max, a) => {
        if (!a.lastUsedAt) return max;
        if (!max) return a.lastUsedAt;
        return a.lastUsedAt > max ? a.lastUsedAt : max;
      }, null);
    };

    type GroupItem = { key: string; setTag: string | null; category: string | null; groupAssets: MediaAsset[]; accessibleCount: number; lastUsed: string | null; autoRank: number | null; isAccessible: boolean };
    const isAutoMode = seqState.length === 0;

    const allEntries: GroupItem[] = Array.from(groups.entries()).map(([key, groupAssets]) => {
      const { category, setTag } = fromGroupKey(key);
      // Accessible when no accountFilter, or at least one asset is global / allows this account
      const isAccessible = !accountFilter || groupAssets.some(
        (a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter)
      );
      const accessibleCount = accountFilter
        ? groupAssets.filter((a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter)).length
        : groupAssets.length;
      return { key, setTag, category, groupAssets, accessibleCount, lastUsed: getLastUsed(groupAssets), autoRank: null, isAccessible };
    });

    const named = allEntries.filter((g) => g.setTag || g.category);
    const unnamed = allEntries.filter((g) => !g.setTag && !g.category);

    if (isAutoMode) {
      // Simulate rotation: only accessible groups participate in ranking
      const accessibleNamed = accountFilter ? named.filter((g) => g.isAccessible) : named;
      const inaccessibleNamed = accountFilter ? named.filter((g) => !g.isAccessible) : [];
      const byAge = [...accessibleNamed].sort((a, b) => {
        if (!a.lastUsed && b.lastUsed) return -1;
        if (a.lastUsed && !b.lastUsed) return 1;
        if (a.lastUsed && b.lastUsed && a.lastUsed !== b.lastUsed)
          return a.lastUsed < b.lastUsed ? -1 : 1;
        return (a.setTag ?? "").localeCompare(b.setTag ?? "");
      });
      const ordered: GroupItem[] = [];
      let remaining = [...byAge];
      let lastCategory: string | null = null;
      while (remaining.length > 0) {
        let eligible: GroupItem[] = lastCategory ? remaining.filter((g) => g.category !== lastCategory) : remaining;
        if (eligible.length === 0) eligible = remaining;
        const pick: GroupItem = eligible[0]!;
        ordered.push({ ...pick, autoRank: ordered.length + 1 });
        lastCategory = pick.category;
        remaining = remaining.filter((g) => g.key !== pick.key);
      }
      return [...ordered, ...inaccessibleNamed, ...unnamed];
    } else {
      // Override mode: accessible groups first (in seqState order), inaccessible at end
      const sortFn = ({ setTag: ka }: GroupItem, { setTag: kb }: GroupItem): number => {
        if (!ka && !kb) return 0;
        if (!ka) return 1;
        if (!kb) return -1;
        const ia = seqState.indexOf(ka);
        const ib = seqState.indexOf(kb);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return ka.localeCompare(kb);
      };
      if (accountFilter) {
        const accessible = named.filter((g) => g.isAccessible).sort(sortFn);
        const inaccessible = named.filter((g) => !g.isAccessible).sort(sortFn);
        return [...accessible, ...inaccessible, ...unnamed];
      }
      return [...named.sort(sortFn), ...unnamed];
    }
  }, [filtered, seqState, accountFilter]);

  const sectionsByGroup = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, typeof groupedBySetTag>();
    const unassigned: typeof groupedBySetTag = [];
    for (const g of groupedBySetTag) {
      const cat = g.category;
      if (!cat) { unassigned.push(g); continue; } // no category → can't belong to a named section
      if (!map.has(cat)) { map.set(cat, []); order.push(cat); }
      map.get(cat)!.push(g);
    }
    return {
      sections: order.map((name) => ({ name, groups: map.get(name)! })),
      unassigned,
      hasGroups: order.length > 0,
    };
  }, [groupedBySetTag]);

  async function saveSequence(newSeq: string[]) {
    setSeqState(newSeq);
    await fetch(`/api/admin/libraries/media/${library.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setSequence: newSeq }),
    });
  }

  async function handleSaveCategory(asset: MediaAsset, categoryValue: string) {
    const val = categoryValue.trim() || null;
    await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: val }),
    });
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, category: val } : a));
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
    // When a per-account filter is active, reset only that account's usage record.
    // When viewing globally, perform a full reset (global counters + all per-account records).
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
    // Skip if unchanged (null == null, or same string)
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkSetTagInput("");
    setBulkTagsInput("");
    setBulkError(null);
  }

  async function handleBulkApplySetTag() {
    if (selectedIds.size === 0) return;
    const value = bulkSetTagInput.trim() || null;
    setBulkApplying(true);
    setBulkError(null);
    const res = await fetch(`/api/admin/libraries/media/${library.id}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), setTag: value }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => selectedIds.has(a.id) ? { ...a, setTag: value } : a));
    exitSelectMode();
  }

  async function handleBulkApplyTags() {
    if (selectedIds.size === 0) return;
    const newTags = bulkTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    if (newTags.length === 0) { setBulkError("Entrez au moins un tag"); return; }
    setBulkApplying(true);
    setBulkError(null);
    const res = await fetch(`/api/admin/libraries/media/${library.id}/assets/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: Array.from(selectedIds), tags: newTags }),
    });
    setBulkApplying(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      setBulkError(d.error ?? "Erreur lors de l'application");
      return;
    }
    setAssets((prev) => prev.map((a) => selectedIds.has(a.id) ? { ...a, tags: newTags } : a));
    exitSelectMode();
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

  function toDateInputValue(iso: string | null): string {
    if (!iso) return "";
    return new Date(iso).toISOString().split("T")[0] ?? "";
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    setUploadProgress(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const presignRes = await fetch(`/api/admin/libraries/media/${library.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      if (!presignRes.ok) {
        const d = await presignRes.json() as { error?: string };
        setUploadError(d.error ?? "Erreur lors de la préparation de l'upload");
        setUploading(false);
        return;
      }
      const { uploadUrl } = await presignRes.json() as { uploadUrl: string; assetId: string };

      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            const filePercent = ev.loaded / ev.total;
            const overall = Math.round(((i + filePercent) / files.length) * 100);
            setUploadProgress(overall);
          }
        });
        xhr.addEventListener("load", () => resolve(xhr.status >= 200 && xhr.status < 300));
        xhr.addEventListener("error", () => resolve(false));
        xhr.send(file);
      });

      if (!ok) {
        setUploadError(`Échec de l'upload : ${file.name}`);
        setUploading(false);
        return;
      }
    }

    setUploadSuccess(`${files.length} fichier${files.length > 1 ? "s" : ""} uploadé${files.length > 1 ? "s" : ""}`);
    setUploadProgress(null);
    setUploading(false);
    void load();
    setTimeout(() => setUploadSuccess(null), 3000);
  }

  async function handleDelete(asset: MediaAsset) {
    if (!confirm(`Supprimer "${asset.filename}" ?`)) return;
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  const isVideo = library.type === "video";

  // Compact single-row card used inside grouped/rotation views
  function renderCompactCard(asset: MediaAsset, opts: { hideCategory?: boolean } = {}): React.ReactNode {
    const isSelected = selectedIds.has(asset.id);
    // Dim assets that are not accessible to the currently filtered account
    const isAssetAccessible = !accountFilter ||
      asset.accessAccountIds.length === 0 ||
      asset.accessAccountIds.includes(accountFilter);
    return (
      <div
        key={asset.id}
        className={`group flex items-center gap-2 bg-white rounded-lg border px-2 py-1.5 transition-colors ${
          !isAssetAccessible ? "opacity-50" : ""
        } ${
          selectMode && isSelected ? "border-indigo-400 ring-1 ring-indigo-200" : "border-gray-200 hover:border-indigo-300"
        }`}
        onClick={() => { if (selectMode) toggleSelect(asset.id); }}
      >
        {/* Tiny thumbnail */}
        <div className="relative w-8 h-12 rounded overflow-hidden shrink-0 bg-gray-100">
          <video src={`${asset.url}#t=0.5`} muted preload="metadata" className="w-full h-full object-cover" />
          {selectMode && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              {isSelected ? <CheckSquare size={12} className="text-white" /> : <Square size={12} className="text-white/70" />}
            </div>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          {/* breadcrumb pills — category hidden when inSection */}
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            {!opts.hideCategory && (
              editingFamilyKey === asset.id ? (
                <input autoFocus value={familyInput} onChange={(e) => setFamilyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); } if (e.key === "Escape") setEditingFamilyKey(null); }}
                  onBlur={() => { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); }}
                  list="group-list" placeholder="Catégorie…"
                  className="w-20 text-[9px] border border-violet-300 rounded px-1 py-0.5 focus:outline-none" />
              ) : (
                <button onClick={() => { setEditingFamilyKey(asset.id); setFamilyInput(asset.category ?? ""); }}
                  className={`flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border ${
                    asset.category ? "bg-violet-50 text-violet-600 border-violet-100 hover:bg-violet-100" : "bg-gray-50 text-gray-300 border-dashed border-gray-200 hover:text-violet-500"
                  }`}>
                  <FolderOpen size={7} /><span>{asset.category || "–"}</span>
                </button>
              )
            )}
            {!opts.hideCategory && asset.setTag && <span className="text-[9px] text-gray-300">›</span>}
            {editingSetTagId === asset.id ? (
              <input autoFocus value={setTagValue} onChange={(e) => setSetTagValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSaveSetTag(asset, setTagValue); } if (e.key === "Escape") { setEditingSetTagId(null); setSetTagValue(""); setSetTagError(null); } }}
                onBlur={() => { void handleSaveSetTag(asset, setTagValue); }}
                list="set-tags-list" placeholder="set…"
                className="w-16 text-[9px] border border-pink-300 rounded px-1 py-0.5 focus:outline-none" />
            ) : (
              <button onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(asset.setTag ?? ""); }}
                className={`flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border ${
                  asset.setTag ? "bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100" : "bg-gray-50 text-gray-300 border-dashed border-gray-200 hover:text-pink-500"
                }`}>
                <Layers size={7} /><span>{asset.setTag || "–"}</span>
              </button>
            )}
          </div>
          <p className="text-[11px] font-medium text-gray-700 truncate" title={asset.filename}>{asset.filename}</p>
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {asset.tags.map((t) => <span key={t} className="text-[9px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 rounded">{t}</span>)}
            </div>
          )}
        </div>
        {/* Stats + access indicator */}
        <div className="flex flex-col items-end gap-0.5 shrink-0 text-[9px] text-gray-400">
          <span className="flex items-center gap-0.5"><BarChart2 size={8} />{asset.usageCount}</span>
          <span className="flex items-center gap-0.5"><Clock size={8} />{asset.lastUsedAt ? new Date(asset.lastUsedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "Jamais"}</span>
          {asset.accessAccountIds.length === 0
            ? <span className="flex items-center gap-0.5 text-gray-300" title="Accessible à tous"><Globe size={7} /></span>
            : <span className="flex items-center gap-0.5 text-blue-400" title={`Accès restreint : ${asset.accessAccountIds.length} compte${asset.accessAccountIds.length > 1 ? "s" : ""}`}><Lock size={7} />{asset.accessAccountIds.length}</span>
          }
        </div>
        {/* Delete */}
        {!selectMode && (
          <button onClick={(e) => { e.stopPropagation(); void handleDelete(asset); }}
            className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 transition">
            <Trash2 size={11} />
          </button>
        )}
      </div>
    );
  }

  function renderVideoCard(asset: MediaAsset) {
    const isSelected = selectedIds.has(asset.id);
    // Dim assets that are not accessible to the currently filtered account
    const isAssetAccessible = !accountFilter ||
      asset.accessAccountIds.length === 0 ||
      asset.accessAccountIds.includes(accountFilter);
    return (
      <div
        key={asset.id}
        className={`group relative bg-gray-100 rounded-xl overflow-hidden border transition-colors ${
          !isAssetAccessible ? "opacity-50" : ""
        } ${
          selectMode && isSelected
            ? "border-indigo-500 ring-2 ring-indigo-200"
            : "border-gray-200 hover:border-indigo-300"
        }`}
        onClick={() => { if (selectMode) toggleSelect(asset.id); }}
      >
        {/* Thumbnail / preview */}
        <div className="relative aspect-[9/16] bg-gray-200">
          {previewId === asset.id ? (
            <video src={asset.url} controls autoPlay className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <>
              <video src={`${asset.url}#t=0.5`} muted preload="metadata" className="w-full h-full object-cover" />
              {!selectMode && (
                <button
                  onClick={() => setPreviewId(asset.id)}
                  className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow">
                    <Play size={14} className="text-gray-800 ml-0.5" />
                  </div>
                </button>
              )}
            </>
          )}
          {previewId === asset.id && (
            <button
              onClick={() => setPreviewId(null)}
              className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white text-xs rounded-full flex items-center justify-center z-10"
            >✕</button>
          )}
          {asset.duration && (
            <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
              {formatDuration(asset.duration)}
            </span>
          )}
          {/* Select checkbox overlay */}
          {selectMode && (
            <div className="absolute top-1 right-1 z-10" onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}>
              {isSelected
                ? <CheckSquare size={16} className="text-indigo-600 drop-shadow" />
                : <Square size={16} className="text-white/80 drop-shadow" />}
            </div>
          )}
        </div>
        {/* Info */}
        <div className="p-2.5">
          {/* ── Catégorie + Set ── breadcrumb, both always interactive */}
          <div className="flex items-center gap-1 mb-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* Category pill */}
            {editingFamilyKey === asset.id ? (
              <input
                autoFocus
                value={familyInput}
                onChange={(e) => setFamilyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); }
                  if (e.key === "Escape") setEditingFamilyKey(null);
                }}
                onBlur={() => { void handleSaveCategory(asset, familyInput); setEditingFamilyKey(null); }}
                list="group-list"
                placeholder="Catégorie…"
                className="w-24 text-[9px] border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            ) : (
              <button
                onClick={() => { setEditingFamilyKey(asset.id); setFamilyInput(asset.category ?? ""); }}
                className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                  asset.category
                    ? "bg-violet-50 text-violet-600 border-violet-100 hover:bg-violet-100"
                    : "bg-gray-50 text-gray-400 border-dashed border-gray-200 hover:text-violet-500 hover:border-violet-200"
                }`}
                title="Catégorie — cliquer pour modifier"
              >
                <FolderOpen size={8} className="shrink-0" />
                <span>{asset.category || "Catégorie…"}</span>
              </button>
            )}
            <span className="text-[9px] text-gray-300">›</span>
            {/* Set pill */}
            {editingSetTagId === asset.id ? (
              <div className="flex flex-col gap-0.5">
                <input
                  autoFocus
                  value={setTagValue}
                  onChange={(e) => setSetTagValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void handleSaveSetTag(asset, setTagValue); }
                    if (e.key === "Escape") { setEditingSetTagId(null); setSetTagValue(""); setSetTagError(null); }
                  }}
                  onBlur={() => { void handleSaveSetTag(asset, setTagValue); }}
                  list="set-tags-list"
                  placeholder="set…"
                  className="w-20 text-[9px] border border-pink-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-pink-400"
                />
                {setTagValue.trim() && setTagValue.trim() !== asset.setTag && (() => {
                  const existingCategories = Array.from(new Set(
                    assets.filter((a) => a.setTag === setTagValue.trim() && a.id !== asset.id && a.category).map((a) => a.category!)
                  ));
                  return existingCategories.length > 0 ? (
                    <span className="text-[9px] flex items-center gap-0.5 font-medium text-orange-600">
                      <FolderOpen size={8} /> Catégorie existante&nbsp;: {existingCategories[0]}
                    </span>
                  ) : null;
                })()}
                {setTagError && <span className="text-[9px] text-red-500">{setTagError}</span>}
              </div>
            ) : (
              <button
                onClick={() => { setEditingSetTagId(asset.id); setSetTagValue(asset.setTag ?? ""); }}
                className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                  asset.setTag
                    ? "bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100"
                    : "bg-gray-50 text-gray-400 border-dashed border-gray-200 hover:text-pink-500 hover:border-pink-200"
                }`}
                title="Set — cliquer pour assigner"
              >
                <Layers size={8} className="shrink-0" />
                <span>{asset.setTag || "Set…"}</span>
              </button>
            )}
          </div>
          <p className="text-xs font-medium text-gray-800 truncate mb-2" title={asset.filename}>{asset.filename}</p>

          {/* ── Tags ── */}
          {editingTagsId === asset.id ? (
            <div className="mb-2" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }
                  if (e.key === "Escape") { setEditingTagsId(null); setTagInput(""); }
                }}
                onBlur={() => { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }}
                placeholder="intro, outro, plan1…"
                className="w-full text-xs border border-indigo-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          ) : (
            <div
              className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer -mx-1 px-1 py-1 rounded-lg hover:bg-gray-50 transition-colors mb-1"
              onClick={(e) => { e.stopPropagation(); setEditingTagsId(asset.id); setTagInput(asset.tags.join(", ")); }}
              title="Tags : cliquer pour éditer (intro, outro, rôle…)"
            >
              {asset.tags.length > 0 ? asset.tags.map((t) => (
                <span key={t} className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded">{t}</span>
              )) : (
                <span className="text-[10px] text-gray-300 flex items-center gap-0.5"><Tag size={9} /> ajouter tags…</span>
              )}
            </div>
          )}

          {/* ── Accès ── */}
          <div className="flex items-center gap-1 flex-wrap mt-1 mb-1" onClick={(e) => e.stopPropagation()}>
            {asset.accessAccountIds.length === 0 ? (
              <span className="flex items-center gap-0.5 text-[9px] text-gray-300" title="Accessible à tous les comptes">
                <Globe size={8} /> Global
              </span>
            ) : (
              asset.accessAccountIds.map((id) => {
                const acc = accounts.find((a) => a.id === id);
                return acc ? (
                  <button
                    key={id}
                    onClick={() => void handleToggleAccess(asset, id, false)}
                    className="flex items-center gap-0.5 text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                    title={`Retirer l'accès à @${acc.handle}`}
                  >
                    <Lock size={7} />@{acc.handle}<X size={6} />
                  </button>
                ) : null;
              })
            )}
            {accounts.filter((a) => !asset.accessAccountIds.includes(a.id)).length > 0 && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) void handleToggleAccess(asset, e.target.value, true); }}
                className="text-[9px] text-gray-400 border border-dashed border-gray-200 rounded px-1 py-0.5 focus:outline-none hover:border-blue-300 hover:text-blue-500 max-w-[80px] cursor-pointer"
                title="Restreindre l'accès à un compte"
              >
                <option value="">+ compte</option>
                {accounts.filter((a) => !asset.accessAccountIds.includes(a.id)).map((a) => (
                  <option key={a.id} value={a.id}>@{a.handle}</option>
                ))}
              </select>
            )}
          </div>
          {/* ── Stats row ── */}
          <div className="flex items-center justify-between gap-1">
            {/* When a per-account filter is active, the displayed stats are per-account values —
                editing them would incorrectly update global counters, so inline editing is disabled. */}
            {!accountFilter && editingUsageId === asset.id ? (
              <input
                autoFocus
                type="number"
                min={0}
                value={usageInput}
                onChange={(e) => setUsageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleSaveUsage(asset, usageInput); }
                  if (e.key === "Escape") { setEditingUsageId(null); setUsageInput(""); }
                }}
                onBlur={() => { void handleSaveUsage(asset, usageInput); }}
                className="w-14 text-[10px] border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                onClick={(e) => e.stopPropagation()}
              />
            ) : accountFilter ? (
              <span
                className="flex items-center gap-0.5 text-[10px] text-gray-400"
                title="Stats du compte (lecture seule — basculer en vue globale pour modifier)"
              >
                <BarChart2 size={10} /> {asset.usageCount} <span className="text-gray-300">(compte)</span>
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingUsageId(asset.id); setUsageInput(String(asset.usageCount)); }}
                className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-indigo-600 hover:underline transition-colors"
                title="Cliquer pour modifier"
              >
                <BarChart2 size={10} /> {asset.usageCount}
              </button>
            )}
            {!accountFilter && editingLastUsedId === asset.id ? (
              <input
                autoFocus
                type="date"
                value={lastUsedInput}
                onChange={(e) => setLastUsedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void handleSaveLastUsed(asset, lastUsedInput); }
                  if (e.key === "Escape") { setEditingLastUsedId(null); setLastUsedInput(""); }
                }}
                onBlur={() => { void handleSaveLastUsed(asset, lastUsedInput); }}
                className="w-full text-[10px] border border-orange-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                onClick={(e) => e.stopPropagation()}
              />
            ) : accountFilter ? (
              <span
                className="flex items-center gap-0.5 text-[10px] text-gray-400"
                title="Dernière utilisation du compte (lecture seule)"
              >
                <Clock size={10} /> {formatDate(asset.lastUsedAt)}
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingLastUsedId(asset.id); setLastUsedInput(toDateInputValue(asset.lastUsedAt)); }}
                className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-orange-600 hover:underline transition-colors"
                title="Dernière utilisation : cliquer pour modifier"
              >
                <Clock size={10} /> {formatDate(asset.lastUsedAt)}
              </button>
            )}
          </div>
        </div>
        {/* Action buttons — hidden in select mode */}
        {!selectMode && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); void handleDelete(asset); }}
              className="absolute top-1.5 left-1.5 w-6 h-6 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
              title="Supprimer"
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setEditingAsset(asset); }}
              className="absolute top-8 left-1.5 w-6 h-6 bg-white/80 hover:bg-violet-50 text-gray-500 hover:text-violet-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
              title="Éditer (trim, audio)"
            >
              <Scissors size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void handleResetAssetUsage(asset); }}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/80 hover:bg-orange-50 text-gray-500 hover:text-orange-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
              title={accountFilter ? "Réinitialiser les stats de ce compte" : "Réinitialiser les compteurs"}
            >
              <RotateCcw size={11} />
            </button>
          </>
        )}
      </div>
    );
  }

  function renderColumn({ key, setTag, category, groupAssets, accessibleCount, lastUsed, autoRank, isAccessible = true, inSection = false }: { key: string; setTag: string | null; category: string | null; groupAssets: MediaAsset[]; accessibleCount?: number; lastUsed: string | null; autoRank: number | null; isAccessible?: boolean; inSection?: boolean }): React.ReactNode {
    const isAutoMode = seqState.length === 0;
    const seqIdx = setTag ? seqState.indexOf(setTag) : -1;
    const isSequenced = seqIdx !== -1;

    // Smart rush detection: a tag is a "role" if it appears on SOME but not ALL assets in the set.
    const tagFreq = new Map<string, MediaAsset[]>();
    for (const a of groupAssets) {
      for (const t of a.tags) {
        if (!tagFreq.has(t)) tagFreq.set(t, []);
        tagFreq.get(t)!.push(a);
      }
    }
    const roleTags = Array.from(tagFreq.entries())
      .filter(([, tagged]) => tagged.length < groupAssets.length)
      .sort(([a], [b]) => a.localeCompare(b));
    const roleAssetIds = new Set(roleTags.flatMap(([, tagged]) => tagged.map((a) => a.id)));
    const mainAssets = groupAssets.filter((a) => !roleAssetIds.has(a.id));
    const hasRoles = roleTags.length > 0;
    return (
      <div key={key || "__unset__"} className={`flex flex-col w-52 shrink-0 ${!isAccessible && accountFilter ? "opacity-50" : ""}`}>
        {/* Column header */}
        <div className={`mb-2 p-2.5 rounded-xl border flex flex-col gap-1 ${!isAccessible && accountFilter ? "bg-gray-50 border-dashed border-gray-300" : "bg-gray-50 border-gray-200"}`}>
          {!isAccessible && accountFilter && (
            <span className="text-[9px] text-gray-400 flex items-center gap-0.5 mb-0.5"><Lock size={8} /> Hors accès pour ce compte</span>
          )}
          {/* Category — only shown when NOT inside a category section (avoids redundancy) */}
          {(setTag || category) && !inSection && (
            <div>
              {editingFamilyKey === key ? (
                <input
                  autoFocus
                  value={familyInput}
                  onChange={(e) => setFamilyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleSaveCategoryForGroup(groupAssets, familyInput);
                      setEditingFamilyKey(null);
                    }
                    if (e.key === "Escape") { setEditingFamilyKey(null); }
                  }}
                  onBlur={() => {
                    void handleSaveCategoryForGroup(groupAssets, familyInput);
                    setEditingFamilyKey(null);
                  }}
                  list="group-list"
                  placeholder="ex: Tenue A, Plan Ext…"
                  className="w-full text-[10px] border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              ) : (
                <button
                  onClick={() => { setEditingFamilyKey(key); setFamilyInput(category ?? ""); }}
                  className={`flex items-center gap-1 text-[10px] w-full text-left px-1.5 py-0.5 rounded border transition-colors ${
                    category
                      ? "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 font-medium"
                      : "text-gray-400 border-dashed border-gray-200 hover:border-violet-200 hover:text-violet-500"
                  }`}
                  title="Catégorie du set — deux sets de la même catégorie ne se suivent jamais dans la rotation"
                >
                  <FolderOpen size={10} className="shrink-0" />
                  <span className="truncate">{category || "Catégorie…"}</span>
                </button>
              )}
            </div>
          )}
          {/* Divider */}
          {(setTag || category) && !inSection && <div className="h-px bg-gray-200" />}
          {/* Set name */}
          {setTag ? (
            <div className="flex items-center gap-1.5">
              <Layers size={11} className="text-pink-400 shrink-0" />
              <span className="text-xs font-semibold text-gray-800 truncate" title={setTag}>{setTag}</span>
            </div>
          ) : category ? (
            <span className="text-xs font-medium text-gray-500 italic">Pool catégorie</span>
          ) : (
            <span className="text-xs font-medium text-gray-400">Sans set</span>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-gray-400">{accessibleCount ?? groupAssets.length} rush{(accessibleCount ?? groupAssets.length) !== 1 ? "es" : ""}</span>
            {(setTag || category) && (
              isAutoMode ? (
                autoRank === 1 ? (
                  <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <RotateCcw size={9} /> Prochain
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400 font-mono bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <RotateCcw size={9} /> #{autoRank}
                  </span>
                )
              ) : (
                isSequenced ? (
                  <div className="flex items-center gap-0.5">
                    <span className="text-[10px] font-mono bg-indigo-100 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <ListOrdered size={10} /> #{seqIdx + 1}
                    </span>
                    <button onClick={() => moveSetTag(setTag!, -1)} disabled={seqIdx === 0} className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronUp size={12} className="text-gray-500" /></button>
                    <button onClick={() => moveSetTag(setTag!, 1)} disabled={seqIdx === seqState.length - 1} className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronDown size={12} className="text-gray-500" /></button>
                    <button onClick={() => removeFromSequence(setTag!)} className="text-[10px] text-red-400 hover:text-red-600 px-0.5 flex items-center" title="Retirer de la rotation"><MinusCircle size={11} /></button>
                  </div>
                ) : (
                  <button onClick={() => addToSequence(setTag!)} className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5"><PlusCircle size={10} /> Fixer l&apos;ordre</button>
                )
              )
            )}
          </div>
          {(setTag || category) && lastUsed && (
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Clock size={9} /> {formatDate(lastUsed)}</span>
          )}
        </div>
        {/* Rushes with defined roles */}
        {hasRoles && (
          <div className="border border-dashed border-amber-200 bg-amber-50/40 rounded-xl p-1.5 mb-2">
            <span className="text-[9px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Film size={9} /> Rushes
            </span>
            {roleTags.map(([tag, assets]) => (
              <div key={tag} className="mb-1.5 last:mb-0">
                <span className="text-[9px] text-amber-500 mb-1 block pl-0.5">{tag}</span>
                <div className="flex flex-col gap-1.5">{assets.map((a) => renderVideoCard(a))}</div>
              </div>
            ))}
          </div>
        )}
        {/* Main assets */}
        {mainAssets.length > 0 && (
          <div className="flex flex-col gap-2">
            {mainAssets.map((a) => renderVideoCard(a))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{library.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {assets.length} fichier{assets.length !== 1 ? "s" : ""} · {isVideo ? "Vidéos" : "Musiques"}
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          <Upload size={14} /> {isVideo ? "Ajouter des vidéos" : "Ajouter des musiques"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={isVideo ? "video/*" : "audio/*"}
          onChange={(e) => { void handleFileSelect(e); }}
          className="hidden"
        />
      </div>

      {/* Upload feedback */}
      {resetError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{resetError}</div>
      )}
      {uploadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{uploadError}</div>
      )}
      {uploadSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={14} /> {uploadSuccess}
        </div>
      )}
      {uploading && (
        <div className="mb-4 space-y-1">
          <div className="flex justify-between text-xs text-indigo-700">
            <span>Upload en cours…</span>
            <span>{uploadProgress ?? 0}%</span>
          </div>
          <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all duration-200"
              style={{ width: `${uploadProgress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Filters bar */}
      {!loading && assets.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un fichier…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <ArrowUpDown size={12} />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="date_desc">Plus récents</option>
                <option value="date_asc">Plus anciens</option>
                <option value="usage_desc">Plus utilisés</option>
                <option value="usage_asc">Moins utilisés</option>
                <option value="name_asc">Nom (A-Z)</option>
              </select>
            </div>
            {isVideo && (
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${viewMode === "grid" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  title="Vue grille"
                >
                  <LayoutGrid size={13} /> Grille
                </button>
                <button
                  onClick={() => setViewMode("grouped")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${viewMode === "grouped" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  title="Vue groupée par famille / set"
                >
                  <Layers size={13} /> Groupes
                </button>
                <button
                  onClick={() => setViewMode("rotation")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${viewMode === "rotation" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  title="Vue rotation — ordre de passage des sets"
                >
                  <RotateCcw size={13} /> Rotation
                </button>
              </div>
            )}
            {isVideo && (
              <button
                onClick={() => { if (selectMode) { exitSelectMode(); } else { setSelectMode(true); } }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg transition-colors ${
                  selectMode
                    ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
                }`}
              >
                <CheckSquare size={13} />
                {selectMode ? (selectedIds.size > 0 ? `${selectedIds.size} sélectionné${selectedIds.size > 1 ? "s" : ""}` : "Sélectionner") : "Sélectionner"}
              </button>
            )}
          </div>
          {isVideo && accounts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 flex items-center gap-1"><Users size={11} /> Compte :</span>
              <select
                value={accountFilter ?? ""}
                onChange={(e) => setAccountFilter(e.target.value || null)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">Tous (global)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.handle} — {a.name}</option>
                ))}
              </select>
              {accountFilter && (
                <>
                  <button onClick={() => setAccountFilter(null)} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"><X size={10} /> Effacer</button>
                  <span className="text-[10px] text-blue-500 flex items-center gap-0.5 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded"><Clock size={9} /> Stats par compte</span>
                </>
              )}
            </div>
          )}
          {allTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 flex items-center gap-1"><Tag size={11} /> Tags :</span>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(tagFilter === t ? "" : t)}
                  className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                    tagFilter === t
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {t}
                </button>
              ))}
              {tagFilter && (
                <button onClick={() => setTagFilter("")} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                  <X size={10} /> Effacer
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (selectedIds.size === filtered.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filtered.map((a) => a.id)));
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-indigo-700 hover:underline"
              >
                {selectedIds.size === filtered.length ? <CheckSquare size={12} /> : <Square size={12} />}
                {selectedIds.size === filtered.length ? "Tout désélectionner" : "Tout sélectionner"}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-indigo-600 font-medium">
                  {selectedIds.size} asset{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <button onClick={exitSelectMode} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
              <X size={12} /> Annuler
            </button>
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Bulk set tag */}
              <div className="flex items-center gap-1.5 flex-1">
                <span className="text-xs text-gray-500 shrink-0">Groupe :</span>
                <input
                  value={bulkSetTagInput}
                  onChange={(e) => setBulkSetTagInput(e.target.value)}
                  list="bulk-set-tags-list"
                  placeholder="ex: tenue1, session-paris"
                  className="flex-1 text-xs border border-pink-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-pink-400"
                  onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplySetTag(); } }}
                />
                <button
                  onClick={() => { void handleBulkApplySetTag(); }}
                  disabled={bulkApplying}
                  className="px-2.5 py-1 bg-pink-600 text-white text-xs rounded hover:bg-pink-700 disabled:opacity-50"
                >
                  Appliquer
                </button>
              </div>
              {/* Bulk tags */}
              <div className="flex items-center gap-1.5 flex-1">
                <span className="text-xs text-gray-500 shrink-0">Tags :</span>
                <input
                  value={bulkTagsInput}
                  onChange={(e) => setBulkTagsInput(e.target.value)}
                  placeholder="tag1, tag2"
                  className="flex-1 text-xs border border-indigo-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  onKeyDown={(e) => { if (e.key === "Enter") { void handleBulkApplyTags(); } }}
                />
                <button
                  onClick={() => { void handleBulkApplyTags(); }}
                  disabled={bulkApplying}
                  className="px-2.5 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  Remplacer
                </button>
              </div>
            </div>
          )}
          {bulkError && <p className="text-xs text-red-500">{bulkError}</p>}
        </div>
      )}

      {/* Error */}
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <p className="font-medium">Impossible de charger les assets</p>
          <p className="font-mono text-xs mt-1">{loadError}</p>
          <button onClick={() => { void load(); }} className="text-xs underline mt-2">Réessayer</button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {isVideo ? <Play size={32} className="text-gray-300 mb-3" /> : <Music2 size={32} className="text-gray-300 mb-3" />}
          <p className="text-sm font-medium text-gray-500">Aucun fichier dans cette bibliothèque</p>
          <p className="text-xs text-gray-400 mt-1">Cliquez sur &laquo;&nbsp;Ajouter&nbsp;&raquo; pour uploader vos premiers fichiers.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          {tagFilter ? `Aucun fichier avec le tag «\u00a0${tagFilter}\u00a0»${search ? ` correspondant à «\u00a0${search}\u00a0»` : ""}.` : `Aucun résultat pour «\u00a0${search}\u00a0».`}
        </p>
      ) : isVideo ? (
        /* ─── Video grid / grouped ─── */
        <>
          <datalist id="set-tags-list">
            {allSetTags.map((t) => <option key={t} value={t} />)}
          </datalist>
          <datalist id="bulk-set-tags-list">
            {allSetTags.map((t) => <option key={t} value={t} />)}
          </datalist>
          {viewMode === "rotation" ? (
            /* ─── Rotation view ─── ordered flat list by autoRank, colored by category */
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-gray-50 border-gray-200 mb-3">
                {seqState.length === 0 ? (
                  <span className="text-xs text-gray-600 flex items-center gap-1.5">
                    <RotateCcw size={12} className="text-emerald-500" />
                    <span className="font-medium text-emerald-700">Rotation auto</span>
                    <span className="text-gray-400">— ordre simulé, le set le moins récemment utilisé passe en premier, jamais deux sets de la même catégorie à la suite</span>
                  </span>
                ) : (
                  <span className="text-xs flex items-center gap-1.5">
                    <ListOrdered size={12} className="text-indigo-500" />
                    <span className="font-medium text-indigo-700">Ordre personnalisé</span>
                    <span className="text-gray-400">{seqState.length} set{seqState.length !== 1 ? "s" : ""} fixés</span>
                  </span>
                )}
                {seqState.length > 0 && (
                  <button onClick={() => { void saveSequence([]); }} className="text-[11px] text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-2 py-0.5">Passer en auto</button>
                )}
              </div>
              {(() => {
                // Build palette: one distinct color per category
                const categories = Array.from(new Set(groupedBySetTag.map((g) => g.category).filter(Boolean))) as string[];
                const palette = ["violet", "blue", "amber", "emerald", "rose", "cyan", "orange", "teal"];
                const catColor: Record<string, string> = {};
                categories.forEach((c, i) => { catColor[c] = palette[i % palette.length]!; });
                const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
                  violet: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
                  blue:   { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
                  amber:  { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
                  emerald:{ bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
                  rose:   { bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-200" },
                  cyan:   { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
                  orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
                  teal:   { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200" },
                };
                const namedGroups = groupedBySetTag.filter((g) => g.setTag || g.category);
                const unnamedGroups = groupedBySetTag.filter((g) => !g.setTag && !g.category);
                return (
                  <>
                    {namedGroups.map((g) => {
                      const color = g.category ? (catColor[g.category] ?? "violet") : "";
                      const cls = color ? colorClasses[color] : null;
                      const dimmed = !g.isAccessible && !!accountFilter;
                      return (
                        <div key={g.key} className={`flex items-start gap-3 p-2.5 rounded-xl border transition-opacity ${
                          dimmed
                            ? "opacity-50 border-dashed border-gray-300 bg-gray-50"
                            : cls ? `${cls.bg} ${cls.border}` : "bg-gray-50 border-gray-200"
                        }`}>
                          {/* Rank badge */}
                          <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
                            dimmed
                              ? "bg-gray-100 text-gray-400 border-gray-300"
                              : g.autoRank === 1
                              ? "bg-emerald-500 text-white border-emerald-600"
                              : cls ? `bg-white ${cls.text} ${cls.border}` : "bg-white text-gray-500 border-gray-300"
                          }`}>
                            {dimmed ? <Lock size={10} /> : (g.autoRank ?? "–")}
                          </div>
                          {/* Set + category info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              {g.category && cls && !dimmed && (
                                <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls.bg} ${cls.text} ${cls.border}`}>
                                  <FolderOpen size={9} />{g.category}
                                </span>
                              )}
                              {dimmed ? (
                                <span className="text-[9px] text-gray-400 border border-dashed border-gray-300 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                                  <Lock size={8} /> Hors accès
                                </span>
                              ) : null}
                              {g.setTag ? (
                                <>
                                  <span className="text-[10px] text-gray-300">›</span>
                                  <span className="flex items-center gap-0.5 text-[10px] font-semibold bg-pink-50 text-pink-700 border border-pink-100 px-1.5 py-0.5 rounded">
                                    <Layers size={9} />{g.setTag}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic">pool</span>
                              )}
                              <span className="text-[10px] text-gray-400 ml-1">{g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}</span>
                              {g.lastUsed && <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-1"><Clock size={9} />{formatDate(g.lastUsed)}</span>}
                            </div>
                            {/* Compact cards */}
                            <div className="flex flex-col gap-1">
                              {g.groupAssets.map((a) => renderCompactCard(a, { hideCategory: true }))}
                            </div>
                          </div>
                          {/* Sequence controls */}
                          {seqState.length > 0 && g.setTag && (() => {
                            const idx = seqState.indexOf(g.setTag!);
                            return (
                              <div className="flex flex-col items-center gap-0.5 shrink-0">
                                {idx !== -1 ? (
                                  <>
                                    <button onClick={() => moveSetTag(g.setTag!, -1)} disabled={idx === 0} className="p-0.5 rounded hover:bg-white disabled:opacity-30"><ChevronUp size={13} /></button>
                                    <button onClick={() => moveSetTag(g.setTag!, 1)} disabled={idx === seqState.length - 1} className="p-0.5 rounded hover:bg-white disabled:opacity-30"><ChevronDown size={13} /></button>
                                    <button onClick={() => removeFromSequence(g.setTag!)} className="p-0.5 text-red-400 hover:text-red-600" title="Retirer"><MinusCircle size={12} /></button>
                                  </>
                                ) : (
                                  <button onClick={() => addToSequence(g.setTag!)} className="p-0.5 text-indigo-400 hover:text-indigo-600" title="Fixer"><PlusCircle size={12} /></button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    {unnamedGroups.map((g) => (
                      <div key={g.key || "__unset__"} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400">
                        <span className="font-medium">Sans set</span>
                        <span>— {g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}</span>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          ) : viewMode === "grouped" ? (
            <div className="space-y-5">
              {/* Rotation mode banner */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-gray-50 border-gray-200">
                {seqState.length === 0 ? (
                  <span className="text-xs text-gray-600 flex items-center gap-1.5">
                    <RotateCcw size={12} className="text-emerald-500" />
                    <span className="font-medium text-emerald-700">Rotation auto</span>
                    <span className="text-gray-400">— les groupes les moins récemment utilisés passent en premier</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-600 flex items-center gap-1.5">
                    <ListOrdered size={12} className="text-indigo-500" />
                    <span className="font-medium text-indigo-700">Ordre personnalisé</span>
                    <span className="text-gray-400">— {seqState.length} groupe{seqState.length !== 1 ? "s" : ""} dans la rotation</span>
                  </span>
                )}
                {seqState.length > 0 && (
                  <button
                    onClick={() => { void saveSequence([]); }}
                    className="text-[11px] text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded px-2 py-0.5 transition-colors"
                    title="Revenir à la rotation automatique"
                  >
                    Passer en auto
                  </button>
                )}
              </div>
              {groupedBySetTag.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">Aucun résultat.</p>
              ) : (
                <div className="overflow-x-auto pb-2 -mx-1 px-1">
                  <datalist id="group-list">
                    {Array.from(new Set(assets.map((a) => a.category).filter(Boolean))).map((t) => <option key={t!} value={t!} />)}
                  </datalist>
                  {sectionsByGroup.hasGroups ? (
                    <div className="space-y-8">
                      {sectionsByGroup.sections.map(({ name, groups }) => (
                        <div key={name} className="rounded-2xl border border-violet-100 bg-violet-50/30 p-4">
                          <div className="flex items-center gap-2 mb-4">
                            <FolderOpen size={14} className="text-violet-500 shrink-0" />
                            <span className="text-sm font-semibold text-violet-800">{name}</span>
                            <span className="text-xs text-violet-400 font-medium">{groups.reduce((n, g) => n + g.groupAssets.length, 0)} rush{groups.reduce((n, g) => n + g.groupAssets.length, 0) !== 1 ? "es" : ""}</span>
                          </div>
                          <div className="flex gap-3 min-w-max items-start">
                            {groups.map((g) => (
                              <div key={g.key} className={`w-52 shrink-0 ${!g.isAccessible && accountFilter ? "opacity-50" : ""}`}>
                                {/* Set column header */}
                                <div className={`mb-2 px-2.5 py-2 rounded-xl border flex flex-col gap-1 ${!g.isAccessible && accountFilter ? "bg-gray-50 border-dashed border-gray-300" : "bg-white border-pink-100"}`}>
                                  <div className="flex items-center gap-1.5">
                                    <Layers size={11} className="text-pink-400 shrink-0" />
                                    <span className="text-xs font-semibold text-gray-800 truncate">{g.setTag}</span>
                                    <span className="text-[10px] text-gray-400 ml-auto">{g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}</span>
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {!g.isAccessible && accountFilter ? (
                                      <span className="text-[9px] text-gray-400 border border-dashed border-gray-300 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                                        <Lock size={8} /> Hors accès
                                      </span>
                                    ) : seqState.length === 0 ? (
                                      g.autoRank === 1 ? (
                                        <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                          <RotateCcw size={8} /> Prochain
                                        </span>
                                      ) : g.autoRank ? (
                                        <span className="text-[9px] text-gray-400 font-mono bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                          <RotateCcw size={8} /> #{g.autoRank}
                                        </span>
                                      ) : null
                                    ) : null}
                                    {g.lastUsed && <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Clock size={8} />{formatDate(g.lastUsed)}</span>}
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  {g.groupAssets.map((a) => renderCompactCard(a, { hideCategory: true }))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {sectionsByGroup.unassigned.filter((g) => g.key !== "").length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-xs text-gray-400 font-medium">Sets sans catégorie</span>
                            <div className="flex-1 h-px bg-gray-100" />
                          </div>
                          <div className="flex gap-3 min-w-max items-start">
                            {sectionsByGroup.unassigned.filter((g) => g.key !== "").map((g) => renderColumn(g))}
                          </div>
                        </div>
                      )}
                      {sectionsByGroup.unassigned.filter((g) => g.key === "").map((g) => renderColumn(g))}
                    </div>
                  ) : (
                    <div className="flex gap-4 min-w-max items-start">
                      {groupedBySetTag.map((g) => renderColumn(g))}
                    </div>
                  )}


                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {filtered.map((asset) => renderVideoCard(asset))}
            </div>
          )}
        </>
      ) : (
        /* ─── Audio list ─── */
        <div className="space-y-1.5">
          {filtered.map((asset) => (
            <div key={asset.id} className="group flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                <Music2 size={16} className="text-indigo-400" />
              </div>
                <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{asset.filename}</p>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  {asset.duration ? <span>{formatDuration(asset.duration)}</span> : null}
                  {editingUsageId === asset.id ? (
                    <input
                      autoFocus
                      type="number"
                      min={0}
                      value={usageInput}
                      onChange={(e) => setUsageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { void handleSaveUsage(asset, usageInput); }
                        if (e.key === "Escape") { setEditingUsageId(null); setUsageInput(""); }
                      }}
                      onBlur={() => { void handleSaveUsage(asset, usageInput); }}
                      className="w-16 text-[10px] border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingUsageId(asset.id); setUsageInput(String(asset.usageCount)); }}
                      className="flex items-center gap-0.5 hover:text-indigo-600 hover:underline transition-colors"
                      title="Cliquer pour modifier"
                    >
                      {asset.usageCount} usage{asset.usageCount !== 1 ? "s" : ""}
                    </button>
                  )}
                  <span>· Dernier : {formatDate(asset.lastUsedAt)}</span>
                </div>
                {/* Tags */}
                {editingTagsId === asset.id ? (
                  <input
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }
                      if (e.key === "Escape") { setEditingTagsId(null); setTagInput(""); }
                    }}
                    onBlur={() => { void handleSaveTags(asset, tagInput.split(",").map((t) => t.trim()).filter(Boolean)); }}
                    placeholder="tag1, tag2"
                    className="mt-1 w-full text-[10px] border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                ) : (
                  <div
                    className="mt-1 flex flex-wrap gap-1 cursor-pointer min-h-[16px]"
                    onClick={() => { setEditingTagsId(asset.id); setTagInput(asset.tags.join(", ")); }}
                    title="Cliquer pour éditer les tags"
                  >
                    {asset.tags.length > 0 ? asset.tags.map((t) => (
                      <span key={t} className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-1 rounded">{t}</span>
                    )) : (
                      <span className="text-[9px] text-gray-300 flex items-center gap-0.5"><Tag size={8} /> ajouter tags</span>
                    )}
                  </div>
                )}
              </div>
              <audio controls src={asset.url} className="h-8 w-36 sm:w-48 shrink-0" preload="none" />
              <button
                onClick={() => { void handleResetAssetUsage(asset); }}
                className="p-1.5 text-gray-300 hover:text-orange-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                title={accountFilter ? "Réinitialiser les stats de ce compte" : "Réinitialiser les compteurs"}
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => { void handleDelete(asset); }}
                className="p-1.5 text-gray-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {editingAsset && (
        <MediaAssetEditModal
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onDone={() => {
            setEditingAsset(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

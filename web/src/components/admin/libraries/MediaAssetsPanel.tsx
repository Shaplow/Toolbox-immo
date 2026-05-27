"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Trash2, Upload, Clock, BarChart2, Search, Play, Music2, ArrowUpDown, Tag, X, RotateCcw, LayoutGrid, Layers, Square, CheckSquare, ChevronUp, ChevronDown, ListOrdered, PlusCircle, MinusCircle, FolderOpen, Film, Globe, Lock, Users, Wand2, Loader2, AlertTriangle } from "lucide-react";
import { MediaAssetEditModal } from "./MediaAssetEditModal";
import { MediaBatchAutocutPanel } from "./MediaBatchAutocutPanel";
import type { MediaAsset, MetadataField, MediaLibrary, SortKey } from "./mediaAssets/types";
import { formatDate } from "./mediaAssets/helpers";
import { LazyVideoThumb } from "./mediaAssets/LazyVideoThumb";
import { useMediaAssetsLoader } from "./mediaAssets/useMediaAssetsLoader";
import { useInstagramAccounts } from "./mediaAssets/useInstagramAccounts";
import { useBulkEdit } from "./mediaAssets/useBulkEdit";
import { MediaAssetsUploadModal } from "./mediaAssets/MediaAssetsUploadModal";
import { MediaAssetsBulkActionBar } from "./mediaAssets/MediaAssetsBulkActionBar";
import { MediaAssetsRotationView } from "./mediaAssets/MediaAssetsRotationView";
import { MediaAssetsGroupedView } from "./mediaAssets/MediaAssetsGroupedView";
import { MediaAssetsAudioList } from "./mediaAssets/MediaAssetsAudioList";
import { useAssetInlineEdits } from "./mediaAssets/useAssetInlineEdits";
import { MediaAssetsVideoCard } from "./mediaAssets/MediaAssetsVideoCard";

interface Props {
  library: MediaLibrary;
}

export function MediaAssetsPanel({ library }: Props) {
  // ── État global de la liste ──
  // accountFilter doit être déclaré avant le hook loader (dépendance).
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const { assets, setAssets, loading, loadError, refetch: load } = useMediaAssetsLoader(
    library.id,
    accountFilter,
  );
  const accounts = useInstagramAccounts();
  // ── Upload modal ──
  // D7 — la modal d'upload est extraite dans MediaAssetsUploadModal.tsx,
  // qui encapsule son propre state (drag-drop, progress, fields). Le panel
  // ne garde que l'open/close.
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [tagFilter, setTagFilter] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [showAtelier, setShowAtelier] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "grouped" | "rotation">("grid");
  // D4 — bulk edit extrait dans useBulkEdit hook. La sticky bar D8
  // (MediaAssetsBulkActionBar) consomme l'objet `bulk` complet. Le panel
  // garde l'accès à selectMode/selectedIds/toggleSelect pour les cards.
  const bulk = useBulkEdit({ libraryId: library.id, setAssets, accounts });
  const { selectMode, setSelectMode, selectedIds, toggleSelect } = bulk;
  const [seqState, setSeqState] = useState<string[]>(() => {
    try { return JSON.parse(library.setSequence) as string[]; } catch { return []; }
  });
  // ── Infinite scroll ──
  const [visibleCount, setVisibleCount] = useState(48);
  const [visibleGroupCount, setVisibleGroupCount] = useState(20);
  const gridSentinelRef = useRef<HTMLDivElement>(null);
  const groupSentinelRef = useRef<HTMLDivElement>(null);
  // Refs stables pour les sentinels (mise à jour inline pendant le rendu — pas des hooks)
  const hasPendingRef = useRef(false);
  const visibleCountRef = useRef(0);
  const filteredLengthRef = useRef(0);
  const visibleGroupCountRef = useRef(0);
  const groupedLengthRef = useRef(0);

  const metadataSchema = useMemo<MetadataField[]>(() => {
    try { return JSON.parse(library.metadataSchema ?? "[]") as MetadataField[]; } catch { return []; }
  }, [library.metadataSchema]);

  // D9 — inline edits (setTag, category, tags, usage, lastUsedAt, metadata,
  // access, disabled, delete) extraits dans useAssetInlineEdits hook.
  // Destructuré pour garder les call sites historiques inchangés.
  const inline = useAssetInlineEdits({
    libraryId: library.id,
    setAssets,
    accountFilter,
    metadataSchema,
  });
  // D9-step2 — destructure réduit aux symboles consommés par renderCompactCard
  // et renderColumn (encore inline dans le panel). MediaAssetsVideoCard consomme
  // le hook complet via la prop `inline`.
  const {
    editingSetTagId, setEditingSetTagId,
    setTagValue, setSetTagValue,
    setSetTagError,
    editingFamilyKey, setEditingFamilyKey,
    familyInput, setFamilyInput,
    editingTagsId, setEditingTagsId,
    tagInput, setTagInput,
    editingUsageId, setEditingUsageId,
    usageInput, setUsageInput,
    resetError,
    handleSaveCategory,
    handleSaveCategoryForGroup,
    handleSaveUsage,
    handleResetAssetUsage,
    handleSaveTags,
    handleSaveSetTag,
    handleDelete,
  } = inline;

  // ─ Fetch des assets + accounts extrait dans les hooks
  //   useMediaAssetsLoader / useInstagramAccounts (D3 du split C1-v2).

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
      const res = await fetch(`/api/admin/libraries/media/${library.id}/assets/active-jobs`);
      if (!res.ok) return;
      type ActiveJobEntry = {
        id: string;
        url: string;
        duration: number | null;
        pendingEditJob: { id: string; status: string } | null;
        recentlyCompleted: boolean;
      };
      const entries = await res.json() as ActiveJobEntry[];
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
  }, [library.id, setAssets]); // setAssets vient de useMediaAssetsLoader (stable mais explicite)

  // Poll toutes les 5s — tourne en continu, ne fait rien si aucun job actif (hasPendingRef)
  useEffect(() => {
    const timer = setInterval(() => { if (hasPendingRef.current) void silentPoll(); }, 5000);
    return () => clearInterval(timer);
  }, [silentPoll]);

  // ESC handler géré dans MediaAssetsUploadModal (D7).

  // ─ Liste des comptes Instagram chargée via useInstagramAccounts hook.

  // filteredPreTag = recherche texte uniquement, sans le filtre tag.
  // Utilisé pour allTags/allSetTags afin que les chips de tags restent
  // visibles même quand un tag est actif.
  const filteredPreTag = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter((a) => a.filename.toLowerCase().includes(q));
  }, [assets, search]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    filteredPreTag.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [filteredPreTag]);

  const allSetTags = useMemo(() => {
    const s = new Set<string>();
    filteredPreTag.forEach((a) => { if (a.setTag) s.add(a.setTag); });
    return Array.from(s).sort();
  }, [filteredPreTag]);

  const filtered = useMemo(() => {
    const list: MediaAsset[] = tagFilter
      ? filteredPreTag.filter((a) => a.tags.includes(tagFilter))
      : filteredPreTag;
    return [...list].sort((a, b) => {
      // En vue grille avec filtre compte actif : assets accessibles remontés en premier
      if (accountFilter) {
        const aOk = a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter);
        const bOk = b.accessAccountIds.length === 0 || b.accessAccountIds.includes(accountFilter);
        if (aOk && !bOk) return -1;
        if (!aOk && bOk) return 1;
      }
      switch (sort) {
        case "date_asc":    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "usage_desc":  return b.usageCount - a.usageCount;
        case "usage_asc":   return a.usageCount - b.usageCount;
        case "name_asc":    return a.filename.localeCompare(b.filename);
        case "date_desc":
        default:            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [filteredPreTag, sort, tagFilter, accountFilter]);

  const visibleFiltered = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Mise à jour des refs stables après render via useEffect (React 19
  // strict mode interdit `ref.current = ...` dans le corps du composant).
  useEffect(() => {
    visibleCountRef.current = visibleCount;
    filteredLengthRef.current = filtered.length;
    hasPendingRef.current = assets.some((a) => a.pendingEditJob !== null);
  }, [visibleCount, filtered.length, assets]);

  // Reset visible counts quand les filtres/tri/bibliothèque/compte changent
  // (pattern "reset state when external data changes" — React docs OK).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(48);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleGroupCount(20);
  }, [search, sort, tagFilter, accountFilter, library.id]);

  // Sentinel grille — recréé seulement quand viewMode change (le sentinel peut être démonté/remonnté)
  useEffect(() => {
    const el = gridSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && visibleCountRef.current < filteredLengthRef.current) {
          setVisibleCount((n) => n + 48);
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

  // Sentinel groupes (vue rotation) — même logique
  useEffect(() => {
    const el = groupSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && visibleGroupCountRef.current < groupedLengthRef.current) {
          setVisibleGroupCount((n) => n + 20);
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

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
      // Include disabled assets in recency computation — mirrors the resolver which uses all
      // assets for MAX(lastUsedAt) in group discovery and excludes fully-disabled groups via HAVING.
      const pool = accountFilter
        ? groupAssets.filter((a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
        : groupAssets;
      return pool.reduce<string | null>((max, a) => {
        if (!a.lastUsedAt) return max;
        if (!max) return a.lastUsedAt;
        return a.lastUsedAt > max ? a.lastUsedAt : max;
      }, null);
    };

    // Group creation date = MIN(createdAt) across accessible assets in the group.
    // Mirrors the SQL MIN(ma."createdAt") group_created_at used as a tiebreaker so that
    // among never-used groups the resolver picks oldest-uploaded first (upload order).
    const getGroupCreatedAt = (groupAssets: MediaAsset[]) => {
      const pool = accountFilter
        ? groupAssets.filter((a) => a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
        : groupAssets;
      return pool.reduce<string | null>((min, a) => {
        if (!a.createdAt) return min;
        if (!min) return a.createdAt;
        return a.createdAt < min ? a.createdAt : min;
      }, null);
    };

    type GroupItem = { key: string; setTag: string | null; category: string | null; groupAssets: MediaAsset[]; accessibleCount: number; lastUsed: string | null; groupCreatedAt: string | null; autoRank: number | null; cycleSize: number | null; isAccessible: boolean };
    const isAutoMode = seqState.length === 0;

    const allEntries: GroupItem[] = Array.from(groups.entries()).map(([key, groupAssets]) => {
      const { category, setTag } = fromGroupKey(key);
      // Accessible when no accountFilter, or at least one non-disabled asset is global / allows this account
      const isAccessible = !accountFilter || groupAssets.some(
        (a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
      );
      const accessibleCount = accountFilter
        ? groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))).length
        : groupAssets.filter((a) => !a.disabled).length;
      return { key, setTag, category, groupAssets, accessibleCount, lastUsed: getLastUsed(groupAssets), groupCreatedAt: getGroupCreatedAt(groupAssets), autoRank: null, cycleSize: null, isAccessible };
    });

    const named = allEntries.filter((g) => g.setTag || g.category);
    const unnamed = allEntries.filter((g) => !g.setTag && !g.category);

    if (isAutoMode) {
      // Simulate rotation: only groups with at least one non-disabled accessible asset participate.
      const accessibleNamed = named.filter((g) => g.accessibleCount > 0 && (!accountFilter || g.isAccessible));
      const inaccessibleNamed = named.filter((g) => g.accessibleCount === 0 || (accountFilter && !g.isAccessible));
      // Category-level staleness: MAX(lastUsed) across all sets in the category.
      // This is the primary sort key — mirrors the SQL ORDER BY cat_last_used in the resolver.
      const catLastUsed = new Map<string | null, string | null>();
      for (const g of accessibleNamed) {
        const prev = catLastUsed.get(g.category) ?? null;
        if (!prev || (g.lastUsed && g.lastUsed > prev)) {
          catLastUsed.set(g.category, g.lastUsed);
        }
      }
      const ordered: GroupItem[] = [];
      // virtualCatLastUsed tracks simulated "time" per category as the loop advances.
      // Each pick updates the picked category to a virtual counter so that subsequent
      // iterations re-rank categories correctly — mirroring what the real resolver does
      // because it re-reads catLastUsed from DB on every generation.
      const virtualCatLastUsed = new Map<string | null, string | null>(catLastUsed);
      let virtualTick = 0;
      let remaining = [...accessibleNamed]; // re-sort dynamically each iteration
      let lastCategory: string | null = null;
      while (remaining.length > 0) {
        // Re-sort remaining using the current virtual catLastUsed
        remaining.sort((a, b) => {
          const catA = virtualCatLastUsed.get(a.category) ?? null;
          const catB = virtualCatLastUsed.get(b.category) ?? null;
          if (!catA && catB) return -1;
          if (catA && !catB) return 1;
          if (catA && catB && catA !== catB) return catA < catB ? -1 : 1;
          if (!a.lastUsed && b.lastUsed) return -1;
          if (a.lastUsed && !b.lastUsed) return 1;
          if (a.lastUsed && b.lastUsed && a.lastUsed !== b.lastUsed)
            return a.lastUsed < b.lastUsed ? -1 : 1;
          // Tiebreaker: group creation date (oldest uploaded first).
          // Mirrors the SQL ORDER BY sub2.group_created_at ASC NULLS LAST in the resolver.
          if (a.groupCreatedAt && b.groupCreatedAt && a.groupCreatedAt !== b.groupCreatedAt)
            return a.groupCreatedAt < b.groupCreatedAt ? -1 : 1;
          if (a.groupCreatedAt && !b.groupCreatedAt) return -1;
          if (!a.groupCreatedAt && b.groupCreatedAt) return 1;
          // Final deterministic fallback: numeric-aware setTag, then category.
          const na = parseInt(a.setTag ?? "", 10);
          const nb = parseInt(b.setTag ?? "", 10);
          if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
          const setTagCmp = (a.setTag ?? "").localeCompare(b.setTag ?? "");
          if (setTagCmp !== 0) return setTagCmp;
          return (a.category ?? "").localeCompare(b.category ?? "");
        });
        let eligible: GroupItem[] = lastCategory ? remaining.filter((g) => g.category !== lastCategory) : remaining;
        if (eligible.length === 0) eligible = remaining;
        const pick: GroupItem = eligible[0]!;
        ordered.push({ ...pick, autoRank: ordered.length + 1, cycleSize: -1 }); // cycleSize filled after loop
        lastCategory = pick.category;
        remaining = remaining.filter((g) => g.key !== pick.key);
        // Advance virtual catLastUsed for the picked category so it sorts to the back
        virtualTick += 1;
        virtualCatLastUsed.set(pick.category, `__sim_${String(virtualTick).padStart(10, "0")}`);
      }
      const cycleSize = ordered.length;
      const orderedWithCycle = ordered.map((g) => ({ ...g, cycleSize }));
      // When a specific account is selected, hide inaccessible groups entirely.
      const visibleUnnamed = accountFilter ? unnamed.filter((g) => g.isAccessible) : unnamed;
      return [...orderedWithCycle, ...(accountFilter ? [] : inaccessibleNamed.map((g) => ({ ...g, cycleSize: null }))), ...visibleUnnamed.map((g) => ({ ...g, cycleSize: null }))];
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
        // Show inaccessible/disabled groups that are in the sequence — they occupy cursor
        // positions and must be visible so the admin can remove them.
        const blockedInSeq = named.filter((g) => !g.isAccessible && g.setTag && seqState.includes(g.setTag)).sort(sortFn);
        const accessibleUnnamed = unnamed.filter((g) => g.isAccessible);
        return [...accessible, ...blockedInSeq, ...accessibleUnnamed];
      }
      return [...named.sort(sortFn), ...unnamed];
    }
  }, [filtered, seqState, accountFilter]);

  // Mise à jour des refs groupes après render via useEffect.
  useEffect(() => {
    groupedLengthRef.current = groupedBySetTag.length;
    visibleGroupCountRef.current = visibleGroupCount;
  }, [groupedBySetTag.length, visibleGroupCount]);

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

  // D9 — handleSaveCategory, handleToggleAccess, handleToggleDisabled,
  // handleSaveMetadata, handleSaveCategoryForGroup extraits dans le hook
  // useAssetInlineEdits (cf. const inline ci-dessus).

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

  // D9 — handleSaveUsage, handleResetAssetUsage, handleSaveTags,
  // handleSaveSetTag, handleSaveLastUsed, handleDelete, toDateInputValue
  // extraits dans le hook useAssetInlineEdits.
  // ─ Bulk edit handlers extraits dans useBulkEdit (D4 du split C1-v2).
  // uploadFiles + handleFileSelect extraits dans MediaAssetsUploadModal (D7).

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
        <a
          href={selectMode ? undefined : asset.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { if (selectMode) e.preventDefault(); else e.stopPropagation(); }}
          className="relative w-8 h-12 rounded overflow-hidden shrink-0 bg-gray-100 block"
        >
          <LazyVideoThumb url={asset.url} className="w-full h-full object-cover" />
          {asset.pendingEditJob && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none">
              <Loader2 size={10} className="text-white animate-spin" />
            </div>
          )}
          {selectMode && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              {isSelected ? <CheckSquare size={12} className="text-white" /> : <Square size={12} className="text-white/70" />}
            </div>
          )}
        </a>
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
          <a href={asset.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-700 truncate hover:text-indigo-600 hover:underline block" title={asset.filename}>{asset.filename}</a>
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {asset.tags.map((t) => <span key={t} className="text-[9px] bg-indigo-50 text-indigo-500 border border-indigo-100 px-1 rounded">{t}</span>)}
            </div>
          )}
        </div>
        {/* Metadata fields — compact read-only display */}
        {metadataSchema.length > 0 && Object.keys(asset.metadata ?? {}).length > 0 && (
          <div className="flex flex-col gap-0.5 shrink-0 text-[9px] text-gray-500 max-w-[80px]" onClick={(e) => e.stopPropagation()}>
            {metadataSchema.map((field) => {
              const value = asset.metadata?.[field.key];
              if (value === null || value === undefined || value === "") return null;
              return (
                <span key={field.key} className="truncate" title={`${field.label} : ${String(value)}`}>
                  <span className="text-gray-300">{field.label.slice(0, 6)}·</span>{String(value)}
                </span>
              );
            })}
          </div>
        )}
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


  // D9-step2 — renderVideoCard extrait dans MediaAssetsVideoCard.
  // Le wrapper local fournit un closure stable des props (inline hook,
  // bulk, accountFilter, etc.) sans propager 12+ props à chaque call site
  // dans la vue grid (`.map((a) => renderVideoCard(a))`).
  function renderVideoCard(asset: MediaAsset) {
    return (
      <MediaAssetsVideoCard
        key={asset.id}
        asset={asset}
        assets={assets}
        accounts={accounts}
        accountFilter={accountFilter}
        metadataSchema={metadataSchema}
        selectMode={selectMode}
        selectedIds={selectedIds}
        toggleSelect={toggleSelect}
        previewId={previewId}
        setPreviewId={setPreviewId}
        onEditAsset={setEditingAsset}
        inline={inline}
      />
    );
  }

  function renderColumn({ key, setTag, category, groupAssets, accessibleCount, lastUsed, autoRank, cycleSize, isAccessible = true, inSection = false, fluid = false }: { key: string; setTag: string | null; category: string | null; groupAssets: MediaAsset[]; accessibleCount?: number; lastUsed: string | null; autoRank: number | null; cycleSize?: number | null; isAccessible?: boolean; inSection?: boolean; fluid?: boolean }): React.ReactNode {
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
      <div key={key || "__unset__"} className={`flex flex-col ${fluid ? "w-full" : "w-52 shrink-0"} ${!isAccessible && accountFilter ? "opacity-50" : ""}`}>
        {/* Column header */}
        <div className={`mb-2 p-2.5 rounded-xl border flex flex-col gap-1 ${!isAccessible && accountFilter ? "bg-gray-50 border-dashed border-gray-300" : "bg-gray-50 border-gray-200"}`}>
          {!isAccessible && accountFilter && (
            groupAssets.every((a) => a.disabled)
              ? <span className="text-[9px] text-red-400 flex items-center gap-0.5 mb-0.5"><AlertTriangle size={8} /> Set désactivé — bloque la rotation</span>
              : <span className="text-[9px] text-gray-400 flex items-center gap-0.5 mb-0.5"><Lock size={8} /> Hors accès pour ce compte</span>
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
                  <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <RotateCcw size={9} /> {autoRank != null ? `Dans ${autoRank - 1} gén.` : "–"}
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
    <div className={`relative${selectMode ? " pb-20" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{library.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {assets.length} fichier{assets.length !== 1 ? "s" : ""} · {isVideo ? "Vidéos" : "Musiques"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isVideo && (
            <button
              onClick={() => setShowAtelier(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
            >
              <Wand2 size={14} /> Analyse auto
            </button>
          )}
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            <Upload size={14} /> {isVideo ? "Ajouter des vidéos" : "Ajouter des musiques"}
          </button>
        </div>
      </div>

      {/* Reset error */}
      {resetError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{resetError}</div>
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
                  onClick={() => setViewMode("rotation")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${viewMode === "rotation" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  title="Vue rotation — ordre de passage des sets"
                >
                  <RotateCcw size={13} /> Rotation
                </button>
              </div>
            )}
            {isVideo && (
              <>
                <div className="w-px h-5 bg-gray-200 self-center" />
                <button
                  onClick={() => { if (selectMode) { exitSelectMode(); } else { setSelectMode(true); } }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg transition-colors ${
                    selectMode
                      ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                      : "border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                >
                  <CheckSquare size={13} />
                  {selectMode ? "Sélection active" : "Sélectionner"}
                </button>
              </>
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

      {/* D8 — bulk action bar extraite dans MediaAssetsBulkActionBar */}
      {selectMode && <MediaAssetsBulkActionBar bulk={bulk} filtered={filtered} accounts={accounts} />}

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
          <p className="text-xs text-gray-400 mt-2 mb-4">Uploadez votre premier fichier ou glissez-déposez directement sur cette page.</p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            <Upload size={14} /> {isVideo ? "Ajouter des vidéos" : "Ajouter des musiques"}
          </button>
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
            <MediaAssetsRotationView
              groupedBySetTag={groupedBySetTag}
              seqState={seqState}
              accountFilter={accountFilter}
              visibleGroupCount={visibleGroupCount}
              groupSentinelRef={groupSentinelRef}
              saveSequence={saveSequence}
              moveSetTag={moveSetTag}
              addToSequence={addToSequence}
              removeFromSequence={removeFromSequence}
              renderCompactCard={renderCompactCard}
            />
          ) : viewMode === "grouped" ? (
            <MediaAssetsGroupedView
              groupedBySetTag={groupedBySetTag}
              sectionsByGroup={sectionsByGroup}
              seqState={seqState}
              accountFilter={accountFilter}
              assets={assets}
              saveSequence={saveSequence}
              renderColumn={renderColumn}
              renderCompactCard={renderCompactCard}
            />
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {visibleFiltered.map((asset) => renderVideoCard(asset))}
              </div>
              <div ref={gridSentinelRef} />
            </>
          )}
        </>
      ) : (
        <MediaAssetsAudioList
          assets={visibleFiltered}
          accountFilter={accountFilter}
          editingUsageId={editingUsageId}
          usageInput={usageInput}
          setEditingUsageId={setEditingUsageId}
          setUsageInput={setUsageInput}
          handleSaveUsage={handleSaveUsage}
          editingTagsId={editingTagsId}
          tagInput={tagInput}
          setEditingTagsId={setEditingTagsId}
          setTagInput={setTagInput}
          handleSaveTags={handleSaveTags}
          handleResetAssetUsage={handleResetAssetUsage}
          handleDelete={handleDelete}
        />
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
      {showAtelier && (
        <MediaBatchAutocutPanel
          library={library}
          knownTags={allTags}
          onClose={() => setShowAtelier(false)}
        />
      )}

      {/* ── Upload modal (D7 — extraite dans MediaAssetsUploadModal) ── */}
      <MediaAssetsUploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        library={library}
        accounts={accounts}
        onUploaded={() => void load()}
      />
    </div>
  );
}

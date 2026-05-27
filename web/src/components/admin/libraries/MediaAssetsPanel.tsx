"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Upload, Play, Music2 } from "lucide-react";
import { useConfirm } from "@/components/ui/useConfirm";
import { MediaAssetEditModal } from "./MediaAssetEditModal";
import { MediaBatchAutocutPanel } from "./MediaBatchAutocutPanel";
import type { MediaAsset, MetadataField, MediaLibrary, SortKey } from "./mediaAssets/types";
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
import { MediaAssetsGroupColumn } from "./mediaAssets/MediaAssetsGroupColumn";
import { MediaAssetsCompactCard } from "./mediaAssets/MediaAssetsCompactCard";
import { MediaAssetsToolbar } from "./mediaAssets/MediaAssetsToolbar";
import { useAssetSequence } from "./mediaAssets/useAssetSequence";

interface Props {
  library: MediaLibrary;
}

export function MediaAssetsPanel({ library }: Props) {
  // P1.1 — confirmation asynchrone partagée par useBulkEdit + useAssetInlineEdits.
  const { confirm, dialog: confirmDialog } = useConfirm();
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
  const bulk = useBulkEdit({ libraryId: library.id, setAssets, accounts, confirm });
  const { selectMode, setSelectMode, selectedIds, toggleSelect, exitSelectMode } = bulk;
  const { seqState, saveSequence, moveSetTag, addToSequence, removeFromSequence } = useAssetSequence({
    libraryId: library.id,
    initialSequence: library.setSequence,
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
    confirm,
  });
  // D9 — destructure réduit aux symboles encore consommés directement
  // par le panel (audio list inline editing + group category bulk edit
  // utilisé dans le wrapper renderColumn). Les cards/vues isolées
  // consomment le hook complet via la prop `inline`.
  const {
    editingTagsId, setEditingTagsId,
    tagInput, setTagInput,
    editingUsageId, setEditingUsageId,
    usageInput, setUsageInput,
    editingFamilyKey, setEditingFamilyKey,
    familyInput, setFamilyInput,
    resetError,
    handleSaveCategoryForGroup,
    handleSaveUsage,
    handleResetAssetUsage,
    handleSaveTags,
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

  // D9 — handleSaveCategory, handleToggleAccess, handleToggleDisabled,
  // handleSaveMetadata, handleSaveCategoryForGroup extraits dans le hook
  // useAssetInlineEdits (cf. const inline ci-dessus).
  // D9 — saveSequence + moveSetTag + addToSequence + removeFromSequence
  // extraits dans useAssetSequence (cf. ci-dessus).

  // D9 — handleSaveUsage, handleResetAssetUsage, handleSaveTags,
  // handleSaveSetTag, handleSaveLastUsed, handleDelete, toDateInputValue
  // extraits dans le hook useAssetInlineEdits.
  // ─ Bulk edit handlers extraits dans useBulkEdit (D4 du split C1-v2).
  // uploadFiles + handleFileSelect extraits dans MediaAssetsUploadModal (D7).

  const isVideo = library.type === "video";

  // D9-step4 — renderCompactCard extrait dans MediaAssetsCompactCard.
  // Wrapper closure stable pour le passer en callback aux vues grouped/rotation.
  function renderCompactCard(asset: MediaAsset, opts: { hideCategory?: boolean } = {}): React.ReactNode {
    return (
      <MediaAssetsCompactCard
        key={asset.id}
        asset={asset}
        accountFilter={accountFilter}
        metadataSchema={metadataSchema}
        selectMode={selectMode}
        selectedIds={selectedIds}
        toggleSelect={toggleSelect}
        hideCategory={opts.hideCategory}
        inline={inline}
      />
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

  // D9-step3 — renderColumn extrait dans MediaAssetsGroupColumn.
  // Le wrapper local fournit un closure stable des props (seqState +
  // moveSetTag/addToSequence/removeFromSequence + inline editing
  // catégorie group-level + renderVideoCard callback).
  function renderColumn({ key, setTag, category, groupAssets, accessibleCount, lastUsed, autoRank, isAccessible = true, inSection = false, fluid = false }: { key: string; setTag: string | null; category: string | null; groupAssets: MediaAsset[]; accessibleCount?: number; lastUsed: string | null; autoRank: number | null; cycleSize?: number | null; isAccessible?: boolean; inSection?: boolean; fluid?: boolean }): React.ReactNode {
    return (
      <MediaAssetsGroupColumn
        key={key || "__unset__"}
        groupKey={key}
        setTag={setTag}
        category={category}
        groupAssets={groupAssets}
        accessibleCount={accessibleCount}
        lastUsed={lastUsed}
        autoRank={autoRank}
        isAccessible={isAccessible}
        inSection={inSection}
        fluid={fluid}
        seqState={seqState}
        accountFilter={accountFilter}
        editingFamilyKey={editingFamilyKey}
        setEditingFamilyKey={setEditingFamilyKey}
        familyInput={familyInput}
        setFamilyInput={setFamilyInput}
        handleSaveCategoryForGroup={handleSaveCategoryForGroup}
        moveSetTag={moveSetTag}
        addToSequence={addToSequence}
        removeFromSequence={removeFromSequence}
        renderVideoCard={renderVideoCard}
      />
    );
  }

  return (
    <div className={`relative${selectMode ? " pb-20" : ""}`}>
      <MediaAssetsToolbar
        library={library}
        isVideo={isVideo}
        loading={loading}
        assetsCount={assets.length}
        accounts={accounts}
        allTags={allTags}
        onOpenUpload={() => setShowUploadModal(true)}
        onOpenAtelier={() => setShowAtelier(true)}
        resetError={resetError}
        search={search}
        setSearch={setSearch}
        sort={sort}
        setSort={setSort}
        tagFilter={tagFilter}
        setTagFilter={setTagFilter}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        viewMode={viewMode}
        setViewMode={setViewMode}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        exitSelectMode={exitSelectMode}
      />

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
      {confirmDialog}
    </div>
  );
}

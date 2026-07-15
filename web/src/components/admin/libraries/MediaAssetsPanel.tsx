"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Play, Music2, ChevronLeft, Settings2, Film, Headphones } from "lucide-react";
import { MediaLibrarySettingsDrawer } from "./MediaLibrarySettingsDrawer";
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
import { MediaAssetsBulkSortDrawer } from "./mediaAssets/MediaAssetsBulkSortDrawer";
import { MediaAssetDetailDrawer } from "./mediaAssets/MediaAssetDetailDrawer";
import { MediaAssetsTable } from "./mediaAssets/list/MediaAssetsTable";
// MediaAssetsNextGenPreview + MediaAssetsKpiRow drop I.2 — info redondante remontée dans le strip header.
import { EmptyState } from "@/components/ui/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { type CategoryFilter } from "./mediaAssets/MediaAssetsCategoriesSidebar";
import { useAssetSequence } from "./mediaAssets/useAssetSequence";
import { useAdvancedMode } from "@/hooks/useAdvancedMode";

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
  // ne garde que l'open/close + un drop-zone page-level qui ouvre la modal
  // pré-remplie avec les fichiers déposés.
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [tagFilter, setTagFilter] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [showAtelier, setShowAtelier] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "grouped" | "rotation">("grid");
  // Phase 2 médiathèque — toggle "Réglages avancés" (default OFF = mode noob).
  // Quand OFF : viewMode forcé en "grouped" (vue Catégories), filtre tag caché,
  // édition inline rapide non-prioritaire. Le state viewMode local reste pour
  // que l'user retrouve son dernier choix en réactivant le mode avancé.
  const { isAdvanced, toggleAdvanced } = useAdvancedMode(library.id);
  // Mode manuel (rotation = "none") : la lib n'utilise pas la rotation auto.
  // Les assets sont sélectionnés par metadata côté générateur — pas de notion
  // de catégorie/pack/orphelin/prochaine génération.
  const isManualMode = library.rotationMode === "none";
  // Force vue "grid" en manual (Catégories n'a pas de sens sans rotation).
  const effectiveViewMode = isManualMode ? "grid" : isAdvanced ? viewMode : "grouped";
  const [sortDrawerOpen, setSortDrawerOpen] = useState(false);
  // Phase 3 — drawer détail asset (ouvert en mode noob via click sur card).
  const [detailAsset, setDetailAsset] = useState<MediaAsset | null>(null);
  // Si le drawer a été ouvert depuis une stack (set), on garde la liste des assets du set
  // pour permettre de naviguer entre eux sans fermer/rouvrir le drawer.
  const [detailSetAssets, setDetailSetAssets] = useState<MediaAsset[] | null>(null);
  // Phase B — filtre catégorie depuis la sidebar (mode noob uniquement).
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  // F2.3 — Count des jobs autocut en attente de review (badge sur "Analyse auto").
  const [autocutPendingCount, setAutocutPendingCount] = useState(0);
  // D4 — bulk edit extrait dans useBulkEdit hook. La sticky bar D8
  // (MediaAssetsBulkActionBar) consomme l'objet `bulk` complet. Le panel
  // garde l'accès à selectMode/selectedIds/toggleSelect pour les cards.
  const bulk = useBulkEdit({ libraryId: library.id, setAssets, accounts, confirm });
  const { selectMode, setSelectMode, selectedIds, toggleSelect, exitSelectMode } = bulk;
  const { seqState, saveSequence, moveSetTag, addToSequence, removeFromSequence } = useAssetSequence({
    libraryId: library.id,
    initialSequence: library.setSequence,
  });
  // ── Ordre de rotation (source serveur — applique buildBurnFilter / maxUsageCount) ──
  // La simulation côté client (avant le fix 2026-06-11) ignorait `maxUsageCount`
  // de MediaLibrary → preview désynchronisée. On délègue maintenant au resolver
  // via /simulate-rotation pour avoir une source unique de vérité.
  const [rotationOrder, setRotationOrder] = useState<Map<string, { autoRank: number; cycleSize: number }> | null>(null);
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

  // Phase 2 — assets orphelins (sans catégorie) + catégories existantes pour
  // le ribbon "X fichiers à ranger" et le drawer bulk-sort.
  const orphanAssets = useMemo(
    () => assets.filter((a) => !a.category),
    [assets],
  );
  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => {
      if (a.category) set.add(a.category);
    });
    return Array.from(set).sort();
  }, [assets]);
  // Phase 3 — packs nommés explicitement (exclus les pack_<random> auto).
  const existingPacks = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => {
      if (a.setTag && !a.setTag.startsWith("pack_")) set.add(a.setTag);
    });
    return Array.from(set).sort();
  }, [assets]);

  // Re-sync detailAsset si l'asset a été mis à jour dans la liste (optimistic).
  const liveDetailAsset = useMemo(
    () => (detailAsset ? assets.find((a) => a.id === detailAsset.id) ?? null : null),
    [detailAsset, assets],
  );

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

  // F2.3 — Fetch le count des jobs autocut en attente de review (badge sur
  // "Analyse auto"). Refresh à chaque fermeture de l'atelier (où l'admin
  // peut avoir validé/passé des jobs). Pas de fetch pour les bibliothèques
  // audio (pas d'autocut).
  useEffect(() => {
    if (library.type !== "video") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/libraries/media/${library.id}/autocut-queue?reviewStatus=pending_review&pageSize=1&lean=1`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { total?: number };
        if (!cancelled) setAutocutPendingCount(data.total ?? 0);
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, [library.id, library.type, showAtelier]);

  // ESC handler géré dans MediaAssetsUploadModal (D7).

  // ─ Liste des comptes Instagram chargée via useInstagramAccounts hook.

  // Phase B — filtre catégorie depuis la sidebar (avant search/tagFilter).
  // En mode avancé, categoryFilter reste "all" donc no-op.
  const categoryFilteredAssets = useMemo(() => {
    if (categoryFilter === "all") return assets;
    if (categoryFilter === "orphans") return assets.filter((a) => !a.category);
    if (categoryFilter === "disabled") return assets.filter((a) => a.disabled);
    return assets.filter((a) => a.category === categoryFilter.category);
  }, [assets, categoryFilter]);

  // filteredPreTag = recherche texte uniquement, sans le filtre tag.
  // Utilisé pour allTags/allSetTags afin que les chips de tags restent
  // visibles même quand un tag est actif.
  const filteredPreTag = useMemo(() => {
    if (!search.trim()) return categoryFilteredAssets;
    const q = search.toLowerCase();
    return categoryFilteredAssets.filter((a) => a.filename.toLowerCase().includes(q));
  }, [categoryFilteredAssets, search]);

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
  // Ids de TOUT l'ensemble filtré (indépendant de la fenêtre d'infinite-scroll)
  // — le select-all de la vue liste doit porter sur ces ids, pas sur les 48
  // rendus, pour rester cohérent avec le compteur du header et éviter un bulk
  // delete silencieusement partiel.
  const allFilteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);

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

  // Hash compact des champs qui affectent la rotation c\u00f4t\u00e9 serveur. Sert de
  // dep au useEffect ci-dessous \u2192 refetch automatiquement apr\u00e8s toute mutation
  // locale (cr\u00e9ation, suppression, changement de setTag/category, toggle
  // disabled, modif d'acc\u00e8s, reset usage). \u00c9vite \u00e0 l'admin de recharger la
  // page apr\u00e8s chaque \u00e9dition. Ordre stable (assets est tri\u00e9 en amont par
  // useMediaAssetsLoader) \u2014 pas besoin de re-trier ici.
  const assetsRotationHash = useMemo(() => {
    return assets
      .map(
        (a) =>
          `${a.id}:${a.setTag ?? ""}:${a.category ?? ""}:${a.disabled ? 1 : 0}:${a.accessAccountIds.join(",")}:${a.usageCount}`,
      )
      .join("|");
  }, [assets]);

  // Fetch l'ordre de rotation depuis /simulate-rotation \u00e0 chaque changement
  // de compte filtr\u00e9, s\u00e9quence, rotationScope, maxUsageCount, OU mutation
  // d'assets pertinente (via assetsRotationHash). Le serveur applique le
  // resolver r\u00e9el (avec buildBurnFilter) \u2192 preview fid\u00e8le au prod, y compris
  // pour maxUsageCount. Sans compte s\u00e9lectionnable on d\u00e9grade \u00e0 null (la UI
  // affiche un placeholder neutre via NextGenPreview).
  useEffect(() => {
    const shouldSkip =
      isManualMode ||
      (!accountFilter && library.rotationScope !== "shared");
    const accountParam = accountFilter ?? accounts[0]?.id; // shared : n'importe quel compte
    const ctrl = new AbortController();
    void (async () => {
      if (shouldSkip || !accountParam) {
        setRotationOrder(null);
        return;
      }
      try {
        const res = await fetch(
          `/api/admin/libraries/media/${library.id}/simulate-rotation?accountId=${encodeURIComponent(accountParam)}`,
          { cache: "no-store", signal: ctrl.signal }
        );
        if (!res.ok) { setRotationOrder(null); return; }
        const payload = (await res.json()) as {
          ordered?: Array<{ rank: number; setTag: string | null; category: string | null }>;
          cycleSize?: number;
        };
        const ordered = Array.isArray(payload.ordered) ? payload.ordered : [];
        const cycleSize = typeof payload.cycleSize === "number" ? payload.cycleSize : ordered.length;
        const map = new Map<string, { autoRank: number; cycleSize: number }>();
        for (const item of ordered) {
          if (typeof item.rank !== "number") continue;
          map.set(toGroupKey(item.category, item.setTag), { autoRank: item.rank, cycleSize });
        }
        setRotationOrder(map);
      } catch {
        // Aborted (component unmount / d\u00e9ps chang\u00e9es) ou erreur r\u00e9seau \u2014 on
        // d\u00e9grade gracieusement vers "pas d'ordre disponible". L'UI affichera
        // les groupes sans badge autoRank, ce qui reste lisible.
        setRotationOrder(null);
      }
    })();
    return () => ctrl.abort();
  }, [library.id, library.rotationScope, library.maxUsageCount, accountFilter, seqState, accounts, isManualMode, assetsRotationHash]);

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

    // L'ordre + autoRank/cycleSize sont fournis par /simulate-rotation (le
    // resolver serveur). Ici on se contente de regrouper et d'attacher le
    // rank par lookup. Plus de simulation locale — voir useEffect ci-dessus.
    const allEntries: GroupItem[] = Array.from(groups.entries()).map(([key, groupAssets]) => {
      const { category, setTag } = fromGroupKey(key);
      const isAccessible = !accountFilter || groupAssets.some(
        (a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
      );
      const accessibleCount = accountFilter
        ? groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))).length
        : groupAssets.filter((a) => !a.disabled).length;
      const ranked = rotationOrder?.get(key) ?? null;
      return {
        key,
        setTag,
        category,
        groupAssets,
        accessibleCount,
        lastUsed: getLastUsed(groupAssets),
        groupCreatedAt: getGroupCreatedAt(groupAssets),
        autoRank: ranked?.autoRank ?? null,
        cycleSize: ranked?.cycleSize ?? null,
        isAccessible,
      };
    });

    const named = allEntries.filter((g) => g.setTag || g.category);
    const unnamed = allEntries.filter((g) => !g.setTag && !g.category);

    // Tri : groupes avec autoRank (= participent à la rotation côté serveur)
    // en tête, ordonnés par rank ASC. Le reste suit, named puis unnamed,
    // avec tiebreak alphabétique numeric-aware sur setTag (parité avec le
    // SQL LPAD du resolver).
    const tiebreakSetTag = (a: GroupItem, b: GroupItem): number => {
      const na = parseInt(a.setTag ?? "", 10);
      const nb = parseInt(b.setTag ?? "", 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return (a.setTag ?? "").localeCompare(b.setTag ?? "");
    };
    const sortedNamed = [...named].sort((a, b) => {
      if (a.autoRank != null && b.autoRank != null) return a.autoRank - b.autoRank;
      if (a.autoRank != null) return -1;
      if (b.autoRank != null) return 1;
      return tiebreakSetTag(a, b);
    });

    // En filtre par compte, on masque les groupes inaccessibles sauf ceux
    // qui occupent un slot du setSequence (mode override) — l'admin doit
    // pouvoir les retirer de la séquence depuis l'UI.
    if (accountFilter) {
      const visibleNamed = sortedNamed.filter(
        (g) => g.isAccessible || (g.setTag != null && seqState.includes(g.setTag))
      );
      const visibleUnnamed = unnamed.filter((g) => g.isAccessible);
      return [...visibleNamed, ...visibleUnnamed];
    }
    return [...sortedNamed, ...unnamed];
  }, [filtered, accountFilter, rotationOrder, seqState]);

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
  // Mode noob vidéo (hors manual) → nouvelle vue liste dense + détail (drawer).
  // Le mode avancé conserve les vues grille/groupé/rotation.
  const useListView = !isAdvanced && isVideo && !isManualMode;
  // I.2 — Drawer settings accessible depuis le strip header.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // I.2 — Counts compacts inline (remplace la KpiRow lourde).
  const stripCounts = useMemo(() => {
    const cats = new Set<string>();
    const groups = new Set<string>();
    let orphans = 0;
    for (const a of assets) {
      if (a.category) cats.add(a.category);
      else orphans++;
      if (a.setTag && !a.setTag.startsWith("pack_")) groups.add(a.setTag);
    }
    return {
      total: assets.length,
      categories: cats.size,
      groups: groups.size,
      orphans,
    };
  }, [assets]);

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
        isAdvanced={isAdvanced}
        isManualMode={isManualMode}
        onOpenDetail={setDetailAsset}
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

  // ── Page-level drag-drop ─────────────────────────────────────────────
  // Permet de déposer des fichiers n'importe où sur le panel ; ouvre la modal
  // pré-remplie et lance l'upload automatiquement. dragDepthRef évite que les
  // enfants déclenchent un dragleave (compteur d'entrées).
  const isVideoLib = library.type === "video";
  function handlePageDragOver(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setPageDragOver(true);
  }
  function handlePageDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    setPageDragOver(true);
  }
  function handlePageDragLeave() {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setPageDragOver(false);
  }
  function handlePageDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepthRef.current = 0;
    setPageDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      isVideoLib ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
    );
    if (files.length === 0) return;
    setPendingFiles(files);
    setShowUploadModal(true);
  }

  return (
    <div
      className={`relative flex flex-col h-full${selectMode ? " pb-20" : ""}`}
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {pageDragOver && !showUploadModal && (
        <div className={`fixed inset-0 z-40 flex items-center justify-center pointer-events-none ${
          isVideo ? "bg-info-200/15" : "bg-success-200/15"
        } `}>
          <div className={`rounded-2xl px-6 py-4 bg-card border border-border  text-sm font-medium ${
            isVideo ? "text-info-700" : "text-success-700"
          }`}>
            Déposer les fichiers dans <span className="font-semibold text-foreground">{library.name}</span>
          </div>
        </div>
      )}

      {/* I.2 — Strip header compact (60px total : 40px ligne 1 + 20px ligne 2) */}
      <header className="shrink-0 sticky top-0 z-20 bg-card border-b border-border">
        <div className="px-4 sm:px-6 py-2 flex items-center gap-3">
          <Link
            href={isVideo ? "/admin/libraries/media" : "/admin/libraries/audio"}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            title={isVideo ? "Retour aux bibliothèques vidéo" : "Retour aux bibliothèques audio"}
          >
            <ChevronLeft size={12} />
            <span className="hidden sm:inline">{isVideo ? "Vidéo" : "Audio"}</span>
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground truncate">
            {isVideo ? <Film size={13} className="text-muted-foreground" /> : <Headphones size={13} className="text-muted-foreground" />}
            {library.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={Settings2}
            onClick={() => setSettingsOpen(true)}
            title="Réglages de la bibliothèque"
            className="ml-auto"
          >
            <span className="hidden sm:inline">Réglages</span>
          </Button>
        </div>
        <div className="px-4 sm:px-6 pb-1.5 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>{stripCounts.total} {isVideo ? "vidéo" : "asset"}{stripCounts.total !== 1 ? "s" : ""}</span>
          {!isManualMode && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className="hover:text-foreground transition-colors"
              >
                {stripCounts.categories} catégorie{stripCounts.categories !== 1 ? "s" : ""}
              </button>
              <span className="text-muted-foreground/40">·</span>
              <span>{stripCounts.groups} groupe{stripCounts.groups !== 1 ? "s" : ""}</span>
              {stripCounts.orphans > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter("orphans")}
                    className="text-warning-700 hover:underline"
                    title="Filtrer les assets sans catégorie"
                  >
                    {stripCounts.orphans} orphelin{stripCounts.orphans !== 1 ? "s" : ""}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">

      <MediaAssetsToolbar
        library={library}
        isVideo={isVideo}
        loading={loading}
        assetsCount={assets.length}
        accounts={accounts}
        allTags={allTags}
        onOpenUpload={() => setShowUploadModal(true)}
        onOpenAtelier={() => setShowAtelier(true)}
        autocutPendingCount={autocutPendingCount}
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
        isAdvanced={isAdvanced}
        onToggleAdvanced={toggleAdvanced}
      />

      {/* Phase α — espace toolbar ↔ contenu. */}
      <div className="mt-5">
        {/* Ribbon orphelins retiré (trop bruyant). Filtre "Sans catégorie" reste accessible via la sidebar. */}

        {/* D8 — bulk action bar extraite dans MediaAssetsBulkActionBar */}
        {selectMode && <MediaAssetsBulkActionBar bulk={bulk} filtered={filtered} accounts={accounts} />}
      </div>

      {/* Vue principale pleine largeur (la sidebar catégories noob est remplacée
          par la vue liste dense + drawer détail). */}
      <div>
        <div>

      {/* Error — Alert primitive Coastal Studio (W4) */}
      {loadError && (
        <Alert
          variant="danger"
          title="Impossible de charger les assets"
          actions={
            <Button variant="secondary" size="sm" onClick={() => { void load(); }}>
              Réessayer
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-info-200 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          icon={isVideo ? Play : Music2}
          title={isVideo ? "Aucune vidéo encore" : "Aucune piste audio encore"}
          description="Glisse tes fichiers directement sur cette page, ou clique ci-dessous pour ouvrir l'uploader."
          cta={{
            label: isVideo ? "Ajouter des vidéos" : "Ajouter des musiques",
            onClick: () => setShowUploadModal(true),
          }}
        />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
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
          {useListView ? (
            <>
              <MediaAssetsTable
                assets={visibleFiltered}
                allFilteredIds={allFilteredIds}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                setSelectedIds={bulk.setSelectedIds}
                onOpenDetail={setDetailAsset}
                sort={sort}
                setSort={setSort}
                sentinelRef={gridSentinelRef}
              />
              {visibleFiltered.length < filtered.length && (
                <p className="mt-2 text-[11px] text-muted-foreground text-center tabular-nums">
                  {visibleFiltered.length} affichés sur {filtered.length} · fais défiler pour charger la suite
                </p>
              )}
            </>
          ) : effectiveViewMode === "rotation" ? (
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
          ) : effectiveViewMode === "grouped" ? (
            <>
            <MediaAssetsGroupedView
              groupedBySetTag={groupedBySetTag}
              sectionsByGroup={sectionsByGroup}
              seqState={seqState}
              accountFilter={accountFilter}
              assets={assets}
              saveSequence={saveSequence}
              renderColumn={renderColumn}
              renderCompactCard={renderCompactCard}
              isAdvanced={isAdvanced}
              onOpenSet={(g) => {
                // Ouvre le drawer détail sur le 1er asset du set + passe la liste
                // pour permettre de naviguer entre les assets via le set navigator.
                const sorted = [...g.groupAssets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                const first = sorted[0];
                if (first) {
                  setDetailSetAssets(sorted);
                  setDetailAsset(first);
                }
              }}
            />
            </>
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
        </div>
      </div>
      </div>
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
        onClose={() => { setShowUploadModal(false); setPendingFiles(null); }}
        library={library}
        accounts={accounts}
        onUploaded={() => void load()}
        initialFiles={pendingFiles}
        onInitialFilesConsumed={() => setPendingFiles(null)}
      />
      {/* Phase 2 — bulk-sort drawer pour ranger les assets orphelins en 1 décision. */}
      <MediaAssetsBulkSortDrawer
        open={sortDrawerOpen}
        onClose={() => setSortDrawerOpen(false)}
        libraryId={library.id}
        orphanAssets={orphanAssets}
        existingCategories={existingCategories}
        onApplied={() => void load()}
      />
      {/* Phase 3 — drawer détail asset (édition complète en mode noob).
          setAssets : si ouvert via une stack, la liste des autres vidéos du set pour navigation. */}
      <MediaAssetDetailDrawer
        open={liveDetailAsset !== null}
        onClose={() => { setDetailAsset(null); setDetailSetAssets(null); }}
        asset={liveDetailAsset}
        metadataSchema={metadataSchema}
        existingCategories={existingCategories}
        existingPacks={existingPacks}
        accounts={accounts}
        inline={inline}
        onOpenTrim={(a) => setEditingAsset(a)}
        setAssets={detailSetAssets ?? undefined}
        onSwitchAsset={(a) => setDetailAsset(a)}
      />
      {/* I.2 — Drawer settings (refondu en tabs en H.4) accessible depuis le strip header. */}
      <MediaLibrarySettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        library={{
          id: library.id,
          name: library.name,
          description: null,
          tags: "[]",
          setSequence: library.setSequence ?? "[]",
          rotationScope: library.rotationScope ?? "per_account",
          rotationMode: library.rotationMode,
          metadataSchema: library.metadataSchema ?? "[]",
          maxUsageCount: library.maxUsageCount,
        }}
        onUpdated={() => { void load(); }}
      />
      {confirmDialog}
    </div>
  );
}

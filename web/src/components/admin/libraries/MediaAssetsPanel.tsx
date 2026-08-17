"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Play, Music2, ChevronLeft, Settings2, Film, Headphones } from "lucide-react";
import { MediaLibrarySettingsDrawer } from "./MediaLibrarySettingsDrawer";
import { useConfirm } from "@/components/ui/useConfirm";
import { MediaAssetEditModal } from "./MediaAssetEditModal";
import { MediaBatchAutocutPanel } from "./MediaBatchAutocutPanel";
import type { MediaAsset, MetadataField, MediaLibrary, SetGroup, SortKey } from "./mediaAssets/types";
import { useMediaAssetsLoader } from "./mediaAssets/useMediaAssetsLoader";
import { useInstagramAccounts } from "./mediaAssets/useInstagramAccounts";
import { useBulkEdit } from "./mediaAssets/useBulkEdit";
import { MediaAssetsUploadModal } from "./mediaAssets/MediaAssetsUploadModal";
import { MediaAssetsBulkActionBar } from "./mediaAssets/MediaAssetsBulkActionBar";
import { MediaAssetsGroupedView } from "./mediaAssets/MediaAssetsGroupedView";
import { MediaAssetsAudioList } from "./mediaAssets/MediaAssetsAudioList";
import { useAssetInlineEdits } from "./mediaAssets/useAssetInlineEdits";
import { MediaAssetsVideoCard } from "./mediaAssets/MediaAssetsVideoCard";
import { MediaAssetsGroupColumn } from "./mediaAssets/MediaAssetsGroupColumn";
import { MediaAssetsToolbar } from "./mediaAssets/MediaAssetsToolbar";
import { MediaAssetDetailDrawer } from "./mediaAssets/MediaAssetDetailDrawer";
import { MediaAssetsTable } from "./mediaAssets/list/MediaAssetsTable";
// MediaAssetsNextGenPreview + MediaAssetsKpiRow drop I.2 — info redondante remontée dans le strip header.
import { EmptyState } from "@/components/ui/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useAdvancedMode } from "@/hooks/useAdvancedMode";
import { isReservedSetTag } from "@/lib/rotation/sentinels";
import {
  MediaLibraryPermissionsProvider,
  useMediaLibraryPermissions,
} from "./mediaAssets/mediaLibraryPermissions";

interface Props {
  library: MediaLibrary;
  /**
   * Gestion asset-level (upload, édition, tags, suppression, analyse auto).
   * ADMIN + VIDEASTE. Un MONTEUR consulte et télécharge sans jamais modifier.
   * Défaut false = least-privilege.
   */
  canManageAssets?: boolean;
  /**
   * Gestion library-level (réglages de la bibliothèque). Réservé ADMIN : un
   * VIDEASTE gère les assets mais pas les réglages de la librairie.
   * Défaut false = least-privilege.
   */
  canManageLibraries?: boolean;
}

/**
 * Wrapper : pose le contexte de permissions, puis rend le panel.
 *
 * Le découpage est nécessaire — `MediaAssetsPanelInner` consomme le contexte
 * dans ses hooks (`useAssetInlineEdits`, `useBulkEdit`), et un composant ne
 * peut pas lire un Provider qu'il rend lui-même.
 */
export function MediaAssetsPanel({
  library,
  canManageAssets = false,
  canManageLibraries = false,
}: Props) {
  return (
    <MediaLibraryPermissionsProvider value={{ canManageAssets, canManageLibraries }}>
      <MediaAssetsPanelInner library={library} />
    </MediaLibraryPermissionsProvider>
  );
}

function MediaAssetsPanelInner({ library }: { library: MediaLibrary }) {
  const { canManageAssets, canManageLibraries } = useMediaLibraryPermissions();
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
  const [viewMode, setViewMode] = useState<"grid" | "grouped">("grid");
  // Phase 2 médiathèque — toggle "Réglages avancés" (default OFF = mode noob).
  // Quand OFF : viewMode forcé en "grouped" (vue Dossiers), filtre tag caché,
  // édition inline rapide non-prioritaire. Le state viewMode local reste pour
  // que l'user retrouve son dernier choix en réactivant le mode avancé.
  const { isAdvanced, toggleAdvanced } = useAdvancedMode(library.id);
  // Mode manuel (rotation = "none") : la lib n'utilise pas le tirage auto.
  // Les assets sont sélectionnés par metadata côté générateur — pas de notion
  // de dossier.
  const isManualMode = library.rotationMode === "none";
  // Force vue "grid" en manual (Dossiers n'a pas de sens sans tirage).
  const effectiveViewMode = isManualMode ? "grid" : isAdvanced ? viewMode : "grouped";
  // Phase 3 — drawer détail asset (ouvert en mode noob via click sur card).
  const [detailAsset, setDetailAsset] = useState<MediaAsset | null>(null);
  // Si le drawer a été ouvert depuis une stack (dossier), on garde la liste des assets du
  // dossier pour permettre de naviguer entre eux sans fermer/rouvrir le drawer.
  const [detailSetAssets, setDetailSetAssets] = useState<MediaAsset[] | null>(null);
  // F2.3 — Count des jobs autocut en attente de review (badge sur "Analyse auto").
  const [autocutPendingCount, setAutocutPendingCount] = useState(0);
  // D4 — bulk edit extrait dans useBulkEdit hook. La sticky bar D8
  // (MediaAssetsBulkActionBar) consomme l'objet `bulk` complet. Le panel
  // garde l'accès à selectMode/selectedIds/toggleSelect pour les cards.
  const bulk = useBulkEdit({ libraryId: library.id, setAssets, accounts, confirm });
  const { selectMode, setSelectMode, selectedIds, toggleSelect, exitSelectMode } = bulk;
  // ── Infinite scroll (grille uniquement — la vue "grouped" reste non paginée) ──
  const [visibleCount, setVisibleCount] = useState(48);
  // Sentinel d'infinite-scroll stocké en state via callback ref : l'effet
  // observer se (re)lance quand le nœud se monte réellement — le sentinel est
  // rendu derrière le gate `loading`, donc un observer posé sur `[viewMode]`
  // au montage ratait le nœud (encore null) et ne se rattachait jamais → scroll
  // bloqué à 48. Le callback ref (setter useState, stable) corrige ça.
  const [gridSentinel, setGridSentinel] = useState<HTMLDivElement | null>(null);
  // Refs stables pour le sentinel (mise à jour inline pendant le rendu — pas des hooks)
  const hasPendingRef = useRef(false);
  const visibleCountRef = useRef(0);
  const filteredLengthRef = useRef(0);

  const metadataSchema = useMemo<MetadataField[]>(() => {
    try { return JSON.parse(library.metadataSchema ?? "[]") as MetadataField[]; } catch { return []; }
  }, [library.metadataSchema]);

  // Dossiers nommés explicitement (exclus les pack_<random> auto — legacy).
  const existingPacks = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => {
      if (a.setTag && !isReservedSetTag(a.setTag)) set.add(a.setTag);
    });
    return Array.from(set).sort();
  }, [assets]);

  // Re-sync detailAsset si l'asset a été mis à jour dans la liste (optimistic).
  const liveDetailAsset = useMemo(
    () => (detailAsset ? assets.find((a) => a.id === detailAsset.id) ?? null : null),
    [detailAsset, assets],
  );

  // D9 — inline edits (setTag, tags, usage, lastUsedAt, metadata, access,
  // disabled, delete) extraits dans useAssetInlineEdits hook. Destructuré
  // pour garder les call sites historiques inchangés.
  const inline = useAssetInlineEdits({
    libraryId: library.id,
    setAssets,
    accountFilter,
    metadataSchema,
    confirm,
  });
  // D9 — destructure réduit aux symboles encore consommés directement
  // par le panel (audio list inline editing). Les cards consomment le
  // hook complet via la prop `inline`.
  const {
    editingTagsId, setEditingTagsId,
    tagInput, setTagInput,
    editingUsageId, setEditingUsageId,
    usageInput, setUsageInput,
    resetError,
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
    // Sans droits assets, l'atelier « Analyse auto » n'est pas rendu : inutile
    // d'aller chercher son badge, et la route est de toute façon gatée
    // `canManageMediaAssets` — l'appel ne ferait qu'un 403 silencieux à chaque
    // montage du panel.
    if (!canManageAssets) return;
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
  }, [library.id, library.type, showAtelier, canManageAssets]);

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

  // Reset visible count quand les filtres/tri/bibliothèque/compte changent
  // (pattern "reset state when external data changes" — React docs OK).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(48);
  }, [search, sort, tagFilter, accountFilter, library.id]);

  // Sentinel grille/liste — se (re)lance dès que le nœud sentinel est monté
  // (dep = le nœud lui-même, posé par callback ref). Robuste à la fin du
  // `loading`, au switch de vue et au passage « 0 résultat » → N.
  useEffect(() => {
    if (!gridSentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && visibleCountRef.current < filteredLengthRef.current) {
          setVisibleCount((n) => n + 48);
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(gridSentinel);
    return () => observer.disconnect();
  }, [gridSentinel]);

  // ── Dossiers (groupement par setTag) ──────────────────────────────────
  // Groupe tous les assets filtrés par `setTag` (bucket "" = sans dossier).
  // Le tirage réel (LRU par dossier) est géré côté serveur — cette vue est
  // purement une grille de rangement, pas une preview d'ordre de tirage.
  const groupedBySetTag = useMemo(() => {
    const groups = new Map<string, MediaAsset[]>();
    filtered.forEach((a) => {
      const key = a.setTag ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    });

    // Only use assets accessible to the filtered account when computing last-used date.
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

    const allEntries: SetGroup[] = Array.from(groups.entries()).map(([key, groupAssets]) => {
      const setTag = key || null;
      const isAccessible = !accountFilter || groupAssets.some(
        (a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))
      );
      const accessibleCount = accountFilter
        ? groupAssets.filter((a) => !a.disabled && (a.accessAccountIds.length === 0 || a.accessAccountIds.includes(accountFilter))).length
        : groupAssets.filter((a) => !a.disabled).length;
      return {
        key: key || "__none__",
        setTag,
        groupAssets,
        accessibleCount,
        lastUsed: getLastUsed(groupAssets),
        isAccessible,
      };
    });

    const named = allEntries.filter((g) => g.setTag);
    const unnamed = allEntries.filter((g) => !g.setTag);

    // Tri alphabétique numeric-aware sur setTag (parité avec le LPAD SQL du
    // resolver serveur) — le bucket « sans dossier » reste toujours en dernier.
    const tiebreakSetTag = (a: SetGroup, b: SetGroup): number => {
      const na = parseInt(a.setTag ?? "", 10);
      const nb = parseInt(b.setTag ?? "", 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return (a.setTag ?? "").localeCompare(b.setTag ?? "");
    };
    const sortedNamed = [...named].sort(tiebreakSetTag);

    // En filtre par compte, on masque les dossiers inaccessibles.
    if (accountFilter) {
      const visibleNamed = sortedNamed.filter((g) => g.isAccessible);
      const visibleUnnamed = unnamed.filter((g) => g.isAccessible);
      return [...visibleNamed, ...visibleUnnamed];
    }
    return [...sortedNamed, ...unnamed];
  }, [filtered, accountFilter]);

  // D9 — handleToggleAccess, handleToggleDisabled, handleSaveMetadata
  // extraits dans le hook useAssetInlineEdits (cf. const inline ci-dessus).
  // D9 — handleSaveUsage, handleResetAssetUsage, handleSaveTags,
  // handleSaveSetTag, handleSaveLastUsed, handleDelete, toDateInputValue
  // extraits dans le hook useAssetInlineEdits.
  // ─ Bulk edit handlers extraits dans useBulkEdit (D4 du split C1-v2).
  // uploadFiles + handleFileSelect extraits dans MediaAssetsUploadModal (D7).

  const isVideo = library.type === "video";
  // Mode noob vidéo (hors manual) → nouvelle vue liste dense + détail (drawer).
  // Le mode avancé conserve les vues grille/groupé.
  const useListView = !isAdvanced && isVideo && !isManualMode;
  // I.2 — Drawer settings accessible depuis le strip header.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // I.2 — Counts compacts inline (remplace la KpiRow lourde). Plan
  // simplification 2026-08 : plus de catégories/orphelins, juste le total +
  // le nombre de dossiers.
  const stripCounts = useMemo(() => {
    const folders = new Set<string>();
    for (const a of assets) {
      if (a.setTag && !isReservedSetTag(a.setTag)) folders.add(a.setTag);
    }
    return {
      total: assets.length,
      folders: folders.size,
    };
  }, [assets]);

  // D9-step2 — renderVideoCard extrait dans MediaAssetsVideoCard.
  // Le wrapper local fournit un closure stable des props (inline hook,
  // bulk, accountFilter, etc.) sans propager 12+ props à chaque call site
  // dans la vue grid (`.map((a) => renderVideoCard(a))`).
  function renderVideoCard(asset: MediaAsset) {
    return (
      <MediaAssetsVideoCard
        key={asset.id}
        asset={asset}
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
  // Le wrapper local fournit un closure stable des props (renderVideoCard callback).
  function renderColumn({ key, setTag, groupAssets, accessibleCount, lastUsed, isAccessible = true, fluid = false }: SetGroup & { fluid?: boolean }): React.ReactNode {
    return (
      <MediaAssetsGroupColumn
        key={key || "__unset__"}
        groupKey={key}
        setTag={setTag}
        groupAssets={groupAssets}
        accessibleCount={accessibleCount}
        lastUsed={lastUsed}
        isAccessible={isAccessible}
        fluid={fluid}
        accountFilter={accountFilter}
        renderVideoCard={renderVideoCard}
      />
    );
  }

  // ── Page-level drag-drop ─────────────────────────────────────────────
  // Permet de déposer des fichiers n'importe où sur le panel ; ouvre la modal
  // pré-remplie et lance l'upload automatiquement. dragDepthRef évite que les
  // enfants déclenchent un dragleave (compteur d'entrées).
  // Sans droits assets, le dépôt de fichiers est inerte : pas de surbrillance,
  // pas d'ouverture de modal. On laisse le navigateur reprendre son
  // comportement par défaut plutôt que d'afficher une cible qui ne mène à rien.
  const isVideoLib = library.type === "video";
  function handlePageDragOver(e: React.DragEvent) {
    if (!canManageAssets) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setPageDragOver(true);
  }
  function handlePageDragEnter(e: React.DragEvent) {
    if (!canManageAssets) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    setPageDragOver(true);
  }
  function handlePageDragLeave() {
    if (!canManageAssets) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setPageDragOver(false);
  }
  function handlePageDrop(e: React.DragEvent) {
    if (!canManageAssets) return;
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
          {canManageLibraries && (
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
          )}
        </div>
        <div className="px-4 sm:px-6 pb-1.5 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>{stripCounts.total} {isVideo ? "vidéo" : "asset"}{stripCounts.total !== 1 ? "s" : ""}</span>
          {!isManualMode && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{stripCounts.folders} dossier{stripCounts.folders !== 1 ? "s" : ""}</span>
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
          description={
            canManageAssets
              ? "Glisse tes fichiers directement sur cette page, ou clique ci-dessous pour ouvrir l'uploader."
              : "Cette bibliothèque est vide pour le moment."
          }
          cta={
            canManageAssets
              ? {
                  label: isVideo ? "Ajouter des vidéos" : "Ajouter des musiques",
                  onClick: () => setShowUploadModal(true),
                }
              : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {tagFilter ? `Aucun fichier avec le tag « ${tagFilter} »${search ? ` correspondant à « ${search} »` : ""}.` : `Aucun résultat pour « ${search} ».`}
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
                sentinelRef={setGridSentinel}
              />
              {visibleFiltered.length < filtered.length && (
                <p className="mt-2 text-[11px] text-muted-foreground text-center tabular-nums">
                  {visibleFiltered.length} affichés sur {filtered.length} · fais défiler pour charger la suite
                </p>
              )}
            </>
          ) : effectiveViewMode === "grouped" ? (
            <MediaAssetsGroupedView
              groupedBySetTag={groupedBySetTag}
              accountFilter={accountFilter}
              renderColumn={renderColumn}
              isAdvanced={isAdvanced}
              onOpenSet={(g) => {
                // Ouvre le drawer détail sur le 1er asset du dossier + passe la liste
                // pour permettre de naviguer entre les assets via le set navigator.
                const sorted = [...g.groupAssets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                const first = sorted[0];
                if (first) {
                  setDetailSetAssets(sorted);
                  setDetailAsset(first);
                }
              }}
            />
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {visibleFiltered.map((asset) => renderVideoCard(asset))}
              </div>
              <div ref={setGridSentinel} />
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
      {canManageAssets && editingAsset && (
        <MediaAssetEditModal
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onDone={() => {
            setEditingAsset(null);
            void load();
          }}
        />
      )}
      {canManageAssets && showAtelier && (
        <MediaBatchAutocutPanel
          library={library}
          knownTags={allTags}
          onClose={() => setShowAtelier(false)}
        />
      )}

      {/* Modal mutante : jamais montée sans droits assets — un état résiduel
          (pendingFiles) ne doit pas pouvoir la faire surgir. */}
      {canManageAssets && (
        <>
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
        </>
      )}
      {/* Phase 3 — drawer détail asset (édition complète en mode noob).
          setAssets : si ouvert via une stack, la liste des autres vidéos du dossier pour navigation. */}
      <MediaAssetDetailDrawer
        open={liveDetailAsset !== null}
        onClose={() => { setDetailAsset(null); setDetailSetAssets(null); }}
        asset={liveDetailAsset}
        metadataSchema={metadataSchema}
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
          type: library.type,
          name: library.name,
          description: null,
          tags: "[]",
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

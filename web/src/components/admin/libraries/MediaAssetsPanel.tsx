"use client";

import { useState, useRef, useMemo } from "react";
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
import { useMediaAssetsPolling } from "./mediaAssets/useMediaAssetsPolling";
import { useInfiniteScroll } from "./mediaAssets/useInfiniteScroll";
import { useSetGroups } from "./mediaAssets/useSetGroups";
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
  // D4 — bulk edit extrait dans useBulkEdit hook. La sticky bar D8
  // (MediaAssetsBulkActionBar) consomme l'objet `bulk` complet. Le panel
  // garde l'accès à selectMode/selectedIds/toggleSelect pour les cards.
  const bulk = useBulkEdit({ libraryId: library.id, setAssets, accounts, confirm });
  const { selectMode, setSelectMode, selectedIds, toggleSelect, exitSelectMode } = bulk;

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

  // Job polling (spinner asset en cours d'édition) + badge autocut extraits
  // dans useMediaAssetsPolling (split C1-v2). Le fetch du badge est gaté sur
  // `canManageAssets` — même condition que la visibilité du bouton « Analyse
  // auto » côté Toolbar, donc jamais de fetch pour un badge invisible.
  const { autocutPendingCount } = useMediaAssetsPolling({
    libraryId: library.id,
    libraryType: library.type,
    canManageAssets,
    showAtelier,
    assets,
    setAssets,
  });

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

  // Infinite scroll (grille/liste uniquement — la vue "grouped" reste non
  // paginée) extrait dans useInfiniteScroll (split C1-v2). resetDeps
  // reproduit le tableau de dépendances historique du panel : tout changement
  // remet visibleCount à 48.
  const { visibleCount, setGridSentinel } = useInfiniteScroll(filtered.length, [
    search,
    sort,
    tagFilter,
    accountFilter,
    library.id,
  ]);
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  // Ids de TOUT l'ensemble filtré (indépendant de la fenêtre d'infinite-scroll)
  // — le select-all de la vue liste doit porter sur ces ids, pas sur les 48
  // rendus, pour rester cohérent avec le compteur du header et éviter un bulk
  // delete silencieusement partiel.
  const allFilteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);

  // ── Dossiers (groupement par setTag) — extrait dans useSetGroups (split C1-v2).
  const groupedBySetTag = useSetGroups(filtered, accountFilter);

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
  // Objet dérivé mémoïsé passé au drawer settings : un littéral inline aurait
  // été recréé à CHAQUE render du panel (dont le poll silencieux 5s), ce qui
  // retriggait le useEffect de re-sync du drawer ([library] dep) et
  // réinitialisait les saisies en cours de l'admin (nom, tirage, tags…)
  // pendant qu'il éditait. Dépendances sur les valeurs primitives, pas sur
  // `library` en entier, pour ne recalculer que si une vraie donnée change.
  const settingsLibrary = useMemo(
    () => ({
      id: library.id,
      type: library.type,
      name: library.name,
      description: library.description ?? null,
      tags: library.tags ?? "[]",
      rotationScope: library.rotationScope ?? "per_account",
      rotationMode: library.rotationMode,
      metadataSchema: library.metadataSchema ?? "[]",
      maxUsageCount: library.maxUsageCount,
    }),
    [
      library.id,
      library.type,
      library.name,
      library.description,
      library.tags,
      library.rotationScope,
      library.rotationMode,
      library.metadataSchema,
      library.maxUsageCount,
    ],
  );
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
                  label: isVideo ? "Ajouter des vidéos" : "Ajouter des pistes",
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
              renderColumn={renderColumn}
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
            existingPacks={existingPacks}
            allTags={allTags}
          />
        </>
      )}
      {/* Phase 3 — drawer détail asset (édition complète en mode noob). */}
      <MediaAssetDetailDrawer
        open={liveDetailAsset !== null}
        onClose={() => setDetailAsset(null)}
        asset={liveDetailAsset}
        metadataSchema={metadataSchema}
        existingPacks={existingPacks}
        accounts={accounts}
        inline={inline}
        onOpenTrim={(a) => setEditingAsset(a)}
      />
      {/* I.2 — Drawer settings (refondu en tabs en H.4) accessible depuis le strip header. */}
      <MediaLibrarySettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        library={settingsLibrary}
        onUpdated={() => { void load(); }}
      />
      {confirmDialog}
    </div>
  );
}

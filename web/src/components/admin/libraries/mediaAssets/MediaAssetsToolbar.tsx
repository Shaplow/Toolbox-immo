"use client";

/**
 * MediaAssetsToolbar — header + filters bar du MediaAssetsPanel.
 *
 * Phase D9-step5 du split C1-v2 (plan F1). Extrait l'en-tête (titre +
 * count + boutons upload/atelier), la bannière reset-error, et la barre
 * de filtres (search + sort + view mode + select toggle + account filter
 * + tag filter) en composant standalone.
 *
 * La toolbar n'a aucun state local — tout est piloté par le panel parent
 * via props. C'est volontaire : la toolbar reste un composant "dumb",
 * facile à styliser et à intégrer ailleurs si besoin.
 */

import {
  ArrowUpDown,
  CheckSquare,
  Clock,
  Columns3,
  LayoutGrid,
  RotateCcw,
  Search,
  Tag,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { InstagramAccount, MediaLibrary, SortKey } from "./types";

interface Props {
  library: MediaLibrary;
  isVideo: boolean;
  loading: boolean;
  assetsCount: number;
  accounts: InstagramAccount[];
  allTags: string[];
  // Modals
  onOpenUpload: () => void;
  onOpenAtelier: () => void;
  // Error banner
  resetError: string | null;
  // Filters state
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  sort: SortKey;
  setSort: Dispatch<SetStateAction<SortKey>>;
  tagFilter: string;
  setTagFilter: Dispatch<SetStateAction<string>>;
  accountFilter: string | null;
  setAccountFilter: Dispatch<SetStateAction<string | null>>;
  viewMode: "grid" | "grouped" | "rotation";
  setViewMode: Dispatch<SetStateAction<"grid" | "grouped" | "rotation">>;
  // Select mode
  selectMode: boolean;
  setSelectMode: Dispatch<SetStateAction<boolean>>;
  exitSelectMode: () => void;
}

export function MediaAssetsToolbar({
  library,
  isVideo,
  loading,
  assetsCount,
  accounts,
  allTags,
  onOpenUpload,
  onOpenAtelier,
  resetError,
  search,
  setSearch,
  sort,
  setSort,
  tagFilter,
  setTagFilter,
  accountFilter,
  setAccountFilter,
  viewMode,
  setViewMode,
  selectMode,
  setSelectMode,
  exitSelectMode,
}: Props) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{library.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {assetsCount} fichier{assetsCount !== 1 ? "s" : ""} · {isVideo ? "Vidéos" : "Musiques"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isVideo && (
            <button
              onClick={onOpenAtelier}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
            >
              <Wand2 size={14} /> Analyse auto
            </button>
          )}
          <button
            onClick={onOpenUpload}
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
      {!loading && assetsCount > 0 && (
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
                {/* B7 — Vue groupée (colonnes par setTag) : feature qui existait
                     dans le code (viewMode="grouped") mais sans bouton pour y
                     accéder. Maintenant exposée comme 3e option. */}
                <button
                  onClick={() => setViewMode("grouped")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border-l border-gray-200 transition-colors ${viewMode === "grouped" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  title="Vue groupée — colonnes par set, drag-and-drop pour la séquence"
                >
                  <Columns3 size={13} /> Groupé
                </button>
                <button
                  onClick={() => setViewMode("rotation")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border-l border-gray-200 transition-colors ${viewMode === "rotation" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
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
                  <button onClick={() => setAccountFilter(null)} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                    <X size={10} /> Effacer
                  </button>
                  <span className="text-[10px] text-blue-500 flex items-center gap-0.5 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                    <Clock size={9} /> Stats par compte
                  </span>
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
    </>
  );
}

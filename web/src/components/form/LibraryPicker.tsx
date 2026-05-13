"use client";

import { useEffect, useState } from "react";
import { Music2, Check, X } from "lucide-react";
import type { LibraryAssetOption } from "@/types/libraryPrefill";

interface Asset {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  duration: number | null;
  usageCount: number;
  lastUsedAt: string | null;
}

function fmtDuration(s: number | null): string {
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface PickerModalProps {
  libraryId: string;
  isOpen: boolean;
  currentAssetId: string | null;
  isVideo: boolean;
  onClose: () => void;
  onSelect: (asset: LibraryAssetOption) => void;
  /** Tag de filtre dynamique (ex: valeur du champ "agent" dans le formulaire). */
  tagFilter?: string;
  /** Instagram account ID — when set, filters to accessible assets and shows per-account usage counts. */
  accountId?: string;
}

export function LibraryPickerModal({
  libraryId,
  isOpen,
  currentAssetId,
  isVideo,
  onClose,
  onSelect,
  tagFilter,
  accountId,
}: PickerModalProps) {
  // null = not yet loaded; Asset[] = fetched (may be empty)
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [hoverPlayId, setHoverPlayId] = useState<string | null>(null);

  const loading = isOpen && assets === null;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (tagFilter?.trim()) params.set("tag", tagFilter.trim());
    if (accountId?.trim()) params.set("accountId", accountId.trim());
    const url = `/api/libraries/${libraryId}/assets${params.size > 0 ? `?${params.toString()}` : ""}`;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<Asset[]>) : Promise.resolve([])))
      .then((data) => {
        if (!cancelled) setAssets(data);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    // Reset when isOpen flips back to false or libraryId/accountId changes
    return () => {
      cancelled = true;
      setAssets(null);
    };
  }, [isOpen, libraryId, tagFilter, accountId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="font-semibold text-gray-900 text-base">
              {isVideo ? "Choisir une vidéo" : "Choisir une musique"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading ? "Chargement…" : `${(assets ?? []).length} fichier${(assets ?? []).length !== 1 ? "s" : ""} disponibles`}
              {currentAssetId && !loading ? " · 1 sélectionné" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (assets ?? []).length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="font-medium">Aucun fichier dans cette bibliothèque</p>
            </div>
          ) : isVideo ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {(assets ?? []).map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    onSelect({ id: asset.id, url: asset.url, filename: asset.filename });
                    onClose();
                  }}
                  className={`group relative rounded-xl overflow-hidden border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                    currentAssetId === asset.id
                      ? "border-indigo-500 shadow-md shadow-indigo-200/60"
                      : "border-transparent hover:border-indigo-300"
                  }`}
                  onMouseEnter={() => setHoverPlayId(asset.id)}
                  onMouseLeave={() => setHoverPlayId(null)}
                >
                  <div className="relative aspect-[9/16] bg-gray-200">
                    {hoverPlayId === asset.id ? (
                      <video
                        src={asset.url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={`${asset.url}#t=0.5`}
                        muted
                        preload="metadata"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                    {asset.duration && (
                      <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded leading-none">
                        {fmtDuration(asset.duration)}
                      </span>
                    )}
                    {currentAssetId === asset.id && (
                      <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center shadow">
                        <Check size={11} className="text-white" />
                      </div>
                    )}
                    {hoverPlayId === asset.id && currentAssetId !== asset.id && (
                      <div className="absolute inset-0 bg-indigo-600/10 pointer-events-none" />
                    )}
                  </div>
                  <div className="px-2 py-1.5 bg-white">
                    <p
                      className="text-[10px] font-medium text-gray-700 truncate leading-tight"
                      title={asset.filename}
                    >
                      {asset.filename.replace(/\.[^.]+$/, "")}
                    </p>
                    <p className="text-[9px] text-gray-400 mt-0.5">
                      {asset.usageCount} usage{asset.usageCount !== 1 ? "s" : ""}
                      {asset.duration ? ` · ${fmtDuration(asset.duration)}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Audio list */
            <div className="space-y-1.5">
              {(assets ?? []).map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    onSelect({ id: asset.id, url: asset.url, filename: asset.filename });
                    onClose();
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                    currentAssetId === asset.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-100 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/50"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      currentAssetId === asset.id ? "bg-indigo-100" : "bg-white border border-gray-200"
                    }`}
                  >
                    {currentAssetId === asset.id ? (
                      <Check size={14} className="text-indigo-600" />
                    ) : (
                      <Music2 size={14} className="text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{asset.filename}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {asset.duration ? fmtDuration(asset.duration) : ""}
                      {asset.duration && asset.usageCount > 0 ? " · " : ""}
                      {asset.usageCount > 0
                        ? `${asset.usageCount} usage${asset.usageCount !== 1 ? "s" : ""}`
                        : "Non encore utilisé"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline field ─────────────────────────────────────────────────────────────

interface LibraryFieldInputProps {
  field: { label?: string; key: string; required?: boolean };
  libraryMeta: { libraryId: string; type: "video" | "audio" };
  currentSelection: LibraryAssetOption | null;
  onSelect: (asset: LibraryAssetOption) => void;
  error?: string;
  /** Tag dynamique à passer au picker (valeur courante du champ tagFilterParam). */
  tagFilter?: string;
  /** Instagram account ID — filters to accessible assets and shows per-account usage counts. */
  accountId?: string;
}

export function LibraryFieldInput({
  field,
  libraryMeta,
  currentSelection,
  onSelect,
  error,
  tagFilter,
  accountId,
}: LibraryFieldInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div>
      {/* Label */}
      <div className="min-h-[28px] mb-1.5 flex items-center gap-2 flex-wrap">
        <label className="block text-sm font-medium text-gray-700">
          {field.label || field.key}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          depuis la bibliothèque
        </span>
      </div>

      {/* Preview + picker trigger */}
      {currentSelection ? (
        libraryMeta.type === "video" ? (
          <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="relative w-16 shrink-0 aspect-[9/16] rounded-lg overflow-hidden bg-gray-200">
              <video
                src={`${currentSelection.url}#t=0.5`}
                muted
                preload="metadata"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <p className="text-sm font-medium text-gray-800 truncate">
                {currentSelection.filename.replace(/\.[^.]+$/, "")}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Vidéo sélectionnée</p>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                Changer →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="w-9 h-9 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center shrink-0">
              <Music2 size={16} className="text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{currentSelection.filename}</p>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline shrink-0"
            >
              Changer
            </button>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full flex flex-col items-center justify-center h-28 border-2 border-dashed border-gray-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-colors group focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <span className="text-2xl text-gray-300 group-hover:text-indigo-400 transition-colors">
            {libraryMeta.type === "video" ? "🎬" : "♪"}
          </span>
          <span className="text-sm font-medium text-gray-400 group-hover:text-indigo-700 mt-1">
            Choisir depuis la bibliothèque
          </span>
        </button>
      )}

      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}

      <LibraryPickerModal
        libraryId={libraryMeta.libraryId}
        isOpen={pickerOpen}
        currentAssetId={currentSelection?.id ?? null}
        isVideo={libraryMeta.type === "video"}
        onClose={() => setPickerOpen(false)}
        onSelect={onSelect}
        tagFilter={tagFilter}
        accountId={accountId}
      />
    </div>
  );
}

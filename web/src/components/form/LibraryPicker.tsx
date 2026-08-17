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
  /**
   * Durée minimale requise pour l'asset (secondes).
   * Les assets plus courts sont grisés et désactivés dans le picker.
   * L'endpoint API est interrogé avec ce filtre pour pré-exclure les assets inéligibles.
   */
  minDuration?: number;
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
  minDuration,
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
    if (minDuration != null && minDuration > 0) params.set("minDuration", String(minDuration));
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
  }, [isOpen, libraryId, tagFilter, accountId, minDuration]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold text-foreground text-base">
              {isVideo ? "Choisir une vidéo" : "Choisir une musique"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Chargement…" : `${(assets ?? []).length} fichier${(assets ?? []).length !== 1 ? "s" : ""} disponibles`}
              {currentAssetId && !loading ? " · 1 sélectionné" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-info-200 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (assets ?? []).length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="font-medium">Aucun fichier dans cette bibliothèque</p>
            </div>
          ) : isVideo ? (
            <div className="space-y-4">
              {minDuration != null && minDuration > 0 && (assets ?? []).some((a) => a.duration !== null && a.duration < minDuration) && (
                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  Les vidéos en gris ne répondent pas à la durée requise ({fmtDuration(minDuration)})
                </div>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {(assets ?? []).map((asset) => {
                  const tooShort = minDuration != null && minDuration > 0 && asset.duration !== null && asset.duration < minDuration;
                  return (
                    <button
                      key={asset.id}
                      disabled={tooShort}
                      title={tooShort ? `Durée insuffisante : ${fmtDuration(asset.duration)} disponible, ${fmtDuration(minDuration)} requis` : undefined}
                      onClick={() => {
                        if (tooShort) return;
                        onSelect({ id: asset.id, url: asset.url, filename: asset.filename });
                        onClose();
                      }}
                      className={`group relative rounded-xl overflow-hidden border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-info-200 ${
                        tooShort
                          ? "opacity-50 cursor-not-allowed border-transparent"
                          : currentAssetId === asset.id
                            ? "border-info-600 shadow-md shadow-indigo-200/60"
                            : "border-transparent hover:border-info-200"
                      }`}
                      onMouseEnter={() => !tooShort && setHoverPlayId(asset.id)}
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
                          <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-info-600 rounded-full flex items-center justify-center shadow">
                            <Check size={11} className="text-white" />
                          </div>
                        )}
                        {hoverPlayId === asset.id && currentAssetId !== asset.id && (
                          <div className="absolute inset-0 bg-info-600/10 pointer-events-none" />
                        )}
                      </div>
                      <div className="px-2 py-1.5 bg-white">
                        <p
                          className="text-[10px] font-medium text-foreground truncate leading-tight"
                          title={asset.filename}
                        >
                          {asset.filename.replace(/\.[^.]+$/, "")}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          {asset.usageCount} usage{asset.usageCount !== 1 ? "s" : ""}
                          {asset.duration ? ` · ${fmtDuration(asset.duration)}` : ""}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Audio list */
            <div className="space-y-1.5">
              {minDuration != null && minDuration > 0 && (assets ?? []).some((a) => a.duration !== null && a.duration < minDuration) && (
                <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  Les musiques en gris ne répondent pas à la durée requise ({fmtDuration(minDuration)})
                </div>
              )}
              {(assets ?? []).map((asset) => {
                const tooShort = minDuration != null && minDuration > 0 && asset.duration !== null && asset.duration < minDuration;
                return (
                  <button
                    key={asset.id}
                    disabled={tooShort}
                    title={tooShort ? `Durée insuffisante : ${fmtDuration(asset.duration)} disponible, ${fmtDuration(minDuration)} requis` : undefined}
                    onClick={() => {
                      if (tooShort) return;
                      onSelect({ id: asset.id, url: asset.url, filename: asset.filename });
                      onClose();
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-info-200 ${
                      tooShort
                        ? "opacity-50 cursor-not-allowed border-border bg-muted"
                        : currentAssetId === asset.id
                          ? "border-info-600 bg-info-50"
                          : "border-border bg-muted hover:border-info-200 hover:bg-info-50/50"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        currentAssetId === asset.id ? "bg-info-100" : "bg-white border border-border"
                      }`}
                    >
                      {currentAssetId === asset.id ? (
                        <Check size={14} className="text-info-700" />
                      ) : (
                        <Music2 size={14} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{asset.filename}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {asset.duration ? fmtDuration(asset.duration) : ""}
                        {asset.duration && asset.usageCount > 0 ? " · " : ""}
                        {asset.usageCount > 0
                          ? `${asset.usageCount} usage${asset.usageCount !== 1 ? "s" : ""}`
                          : "Non encore utilisé"}
                      </p>
                    </div>
                  </button>
                );
              })}
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
  /**
   * Durée minimale requise pour l'asset (secondes).
   * Transmise au picker pour griser les assets trop courts.
   */
  minDuration?: number;
}

export function LibraryFieldInput({
  field,
  libraryMeta,
  currentSelection,
  onSelect,
  error,
  tagFilter,
  accountId,
  minDuration,
}: LibraryFieldInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div>
      {/* Label */}
      <div className="min-h-[28px] mb-1.5 flex items-center gap-2 flex-wrap">
        <label className="block text-sm font-medium text-foreground">
          {field.label || field.key}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <span className="inline-flex items-center gap-1 rounded-full border border-info-200 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-700">
          <span className="h-1.5 w-1.5 rounded-full bg-info-200" />
          depuis la bibliothèque
        </span>
      </div>

      {/* Preview + picker trigger */}
      {currentSelection ? (
        libraryMeta.type === "video" ? (
          <div className="flex items-start gap-3 p-3 bg-muted border border-border rounded-xl">
            <div className="relative w-16 shrink-0 aspect-[9/16] rounded-lg overflow-hidden bg-gray-200">
              <video
                src={`${currentSelection.url}#t=0.5`}
                muted
                preload="metadata"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <p className="text-sm font-medium text-foreground truncate">
                {currentSelection.filename.replace(/\.[^.]+$/, "")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Vidéo sélectionnée</p>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-2 text-xs font-medium text-info-700 hover:text-info-700 hover:underline"
              >
                Changer →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-xl">
            <div className="w-9 h-9 bg-info-50 border border-info-100 rounded-lg flex items-center justify-center shrink-0">
              <Music2 size={16} className="text-info-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{currentSelection.filename}</p>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="text-xs font-medium text-info-700 hover:text-info-700 hover:underline shrink-0"
            >
              Changer
            </button>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full flex flex-col items-center justify-center h-28 border-2 border-dashed border-border rounded-xl hover:border-info-200 hover:bg-info-50 transition-colors group focus:outline-none focus:ring-2 focus:ring-info-200"
        >
          <span className="text-2xl text-muted-foreground/60 group-hover:text-info-600 transition-colors">
            {libraryMeta.type === "video" ? "🎬" : "♪"}
          </span>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-info-700 mt-1">
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
        minDuration={minDuration}
      />
    </div>
  );
}

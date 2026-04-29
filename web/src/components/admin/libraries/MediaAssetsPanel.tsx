"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Trash2, Upload, Clock, BarChart2, Search, Play, Music2, ArrowUpDown, CheckCircle2, Tag, X, RotateCcw, Scissors } from "lucide-react";
import { MediaAssetEditModal } from "./MediaAssetEditModal";

interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  duration: number | null;
  tags: string[];
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
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
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [editingUsageId, setEditingUsageId] = useState<string | null>(null);
  const [usageInput, setUsageInput] = useState("");
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/libraries/media/${library.id}/assets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as (Omit<MediaAsset, "tags"> & { tags: string })[]
      const data: MediaAsset[] = raw.map((a) => ({
        ...a,
        tags: (() => { try { return JSON.parse(a.tags) as string[]; } catch { return []; } })()
      }));
      setAssets(data);
    } catch (err) {
      console.error("[MediaAssetsPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [library.id]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
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
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetUsage: true }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
      return;
    }
    setAssets((prev) => prev.map((a) => a.id === asset.id ? { ...a, usageCount: 0, lastUsedAt: null } : a));
  }

  async function handleResetAllUsage() {
    if (!confirm(`Réinitialiser les compteurs d'utilisation de tous les assets ? Cette opération est irréversible.`)) return;
    setResetSuccess(null);
    setResetError(null);
    const res = await fetch(`/api/admin/libraries/media/${library.id}/reset-usage`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
      return;
    }
    const d = await res.json() as { reset: number };
    setResetSuccess(`${d.reset} compteur${d.reset !== 1 ? "s" : ""} réinitialisé${d.reset !== 1 ? "s" : ""}`);
    setTimeout(() => setResetSuccess(null), 4000);
    void load();
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
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <button
              onClick={() => { void handleResetAllUsage(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-md hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50 transition-colors"
              title="Remettre tous les compteurs à zéro"
            >
              <RotateCcw size={13} /> Réinitialiser les compteurs
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Upload size={14} /> {isVideo ? "Ajouter des vidéos" : "Ajouter des musiques"}
          </button>
        </div>
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
      {resetSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={14} /> {resetSuccess}
        </div>
      )}
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
          </div>
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
        /* ─── Video grid ─── */
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((asset) => (
            <div key={asset.id} className="group relative bg-gray-100 rounded-xl overflow-hidden border border-gray-200 hover:border-indigo-300 transition-colors">
              {/* Thumbnail / preview */}
              <div className="relative aspect-[9/16] bg-gray-200">
                {previewId === asset.id ? (
                  <video
                    src={asset.url}
                    controls
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <video
                      src={`${asset.url}#t=0.5`}
                      muted
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => setPreviewId(asset.id)}
                      className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow">
                        <Play size={14} className="text-gray-800 ml-0.5" />
                      </div>
                    </button>
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
              </div>
              {/* Info */}
              <div className="p-2">
                <p className="text-xs font-medium text-gray-800 truncate" title={asset.filename}>{asset.filename}</p>
                <div className="flex items-center justify-between mt-1">
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingUsageId(asset.id); setUsageInput(String(asset.usageCount)); }}
                      className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-indigo-600 hover:underline transition-colors"
                      title="Cliquer pour modifier"
                    >
                      <BarChart2 size={10} /> {asset.usageCount} usage{asset.usageCount !== 1 ? "s" : ""}
                    </button>
                  )}
                  <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                    <Clock size={10} /> {formatDate(asset.lastUsedAt)}
                  </span>
                </div>
                {/* Tags */}
                {editingTagsId === asset.id ? (
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
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
                      className="w-full text-[10px] border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                ) : (
                  <div
                    className="mt-1.5 flex flex-wrap gap-1 min-h-[16px] cursor-pointer"
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
              {/* Delete */}
              <button
                onClick={() => { void handleDelete(asset); }}
                className="absolute top-1.5 left-1.5 w-6 h-6 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                title="Supprimer"
              >
                <Trash2 size={11} />
              </button>
              {/* Edit rush */}
              <button
                onClick={() => setEditingAsset(asset)}
                className="absolute top-8 left-1.5 w-6 h-6 bg-white/80 hover:bg-violet-50 text-gray-500 hover:text-violet-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                title="Éditer (trim, audio)"
              >
                <Scissors size={11} />
              </button>
              {/* Reset usage */}
              <button
                onClick={() => { void handleResetAssetUsage(asset); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/80 hover:bg-orange-50 text-gray-500 hover:text-orange-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                title="Réinitialiser les compteurs"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          ))}
        </div>
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
                title="Réinitialiser les compteurs"
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

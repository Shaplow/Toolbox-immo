"use client";

/**
 * MediaAssetsUploadModal — modal d'upload de MediaAsset avec drag-drop,
 * config (catégorie / set / tags / compte IG) et progress bar.
 *
 * Phase D7 du split C1-v2 (plan §19). Le composant encapsule tous les
 * states + handlers async (presign + XHR upload + bulk apply meta) qui
 * étaient inline dans MediaAssetsPanel.
 *
 * Le parent contrôle l'ouverture via la prop `open` et la fermeture via
 * `onClose`. La modal ne se ferme pas elle-même pour permettre des
 * scénarios comme "open via drag-drop sur la page" qui restent gérés
 * par le parent.
 *
 * Le parent passe `library` (id + type) et `accounts` pour adapter la
 * UI (filtre type vidéo/audio, dropdown comptes). Quand l'upload réussit,
 * `onUploaded()` est appelé pour permettre au parent de refetch la liste.
 */

import { useEffect, useRef, useState } from "react";
import { Upload, X, FolderOpen, Layers, Tag, CheckCircle2 } from "lucide-react";
import type { InstagramAccount, MediaLibrary } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  library: MediaLibrary;
  accounts: InstagramAccount[];
  /** Appelé après upload réussi pour que le parent refetch la liste. */
  onUploaded: () => void | Promise<void>;
}

export function MediaAssetsUploadModal({ open, onClose, library, accounts, onUploaded }: Props) {
  const isVideo = library.type === "video";

  // ─ State local à la modal (extrait de MediaAssetsPanel)
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadSetTag, setUploadSetTag] = useState("");
  const [uploadAccountId, setUploadAccountId] = useState<string>("");
  const [uploadTags, setUploadTags] = useState("");
  const [modalUploading, setModalUploading] = useState(false);
  const [modalProgress, setModalProgress] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [modalDragOver, setModalDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ESC pour fermer (sauf pendant un upload en cours).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modalUploading) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, modalUploading, onClose]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setModalUploading(true);
    setModalError(null);
    setModalSuccess(null);
    setModalProgress(0);

    const uploadedIds: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const presignRes = await fetch(`/api/admin/libraries/media/${library.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      if (!presignRes.ok) {
        const d = (await presignRes.json()) as { error?: string };
        setModalError(d.error ?? "Erreur lors de la préparation de l'upload");
        setModalUploading(false);
        return;
      }
      const { uploadUrl, assetId } = (await presignRes.json()) as {
        uploadUrl: string;
        assetId: string;
      };
      uploadedIds.push(assetId);

      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) {
            const filePercent = ev.loaded / ev.total;
            const overall = Math.round(((i + filePercent) / files.length) * 100);
            setModalProgress(overall);
          }
        });
        xhr.addEventListener("load", () => resolve(xhr.status >= 200 && xhr.status < 300));
        xhr.addEventListener("error", () => resolve(false));
        xhr.send(file);
      });

      if (!ok) {
        setModalError(`Échec de l'upload : ${file.name}`);
        setModalUploading(false);
        return;
      }
    }

    // Apply category / set / tags / access to all newly uploaded assets.
    const bulkData: Record<string, unknown> = { assetIds: uploadedIds };
    if (uploadSetTag.trim()) bulkData.setTag = uploadSetTag.trim();
    if (uploadCategory.trim()) bulkData.category = uploadCategory.trim();
    const tagsList = uploadTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagsList.length > 0) bulkData.tags = tagsList;
    if (uploadAccountId) {
      bulkData.accessAction = "add";
      bulkData.accountId = uploadAccountId;
    }
    if (uploadedIds.length > 0 && Object.keys(bulkData).length > 1) {
      await fetch(`/api/admin/libraries/media/${library.id}/assets/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkData),
      });
    }

    setModalSuccess(`${files.length} fichier${files.length > 1 ? "s" : ""} uploadé${files.length > 1 ? "s" : ""}`);
    setModalProgress(null);
    setModalUploading(false);
    await onUploaded();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      isVideo ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
    );
    e.target.value = "";
    if (files.length === 0) return;
    void uploadFiles(files);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => {
        if (!modalUploading) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setModalDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setModalDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setModalDragOver(false);
          const files = Array.from(e.dataTransfer.files).filter((f) =>
            isVideo ? f.type.startsWith("video/") : f.type.startsWith("audio/"),
          );
          void uploadFiles(files);
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Uploader des fichiers</h2>
          <button
            onClick={() => {
              if (!modalUploading) onClose();
            }}
            disabled={modalUploading}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
              modalDragOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-gray-50"
            }`}
          >
            <Upload size={28} className={modalDragOver ? "text-indigo-400" : "text-gray-300"} />
            <p className="text-sm text-gray-500 text-center">Glissez vos fichiers ici</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={modalUploading}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Parcourir…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={isVideo ? "video/*" : "audio/*"}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          {/* Config fields */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-gray-500 mb-1">
                <FolderOpen size={10} /> Catégorie
              </label>
              <input
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                list="group-list"
                placeholder="ex: Tenue A, Plan Ext… (optionnel)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-gray-500 mb-1">
                <Layers size={10} /> Set
              </label>
              <input
                value={uploadSetTag}
                onChange={(e) => setUploadSetTag(e.target.value)}
                list="set-tags-list"
                placeholder="ex: tenue1, session-paris… (optionnel)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-gray-500 mb-1">
                <Tag size={10} /> Tags
              </label>
              <input
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
                placeholder="intro, outro, plan1… (virgules, optionnel)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {accounts.length > 0 && (
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-gray-500 mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  Compte IG (optionnel)
                </label>
                <select
                  value={uploadAccountId}
                  onChange={(e) => setUploadAccountId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">🌍 Global (tous les comptes)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>@{a.handle}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {/* Progress */}
          {modalUploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-indigo-700">
                <span>Upload en cours…</span>
                <span>{modalProgress ?? 0}%</span>
              </div>
              <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200"
                  style={{ width: `${modalProgress ?? 0}%` }}
                />
              </div>
            </div>
          )}
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{modalError}</div>
          )}
          {modalSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 size={14} /> {modalSuccess} — glissez d&apos;autres fichiers ou fermez.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

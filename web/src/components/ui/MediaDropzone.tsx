"use client";

/**
 * MediaDropzone — primitive d'upload fichiers par glisser-déposer ou clic.
 *
 * Supporte :
 * - Drag & drop natif (drag/dragover/dragleave/drop)
 * - Fallback clic → <input type="file"> caché
 * - Multi-fichiers (sauf si multiple=false)
 * - Upload single PUT (< 100 MB) ou multipart (>= 100 MB)
 * - Concurrence max 4 parts en parallèle pour le multipart
 * - Retry par part (3x backoff exponentiel)
 * - Bouton "Annuler" qui déclenche abort multipart
 * - Mesure de durée vidéo côté client via HTMLVideoElement
 */

import { useRef, useState, useCallback, DragEvent, ChangeEvent } from "react";
import { UploadCloud, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UploadResult = {
  kind: "rush" | "version" | "brief-attachment";
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec?: number;
};

export type MediaDropzoneProps = {
  slotId: string;
  kind: "rush" | "version" | "brief-attachment";
  /** Mime types acceptés (whitelist côté UI uniquement — le serveur re-vérifie). */
  accept: string[];
  /** Taille max en octets (vérification UI uniquement — le serveur re-vérifie). */
  maxSizeBytes: number;
  multiple?: boolean;
  disabled?: boolean;
  onUploaded: (result: UploadResult) => void;
  onError?: (msg: string) => void;
  label?: string;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_CONCURRENCY = 4;
const MAX_RETRIES = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formate une taille en octets en chaîne lisible. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** Mesure la durée d'une vidéo côté client via HTMLVideoElement. */
function measureVideoDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/")) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = isFinite(video.duration) ? video.duration : undefined;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    video.src = url;
  });
}

/** Délai exponentiel pour les retries. */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Upload une part via PUT avec retries et retourne l'ETag. */
async function uploadPartWithRetry(
  url: string,
  chunk: Blob,
  signal: AbortSignal,
  attempt = 0
): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      body: chunk,
      signal,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const etag = res.headers.get("etag") ?? res.headers.get("ETag") ?? "";
    return etag;
  } catch (err) {
    if (attempt >= MAX_RETRIES - 1) throw err;
    if (signal.aborted) throw err;
    await delay(Math.pow(2, attempt) * 500);
    return uploadPartWithRetry(url, chunk, signal, attempt + 1);
  }
}

// ─── Types internes ───────────────────────────────────────────────────────────

type FileStatus = "pending" | "uploading" | "done" | "error";

interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0-100
  error?: string;
  abortController?: AbortController;
  uploadId?: string; // pour abort multipart
  r2Key?: string;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function MediaDropzone({
  slotId,
  kind,
  accept,
  maxSizeBytes,
  multiple = true,
  disabled = false,
  onUploaded,
  onError,
  label,
}: MediaDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [items, setItems] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Validation côté client ────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    if (!accept.includes(file.type)) {
      return `Type de fichier non supporté : ${file.type || "inconnu"}`;
    }
    if (file.size > maxSizeBytes) {
      return `Fichier trop volumineux (max ${formatBytes(maxSizeBytes)})`;
    }
    return null;
  }

  // ─── Mise à jour d'un item ─────────────────────────────────────────────────

  function updateItem(id: string, patch: Partial<FileItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // ─── Upload d'un fichier ───────────────────────────────────────────────────

  async function uploadFile(item: FileItem) {
    const { file, id } = item;

    updateItem(id, { status: "uploading", progress: 0 });

    try {
      // Mesurer la durée vidéo
      const durationSec = await measureVideoDuration(file);

      // 1. Presign
      const presignRes = await fetch(`/api/publications/${slotId}/upload-presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });

      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur presign (${presignRes.status})`);
      }

      const presignData = await presignRes.json() as {
        r2Key: string;
        singleUrl?: string;
        multipart?: { uploadId: string; partSize: number; partUrls: { partNumber: number; url: string }[] };
      };

      const { r2Key } = presignData;

      // Stocker r2Key pour abort éventuel
      updateItem(id, { r2Key });

      const abortController = new AbortController();
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, abortController, r2Key } : it))
      );

      let parts: { partNumber: number; etag: string }[] | undefined;
      let uploadId: string | undefined;

      if (presignData.multipart) {
        // ── Multipart upload ──────────────────────────────────────────────────
        const { uploadId: uid, partSize, partUrls } = presignData.multipart;
        uploadId = uid;

        updateItem(id, { uploadId });

        // Découper le fichier en chunks et uploader avec concurrence max 4
        const partResults: { partNumber: number; etag: string }[] = [];
        let completedParts = 0;
        const total = partUrls.length;

        // Uploader avec concurrence limitée
        const queue = [...partUrls];
        const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, total) }, async () => {
          while (queue.length > 0) {
            const part = queue.shift()!;
            const start = (part.partNumber - 1) * partSize;
            const end = Math.min(start + partSize, file.size);
            const chunk = file.slice(start, end);

            const etag = await uploadPartWithRetry(
              part.url,
              chunk,
              abortController.signal
            );

            partResults.push({ partNumber: part.partNumber, etag });
            completedParts++;
            updateItem(id, { progress: Math.round((completedParts / total) * 90) });
          }
        });

        await Promise.all(workers);

        // Trier par partNumber pour CompleteMultipartUpload
        parts = partResults.sort((a, b) => a.partNumber - b.partNumber);

      } else if (presignData.singleUrl) {
        // ── Single PUT ────────────────────────────────────────────────────────
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", presignData.singleUrl!);
          xhr.setRequestHeader("Content-Type", file.type);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateItem(id, { progress: Math.round((e.loaded / e.total) * 90) });
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`PUT échoué : HTTP ${xhr.status}`));
          };

          xhr.onerror = () => reject(new Error("Erreur réseau lors de l'upload"));

          abortController.signal.addEventListener("abort", () => {
            xhr.abort();
            reject(new Error("Upload annulé"));
          });

          xhr.send(file);
        });
      } else {
        throw new Error("Réponse presign invalide (ni singleUrl ni multipart)");
      }

      updateItem(id, { progress: 95 });

      // 2. Upload-complete
      const completeRes = await fetch(`/api/publications/${slotId}/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          r2Key,
          ...(uploadId ? { uploadId } : {}),
          ...(parts ? { parts } : {}),
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          ...(durationSec !== undefined ? { durationSec } : {}),
        }),
      });

      if (!completeRes.ok) {
        const data = await completeRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur finalisation (${completeRes.status})`);
      }

      updateItem(id, { status: "done", progress: 100 });

      onUploaded({
        kind,
        r2Key,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        durationSec,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";

      // Tenter un abort multipart si on a les infos
      const currentItem = items.find((it) => it.id === id);
      if (currentItem?.uploadId && currentItem?.r2Key) {
        fetch(`/api/publications/${slotId}/upload-abort`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ r2Key: currentItem.r2Key, uploadId: currentItem.uploadId }),
        }).catch(() => {});
      }

      updateItem(id, { status: "error", error: msg });
      onError?.(msg);
    }
  }

  // ─── Gestion des fichiers ─────────────────────────────────────────────────

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const toProcess = multiple ? fileArray : fileArray.slice(0, 1);

      const newItems: FileItem[] = toProcess.map((file) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const error = validateFile(file);
        return { id, file, status: error ? "error" : "pending", progress: 0, error: error ?? undefined };
      });

      // Signaler les erreurs de validation immédiatement
      for (const item of newItems) {
        if (item.error) {
          onError?.(item.error);
        }
      }

      const validItems = newItems.filter((it) => it.status === "pending");

      if (validItems.length > 0) {
        setItems((prev) => [...prev, ...newItems]);
        // Lancer les uploads valides
        for (const item of validItems) {
          uploadFile(item);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotId, kind, accept, maxSizeBytes, multiple, onUploaded, onError]
  );

  // ─── Drag & Drop handlers ─────────────────────────────────────────────────

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  // ─── Input file handler ───────────────────────────────────────────────────

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    // Reset pour permettre de re-sélectionner le même fichier
    e.target.value = "";
  }

  // ─── Annuler un upload ────────────────────────────────────────────────────

  function cancelUpload(item: FileItem) {
    item.abortController?.abort();

    // Si multipart et r2Key connus, abort côté serveur
    if (item.uploadId && item.r2Key) {
      fetch(`/api/publications/${slotId}/upload-abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ r2Key: item.r2Key, uploadId: item.uploadId }),
      }).catch(() => {});
    }

    setItems((prev) => prev.filter((it) => it.id !== item.id));
  }

  // ─── Nettoyer les items terminés / en erreur ──────────────────────────────

  function dismissItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  // ─── Rendu ───────────────────────────────────────────────────────────────

  const hasActiveItems = items.some((it) => it.status !== "done");
  const showDropzone = !disabled;

  return (
    <div className="space-y-3">
      {/* Zone de dépôt */}
      {showDropzone && (
        <div
          role="button"
          tabIndex={0}
          aria-label={label ?? "Zone de dépôt de fichiers"}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
          className={[
            "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer select-none focus-ring",
            isDragOver
              ? "border-gray-950 bg-gray-50"
              : "border-gray-300 bg-gray-50/40 hover:border-gray-400 hover:bg-gray-50",
            disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <UploadCloud
            size={24}
            className={isDragOver ? "text-gray-950" : "text-gray-400"}
          />
          <div>
            <p className="text-[13px] font-medium text-gray-950">
              {label ?? "Déposer vos fichiers ici"}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Glissez vos fichiers ici ou cliquez pour parcourir
            </p>
          </div>
          {maxSizeBytes < Infinity && (
            <p className="text-[11px] text-gray-400">
              Max {formatBytes(maxSizeBytes)}
            </p>
          )}
        </div>
      )}

      {/* Input caché */}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept.join(",")}
        onChange={onInputChange}
        disabled={disabled}
      />

      {/* Liste des fichiers en cours / terminés / en erreur */}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px]"
            >
              {/* Icône statut */}
              <div className="shrink-0">
                {item.status === "done" && (
                  <CheckCircle2 size={15} className="text-success-600" />
                )}
                {item.status === "error" && (
                  <AlertCircle size={15} className="text-danger-600" />
                )}
                {(item.status === "uploading" || item.status === "pending") && (
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300 border-t-gray-950 animate-spin" />
                )}
              </div>

              {/* Nom + barre de progression */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-gray-950 font-medium leading-tight">
                  {item.file.name}
                </p>
                <p className="text-[11px] text-gray-500">
                  {formatBytes(item.file.size)}
                </p>
                {item.status === "uploading" && (
                  <div className="mt-1 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gray-950 transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.status === "error" && item.error && (
                  <p className="text-[11px] text-danger-600 mt-0.5">{item.error}</p>
                )}
              </div>

              {/* Actions */}
              <div className="shrink-0">
                {item.status === "uploading" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={X}
                    onClick={() => cancelUpload(item)}
                  >
                    Annuler
                  </Button>
                )}
                {(item.status === "done" || item.status === "error") && (
                  <button
                    type="button"
                    onClick={() => dismissItem(item.id)}
                    className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-1 rounded focus-ring transition-colors"
                    aria-label="Fermer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* Supprime l'avertissement unused var */}
      {hasActiveItems && null}
    </div>
  );
}

"use client";

/**
 * RushesSection — section "Rushes" de la fiche publication.
 *
 * - ADMIN / CM assigné : peut uploader et supprimer.
 * - MONTEUR assigné : lecture seule (liste + téléchargement).
 * - Masquée si la recipe n'a pas needsRushes=true (filtré côté page.tsx).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download } from "lucide-react";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import type { UploadResult } from "@/components/ui/MediaDropzone";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RushUser {
  id: string;
  name: string | null;
  email: string | null;
}

interface Rush {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  uploadedAt: string | Date;
  uploadedByUserId: string;
  uploadedBy?: RushUser | null;
}

interface RushesSectionProps {
  slotId: string;
  rushes: Rush[];
  canUploadRushes: boolean;
  canManageRushes: boolean;
  currentUserId: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function formatRelativeDate(date: string | Date): string {
  const d = new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (hours < 24) return `Il y a ${hours}h`;
  if (days < 7) return `Il y a ${days}j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function RushesSection({
  slotId,
  rushes: initialRushes,
  canUploadRushes,
  canManageRushes,
  currentUserId,
}: RushesSectionProps) {
  const router = useRouter();
  const [rushes, setRushes] = useState<Rush[]>(initialRushes);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ─── Upload réussi ─────────────────────────────────────────────────────────

  function handleUploaded(_result: UploadResult) { // eslint-disable-line @typescript-eslint/no-unused-vars
    toast.success("Rush téléversé avec succès");
    // Revalider la page pour charger le nouveau rush depuis le serveur
    router.refresh();
  }

  function handleUploadError(msg: string) {
    toast.error(`Erreur upload : ${msg}`);
  }

  // ─── Téléchargement ────────────────────────────────────────────────────────

  async function downloadRush(rush: Rush) {
    setDownloadingId(rush.id);
    try {
      const res = await fetch(`/api/publications/${slotId}/rushes/${rush.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const { downloadUrl } = await res.json() as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = rush.fileName;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors du téléchargement");
    } finally {
      setDownloadingId(null);
    }
  }

  // ─── Suppression ──────────────────────────────────────────────────────────

  async function deleteRush(rush: Rush) {
    const res = await fetch(`/api/publications/${slotId}/rushes/${rush.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    setRushes((prev) => prev.filter((r) => r.id !== rush.id));
    toast.success(`Rush "${rush.fileName}" supprimé`);
  }

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const isVideo = (mime: string) => mime.startsWith("video/");

  return (
    <section id="rushes" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clapperboard size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">
            Rushes
            {rushes.length > 0 && (
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                ({rushes.length})
              </span>
            )}
          </h2>
        </div>
      </div>

      {/* Zone upload (ADMIN / CM) */}
      {canUploadRushes && (
        <div className="mb-4">
          <MediaDropzone
            slotId={slotId}
            kind="rush"
            accept={[
              "video/mp4",
              "video/quicktime",
              "video/x-m4v",
              "video/webm",
              "image/jpeg",
              "image/png",
              "image/webp",
            ]}
            maxSizeBytes={10 * 1024 * 1024 * 1024} // 10 GB
            multiple
            label="Déposer les rushes (vidéos et images)"
            onUploaded={handleUploaded}
            onError={handleUploadError}
          />
        </div>
      )}

      {/* Liste des rushes */}
      {rushes.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Pas de rushes pour l'instant"
          description={
            canUploadRushes
              ? "Déposez vos fichiers via la zone ci-dessus."
              : "Les rushes apparaîtront ici une fois uploadés."
          }
        />
      ) : (
        <ul className="divide-y divide-gray-50">
          {rushes.map((rush) => {
            const canDelete =
              canManageRushes || rush.uploadedByUserId === currentUserId;

            return (
              <li
                key={rush.id}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                {/* Icône type */}
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                  <Clapperboard size={14} className="text-indigo-500" />
                </div>

                {/* Infos */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {rush.fileName}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                    {rush.sizeBytes !== null && (
                      <span>{formatBytes(rush.sizeBytes)}</span>
                    )}
                    {isVideo(rush.mimeType) && rush.durationSec !== null && (
                      <span>{formatDuration(rush.durationSec)}</span>
                    )}
                    <span>·</span>
                    <span>
                      {rush.uploadedBy?.name ?? rush.uploadedBy?.email ?? "Inconnu"}
                    </span>
                    <span>·</span>
                    <span>{formatRelativeDate(rush.uploadedAt)}</span>
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Download}
                    loading={downloadingId === rush.id}
                    onClick={() => downloadRush(rush)}
                  >
                    Télécharger
                  </Button>

                  {canDelete && (
                    <DeleteButton
                      itemLabel={rush.fileName}
                      description="Cette action est irréversible. Le fichier sera supprimé définitivement."
                      onConfirm={() => deleteRush(rush)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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
import { Clapperboard, Download, Archive } from "lucide-react";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import { Section } from "@/components/ui/molecules/Section";
import type { UploadResult } from "@/components/ui/MediaDropzone";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";

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
  /** Section molecule wrapping props — passed by PublicationFiche. */
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
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
  sectionId = "rushes",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: RushesSectionProps) {
  const router = useRouter();
  const [rushes, setRushes] = useState<Rush[]>(initialRushes);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  async function downloadAllZip() {
    setDownloadingZip(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/rushes/zip`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Extract filename from Content-Disposition
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `rushes-${slotId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur téléchargement zip");
    } finally {
      setDownloadingZip(false);
    }
  }

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

  const hasRushes = rushes.length > 0;

  return (
    <Section
      title="Rushes"
      icon={Clapperboard}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        <div className="flex items-center gap-2">
          {hasRushes && (
            <span className="text-[11px] text-muted-foreground tabular-nums">{rushes.length}</span>
          )}
          {hasRushes && (
            <button
              type="button"
              onClick={() => void downloadAllZip()}
              disabled={downloadingZip}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-gray-900 disabled:opacity-40 transition-colors"
              title="Télécharger tous les rushes en .zip"
              aria-label="Télécharger tous les rushes en .zip"
            >
              <Archive size={12} />
              {downloadingZip ? "Préparation…" : ".zip"}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-2">
        {/* Liste compacte des rushes */}
        {hasRushes && (
          <ul className="divide-y divide-gray-100">
            {rushes.map((rush) => {
              const canDelete = canManageRushes || rush.uploadedByUserId === currentUserId;
              return (
                <li key={rush.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0 group">
                  <Clapperboard size={12} className="text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-800 leading-tight">{rush.fileName}</p>
                    <p className="text-[10.5px] text-muted-foreground mt-0.5 truncate">
                      {rush.sizeBytes !== null && formatBytes(rush.sizeBytes)}
                      {isVideo(rush.mimeType) && rush.durationSec !== null && ` · ${formatDuration(rush.durationSec)}`}
                      {" · "}
                      {rush.uploadedBy?.name ?? rush.uploadedBy?.email ?? "?"}
                      {" · "}
                      {formatRelativeDate(rush.uploadedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => void downloadRush(rush)}
                      disabled={downloadingId === rush.id}
                      className="p-1 text-muted-foreground hover:text-gray-900 transition-colors"
                      title="Télécharger"
                      aria-label="Télécharger"
                    >
                      <Download size={12} />
                    </button>
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

        {/* Zone upload — compacte si déjà des rushes, full si vide.
            Réceptrice de drag dans les deux cas. */}
        {canUploadRushes && (
          <div className={hasRushes ? "[&_label]:!min-h-[64px] [&_label]:!p-3" : ""}>
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
              maxSizeBytes={10 * 1024 * 1024 * 1024}
              multiple
              label={hasRushes ? "+ Ajouter" : "Déposer les rushes"}
              onUploaded={handleUploaded}
              onError={handleUploadError}
            />
          </div>
        )}

        {!hasRushes && !canUploadRushes && (
          // W4 : EmptyState primitive avec icône Clapperboard + description
          // contextuelle. Avant : un <p> italic gris-400 sans icône ni guidance.
          <EmptyState
            icon={Clapperboard}
            title="Aucun rush pour l'instant"
            description="Aucun rush."
          />
        )}
      </div>
    </Section>
  );
}

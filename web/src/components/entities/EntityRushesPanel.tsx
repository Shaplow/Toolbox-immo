"use client";

/**
 * EntityRushesPanel — liste + upload des rushs d'une FICHE (Entity), extrait
 * du bloc bespoke d'EntityFiche pour être réutilisé par le détail de commande
 * (/commandes/[id], rushs du tournage).
 *
 * Port dédié plutôt que réutilisation de RushesSection (publications), dont
 * l'upload interne ignore la prop apiBasePath. API : /api/entities/[id]/rushes.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, Trash2 } from "lucide-react";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import { toast } from "@/components/ui/Toast";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

export interface EntityRush {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedBy: { id: string; name: string | null; email: string | null } | null;
}

export const RUSH_ACCEPT = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export function formatRushBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

interface EntityRushesPanelProps {
  entityId: string;
  rushes: EntityRush[];
  canUpload: boolean;
  /** Suppression de n'importe quel rush (ADMIN) — l'auteur peut toujours supprimer les siens. */
  canManage: boolean;
  currentUserId: string;
  title?: string;
}

export function EntityRushesPanel({
  entityId,
  rushes: initialRushes,
  canUpload,
  canManage,
  currentUserId,
  title = "Rushs de la fiche",
}: EntityRushesPanelProps) {
  const router = useRouter();
  const [rushes, setRushes] = useState<EntityRush[]>(initialRushes);

  // router.refresh() renvoie une prop fraîche mais React préserve le state du
  // mount — resynchroniser, sinon un rush uploadé reste invisible.
  useEffect(() => {
    setRushes(initialRushes);
  }, [initialRushes]);

  async function downloadRush(rushId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/rushes/${rushId}`);
      if (!res.ok) throw new Error();
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      window.open(downloadUrl, "_blank");
    } catch {
      toast.error("Échec du téléchargement");
    }
  }

  async function deleteRush(rushId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/rushes/${rushId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Rush supprimé");
      setRushes((prev) => prev.filter((r) => r.id !== rushId));
      router.refresh();
    } catch {
      toast.error("Échec de la suppression");
    }
  }

  return (
    <section className="rounded-lg bg-card border border-border">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Clapperboard size={15} className="text-muted-foreground" />
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">· {rushes.length}</span>
      </header>
      <div className="p-4 space-y-3">
        {canUpload && (
          <MediaDropzone
            slotId={entityId}
            uploadBasePath={`/api/entities/${entityId}/rushes`}
            kind="rush"
            accept={RUSH_ACCEPT}
            maxSizeBytes={UPLOAD_LIMITS.RUSH_MAX_BYTES}
            multiple
            onUploaded={() => {
              toast.success("Rush uploadé");
              router.refresh();
            }}
            onError={(msg) => toast.error(msg)}
            label="Déposez les rushs de la fiche"
          />
        )}
        {rushes.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Aucun rush pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rushes.map((rush) => (
              <li key={rush.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-foreground truncate">{rush.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRushBytes(rush.sizeBytes)}
                    {rush.uploadedBy?.name ? ` · ${rush.uploadedBy.name}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadRush(rush.id)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground focus-ring"
                  aria-label="Télécharger"
                >
                  <Download size={15} />
                </button>
                {(canManage || rush.uploadedByUserId === currentUserId) && (
                  <button
                    type="button"
                    onClick={() => void deleteRush(rush.id)}
                    className="p-1.5 rounded-md hover:bg-danger-50 text-muted-foreground hover:text-danger-700 focus-ring"
                    aria-label="Supprimer"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

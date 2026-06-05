"use client";

/**
 * VersionsSection — section "Versions livrées" de la fiche publication.
 *
 * - MONTEUR assigné : peut uploader des versions + télécharger + éditer ses propres notes.
 * - ADMIN : vision complète (inclut versions soft-deleted) + promotion + soft-delete + restore.
 * - Autres rôles : lecture seule + téléchargement (non soft-deleted uniquement).
 *
 * Masquée si la recipe n'a pas needsRushes=true (filtre côté page.tsx).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Film, Download, Star, RotateCcw } from "lucide-react";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import { Section } from "@/components/ui/molecules/Section";
import type { UploadResult } from "@/components/ui/MediaDropzone";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VersionUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface VersionItem {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  durationSec: number | null;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  uploadedByUserId: string;
  uploadedBy?: VersionUser | null;
}

interface VersionsSectionProps {
  slotId: string;
  versions: VersionItem[];
  currentVersionId: string | null;
  canUploadVersion: boolean;
  canPromoteVersion: boolean;
  isAdmin: boolean;
  currentUserId: string;
  /** Warning calculé par le parent via promoteVersionWarning() — affiché
   *  dans le ConfirmDialog quand l'admin promote une nouvelle version alors
   *  que des jobs (captions/cover) ont déjà été générés sur l'ancienne. */
  promoteCoherenceWarning?: string | null;
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

function formatRelativeDate(date: string): string {
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

// ─── Composant card version ────────────────────────────────────────────────────

function VersionCard({
  version,
  slotId,
  currentVersionId,
  canPromoteVersion,
  isAdmin,
  currentUserId,
  onRefresh,
  promoteCoherenceWarning,
}: {
  version: VersionItem;
  slotId: string;
  currentVersionId: string | null;
  canPromoteVersion: boolean;
  isAdmin: boolean;
  currentUserId: string;
  onRefresh: () => void;
  promoteCoherenceWarning?: string | null;
}) {
  const isCurrent = version.id === currentVersionId;
  const isDeleted = version.deletedAt !== null;
  const isAuthorOrAdmin = isAdmin || version.uploadedByUserId === currentUserId;

  const [downloadingId, setDownloadingId] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(version.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  async function handleDownload() {
    setDownloadingId(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/versions/${version.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      const { downloadUrl } = await res.json() as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = version.fileName;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors du téléchargement");
    } finally {
      setDownloadingId(false);
    }
  }

  async function handlePromote() {
    setPromoting(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/versions/${version.id}/promote`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        staleCounts?: {
          captionJobsMarkedCount: number;
          descriptionJobsMarkedCount: number;
          coverPacksMarkedCount: number;
          transcriptionJobsMarkedCount: number;
        };
      };
      toast.success(`V${version.versionNumber} promue en version courante`);
      // V6.5.2 — Si des jobs aval ont été marqués stale par la cascade
      // (V6.3.1), informer l'admin qu'il faut régénérer ces jobs pour la
      // nouvelle version.
      // UX-auditor #1 (2026-06-01) : éviter "marqués obsolètes" jargon DB.
      // Wording dirigé : ce qui est ré-déclenché auto vs ce qui demande action.
      const c = data.staleCounts;
      if (c) {
        const items: string[] = [];
        if (c.captionJobsMarkedCount > 0) items.push("sous-titres");
        if (c.coverPacksMarkedCount > 0) items.push("cover");
        if (c.descriptionJobsMarkedCount > 0) items.push("description IA");
        if (c.transcriptionJobsMarkedCount > 0) items.push("transcription");
        if (items.length > 0) {
          toast.info(
            `Les ${items.join(", ")} liés à la version précédente seront régénérés automatiquement pour la nouvelle version courante.`,
          );
        }
      }
      setPromoteOpen(false);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la promotion");
    } finally {
      setPromoting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    // Note: DeleteButton is only rendered when canDelete=true (i.e. !isCurrent),
    // so this handler is never called for the current version.
    // The API route enforces this check server-side as an additional guard.
    const res = await fetch(`/api/publications/${slotId}/versions/${version.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? `Erreur ${res.status}`);
    }
    toast.success(`V${version.versionNumber} supprimée`);
    onRefresh();
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/versions/${version.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      toast.success(`V${version.versionNumber} restaurée`);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la restauration");
    } finally {
      setRestoring(false);
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/versions/${version.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      toast.success("Notes sauvegardées");
      setEditingNotes(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSavingNotes(false);
    }
  }

  const canDelete = isAuthorOrAdmin && !isDeleted && !isCurrent;
  const canRestore = isAdmin && isDeleted;

  return (
    <li
      className={`py-4 first:pt-0 last:pb-0 ${isDeleted ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Icône version */}
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100">
          <Film size={14} className="text-gray-600" />
        </div>

        {/* Infos */}
        <div className="min-w-0 flex-1">
          {/* Badges et filename */}
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
              V{version.versionNumber}
            </span>
            {isCurrent && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-50 text-success-700 border border-success-200">
                <Star size={10} />
                Courante
              </span>
            )}
            {isDeleted && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-danger-50 text-danger-700 border border-danger-200">
                Supprimée
              </span>
            )}
            <span className="truncate text-sm font-medium text-gray-800">
              {version.fileName}
            </span>
          </div>

          {/* Métadonnées */}
          <p className="text-xs text-gray-400 flex flex-wrap gap-x-2 mb-1">
            {version.fileSizeBytes !== null && (
              <span>{formatBytes(version.fileSizeBytes)}</span>
            )}
            {version.mimeType.startsWith("video/") && version.durationSec !== null && (
              <span>{formatDuration(version.durationSec)}</span>
            )}
            <span>·</span>
            <span>
              {version.uploadedBy?.name ?? version.uploadedBy?.email ?? "Inconnu"}
            </span>
            <span>·</span>
            <span>{formatRelativeDate(version.createdAt)}</span>
          </p>

          {/* Notes */}
          {!editingNotes && (
            <div className="flex items-start gap-2">
              {(version.notes || isAuthorOrAdmin) && (
                <p className="text-xs text-gray-500 italic">
                  {version.notes ? `"${version.notes}"` : "Pas de notes."}
                </p>
              )}
              {isAuthorOrAdmin && !isDeleted && (
                <button
                  type="button"
                  onClick={() => setEditingNotes(true)}
                  className="text-xs text-sky-500 hover:text-sky-700 underline underline-offset-2 shrink-0"
                >
                  {version.notes ? "Éditer" : "Ajouter des notes"}
                </button>
              )}
            </div>
          )}

          {editingNotes && (
            <div className="mt-1 space-y-1.5">
              <Textarea
                value={notes}
                onChange={setNotes}
                placeholder="Notes sur cette version..."
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingNotes}
                  onClick={handleSaveNotes}
                >
                  Enregistrer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNotes(version.notes ?? "");
                    setEditingNotes(false);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 mt-0.5">
          {/* Télécharger — visible si non soft-deleted */}
          {!isDeleted && (
            <Button
              variant="ghost"
              size="sm"
              icon={Download}
              loading={downloadingId}
              onClick={handleDownload}
            >
              Télécharger
            </Button>
          )}

          {/* Promouvoir — ADMIN seul, non deleted, non current */}
          {canPromoteVersion && !isDeleted && !isCurrent && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={Star}
                onClick={() => setPromoteOpen(true)}
              >
                Promouvoir
              </Button>
              <ConfirmDialog
                open={promoteOpen}
                title="Promouvoir cette version ?"
                description={
                  `V${version.versionNumber} deviendra la version de référence pour les captions, la cover et la publication.` +
                  (promoteCoherenceWarning ? ` ${promoteCoherenceWarning}` : "")
                }
                confirmLabel="Promouvoir"
                loading={promoting}
                onConfirm={handlePromote}
                onCancel={() => setPromoteOpen(false)}
              />
            </>
          )}

          {/* Supprimer — auteur ou ADMIN, non deleted, non current */}
          {canDelete && (
            <DeleteButton
              itemLabel={`V${version.versionNumber} — ${version.fileName}`}
              description="La version sera marquée comme supprimée. Un ADMIN peut la restaurer."
              onConfirm={handleDelete}
            />
          )}

          {/* Restaurer — ADMIN seul, deleted */}
          {canRestore && (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              loading={restoring}
              onClick={handleRestore}
            >
              Restaurer
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function VersionsSection({
  slotId,
  versions: initialVersions,
  currentVersionId: initialCurrentVersionId,
  canUploadVersion,
  canPromoteVersion,
  isAdmin,
  currentUserId,
  promoteCoherenceWarning,
  sectionId = "versions",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: VersionsSectionProps) {
  const router = useRouter();
  // Les listes sont lues depuis les props serveur — router.refresh() déclenche un re-render
  // complet qui recharge les nouvelles props depuis page.tsx.
  const versions = initialVersions;
  const currentVersionId = initialCurrentVersionId;

  function handleUploaded(_result: UploadResult) { // eslint-disable-line @typescript-eslint/no-unused-vars
    toast.success("Version téléversée avec succès");
    router.refresh();
  }

  function handleUploadError(msg: string) {
    toast.error(`Erreur upload : ${msg}`);
  }

  function handleRefresh() {
    // Rafraîchir depuis le serveur pour avoir l'état à jour
    router.refresh();
  }

  // Écouter les updates de router pour resynchroniser l'état local
  // (pattern "optimistic UI basique" — refresh recharge les props serveur)
  // Note: on réinitialise les versions depuis les props quand elles changent.
  // Pour cela on utilise un effet minimal (pas de useEffect ici — router.refresh()
  // suffit pour recharger le server component et ses nouvelles props).

  const activeVersions = isAdmin
    ? versions
    : versions.filter((v) => v.deletedAt === null);

  const hasVersions = activeVersions.length > 0;

  return (
    <Section
      title="Versions livrées"
      icon={Film}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        hasVersions ? (
          <span className="text-[11px] text-gray-400 tabular-nums">{activeVersions.length}</span>
        ) : null
      }
    >
      <div className="space-y-2">
        {/* Liste compactée — pattern aligné avec RushesSection. */}
        {hasVersions && (
          <ul className="divide-y divide-gray-100">
            {activeVersions.map((version) => (
              <VersionCard
                key={version.id}
                version={version}
                slotId={slotId}
                currentVersionId={currentVersionId}
                canPromoteVersion={canPromoteVersion}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
                onRefresh={handleRefresh}
                promoteCoherenceWarning={promoteCoherenceWarning}
              />
            ))}
          </ul>
        )}

        {/* Dropzone — full si pas de version, compacte sinon. */}
        {canUploadVersion && (
          <div className={hasVersions ? "[&_label]:!min-h-[64px] [&_label]:!p-3" : ""}>
            <MediaDropzone
              slotId={slotId}
              kind="version"
              accept={["video/mp4", "video/quicktime", "video/x-m4v"]}
              maxSizeBytes={10 * 1024 * 1024 * 1024}
              multiple={false}
              label={hasVersions ? "+ Nouvelle version" : "Déposer la version montée"}
              onUploaded={handleUploaded}
              onError={handleUploadError}
            />
          </div>
        )}

        {!hasVersions && !canUploadVersion && (
          // W4 : EmptyState primitive avec icon Film. Texte recadré pour ne
          // plus parler "à la place" du monteur — le CM voit juste qu'on
          // attend la V1, libre d'aller relancer si besoin.
          <EmptyState
            icon={Film}
            title="Aucune version livrée"
            description="La V1 du monteur apparaîtra ici une fois la première coupe finalisée."
          />
        )}
      </div>
    </Section>
  );
}

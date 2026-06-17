"use client";

/**
 * BriefSection — section "Brief éditorial" de la fiche publication.
 *
 * - ADMIN / CM assigné : peut éditer le corps Markdown et gérer les pièces jointes.
 * - MONTEUR assigné : lecture seule (rendu Markdown + téléchargement pièces jointes).
 * - Masquée si recipe.needsBrief=false (filtré côté PublicationFiche).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { FileText, Download, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/molecules/Section";
import { Textarea } from "@/components/ui/Textarea";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import type { UploadResult } from "@/components/ui/MediaDropzone";
import { toast } from "@/components/ui/Toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BriefItem {
  id: string;
  body: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
}

interface AttachmentItem {
  id: string;
  briefId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
}

interface BriefSectionProps {
  slotId: string;
  brief: BriefItem | null;
  attachments: AttachmentItem[];
  canEditBrief: boolean;
  canManageAttachments: boolean;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_BRIEF_LENGTH = 8000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function BriefSection({
  slotId,
  brief: initialBrief,
  attachments: initialAttachments,
  canEditBrief,
  canManageAttachments,
  sectionId = "brief",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: BriefSectionProps) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefItem | null>(initialBrief);
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments);
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(initialBrief?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // ─── Save brief body ────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
      }

      const data = await res.json() as { brief: BriefItem };
      setBrief(data.brief);
      setIsEditing(false);
      toast.success("Brief sauvegardé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditBody(brief?.body ?? "");
    setIsEditing(false);
  }

  // ─── Téléchargement pièce jointe ───────────────────────────────────────────

  async function downloadAttachment(att: AttachmentItem) {
    setDownloadingId(att.id);
    try {
      const res = await fetch(`/api/publications/${slotId}/brief/attachments/${att.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
      }
      const { downloadUrl } = await res.json() as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = att.fileName;
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

  // ─── Suppression pièce jointe ──────────────────────────────────────────────

  async function deleteAttachment(att: AttachmentItem) {
    const res = await fetch(`/api/publications/${slotId}/brief/attachments/${att.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    toast.success(`"${att.fileName}" supprimé`);
  }

  // ─── Upload pièce jointe terminé ───────────────────────────────────────────

  function handleAttachmentUploaded(_result: UploadResult) { // eslint-disable-line @typescript-eslint/no-unused-vars
    toast.success("Pièce jointe ajoutée");
    // Revalider la page pour rafraîchir la liste
    router.refresh();
  }

  function handleAttachmentError(msg: string) {
    toast.error(`Erreur upload : ${msg}`);
  }

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const hasBody = brief?.body && brief.body.trim().length > 0;
  const charCount = editBody.length;

  const editAction = canEditBrief && !isEditing
    ? (
        <Button
          variant="ghost"
          size="sm"
          icon={Edit3}
          onClick={() => {
            setEditBody(brief?.body ?? "");
            setIsEditing(true);
          }}
        >
          Modifier
        </Button>
      )
    : null;

  return (
    <Section
      title="Brief"
      icon={FileText}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={editAction}
    >
      {/* Corps du brief */}
      {isEditing ? (
        <div className="space-y-3">
          <Textarea
            value={editBody}
            onChange={setEditBody}
            placeholder="Rédigez le brief en Markdown…"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-xs ${charCount > MAX_BRIEF_LENGTH ? "text-red-500 font-medium" : "text-muted-foreground"}`}
            >
              {charCount} / {MAX_BRIEF_LENGTH}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
                Annuler
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                disabled={charCount > MAX_BRIEF_LENGTH}
                onClick={handleSave}
              >
                Sauvegarder
              </Button>
            </div>
          </div>
        </div>
      ) : hasBody ? (
        <div className="prose prose-sm prose-gray max-w-none text-foreground">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {brief!.body!}
          </ReactMarkdown>
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="Pas de brief pour l'instant"
          description={
            canEditBrief
              ? "Cliquez sur Modifier pour rédiger le brief éditorial."
              : "Le brief apparaîtra ici une fois rédigé."
          }
        />
      )}

      {/* Section pièces jointes */}
      <div className="mt-6 pt-5 border-t border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Pièces jointes
          {attachments.length > 0 && (
            <span className="ml-1 text-muted-foreground normal-case font-normal">
              ({attachments.length})
            </span>
          )}
        </h3>

        {/* Upload (ADMIN / CM) */}
        {canManageAttachments && (
          <div className="mb-3">
            <MediaDropzone
              slotId={slotId}
              kind="brief-attachment"
              accept={["application/pdf", "image/jpeg", "image/png", "image/webp"]}
              maxSizeBytes={50 * 1024 * 1024} // 50 MB
              multiple
              label="Ajouter des pièces jointes (PDF, images)"
              onUploaded={handleAttachmentUploaded}
              onError={handleAttachmentError}
            />
          </div>
        )}

        {/* Liste des pièces jointes */}
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{"Aucune pièce jointe pour l'instant."}</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                {/* Icône */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FileText size={14} className="text-muted-foreground" />
                </div>

                {/* Infos */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{att.fileName}</p>
                  {att.sizeBytes !== null && (
                    <p className="text-xs text-muted-foreground">{formatBytes(att.sizeBytes)}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Download}
                    loading={downloadingId === att.id}
                    onClick={() => downloadAttachment(att)}
                  >
                    Télécharger
                  </Button>

                  {canManageAttachments && (
                    <DeleteButton
                      itemLabel={att.fileName}
                      description="Cette pièce jointe sera définitivement supprimée."
                      onConfirm={() => deleteAttachment(att)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

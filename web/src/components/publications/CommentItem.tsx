"use client";

/**
 * CommentItem — affiche un commentaire individuel.
 *
 * UX décisions Phase 3 :
 * - Avatar bg-indigo-100 text-indigo-700 → bg-gray-100 text-gray-700
 *   (mono, cohérent avec UserAvatar de AppNav).
 * - Textarea natif d'édition → <Textarea> primitive.
 * - 2 boutons indigo + gray → <Button size="sm" /> primary/secondary.
 * - "Modifier" / "Supprimer" text links → <Button variant="ghost" size="sm">
 *   avec icônes Edit2 / Trash2. Toujours opacity-0 group-hover:opacity-100
 *   pour rester discrets (pattern Linear list row).
 * - Erreur sous textarea → toast.error.
 * - "Message supprimé" italic gray-400 → gray-400 sans italic.
 * - "(modifié)" gardé en text-[11px] gray-400.
 */

import { useState } from "react";
import { Edit2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/useConfirm";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

export interface CommentData {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  authorId: string;
  author: { id: string; name: string | null; email: string | null };
}

interface CommentItemProps {
  comment: CommentData;
  canEdit: boolean;
  onUpdated: (updated: CommentData) => void;
  onDeleted: (id: string) => void;
  slotId: string;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} jours`;
  return new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

export function CommentItem({
  comment,
  canEdit,
  onUpdated,
  onDeleted,
  slotId,
}: CommentItemProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [saving, setSaving] = useState(false);

  if (comment.deletedAt !== null) {
    return (
      <div className="flex gap-3 py-3">
        <div className="h-8 w-8 rounded-full bg-gray-100 flex-shrink-0" />
        <p className="text-[13px] text-gray-400 mt-1">Message supprimé.</p>
      </div>
    );
  }

  const displayName =
    comment.author.name ?? comment.author.email ?? "Utilisateur inconnu";
  const avatarInitials = initials(comment.author.name, comment.author.email);

  async function handleSave() {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/publications/${slotId}/comments/${comment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur lors de la modification");
      }
      const data = (await res.json()) as { comment: CommentData };
      onUpdated(data.comment);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer ce commentaire ?",
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/publications/${slotId}/comments/${comment.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la suppression");
        return;
      }
      onDeleted(comment.id);
    } catch {
      toast.error("Erreur réseau lors de la suppression");
    }
  }

  return (
    <div className="flex gap-3 py-3 group">
      <div
        className="h-8 w-8 rounded-full bg-gray-100 border border-gray-200 text-[11px] font-semibold text-gray-700 flex items-center justify-center flex-shrink-0 select-none"
        aria-hidden
      >
        {avatarInitials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-gray-950">{displayName}</span>
          <span className="text-[11px] text-gray-400">{relativeTime(comment.createdAt)}</span>
          {comment.updatedAt !== comment.createdAt && (
            <span className="text-[11px] text-gray-400">(modifié)</span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea
              value={editBody}
              onChange={(v) => setEditBody(v)}
              disabled={saving}
              rows={3}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                loading={saving}
                disabled={!editBody.trim()}
              >
                Enregistrer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditBody(comment.body);
                }}
                disabled={saving}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-[13px] text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
            {comment.body}
          </p>
        )}

        {canEdit && !editing && (
          <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              icon={Edit2}
              onClick={() => {
                setEditBody(comment.body);
                setEditing(true);
              }}
            >
              Modifier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={handleDelete}
            >
              Supprimer
            </Button>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

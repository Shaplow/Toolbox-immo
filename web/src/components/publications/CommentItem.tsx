"use client";

/**
 * CommentItem — affiche un commentaire individuel dans la section conversation.
 *
 * - Si deletedAt !== null : placeholder "Message supprimé".
 * - Sinon : avatar initiales, nom auteur, body, timestamp relatif.
 * - Mode édition inline si canEdit.
 * - Suppression avec confirm() si canEdit.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentData {
  id: string;
  body: string;
  createdAt: string; // ISO
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommentItem({ comment, canEdit, onUpdated, onDeleted, slotId }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Commentaire supprimé — placeholder
  if (comment.deletedAt !== null) {
    return (
      <div className="flex gap-3 py-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
        <p className="text-sm text-gray-400 italic mt-1">Message supprimé.</p>
      </div>
    );
  }

  const displayName = comment.author.name ?? comment.author.email ?? "Utilisateur inconnu";
  const avatarInitials = initials(comment.author.name, comment.author.email);

  async function handleSave() {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${slotId}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur lors de la modification");
      }
      const data = (await res.json()) as { comment: CommentData };
      onUpdated(data.comment);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer ce commentaire ?")) return;
    try {
      const res = await fetch(`/api/publications/${slotId}/comments/${comment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? "Erreur lors de la suppression");
        return;
      }
      onDeleted(comment.id);
    } catch {
      alert("Erreur réseau lors de la suppression");
    }
  }

  return (
    <div className="flex gap-3 py-3 group">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center justify-center flex-shrink-0 select-none"
        aria-hidden="true"
      >
        {avatarInitials}
      </div>

      <div className="flex-1 min-w-0">
        {/* Nom + timestamp */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-800">{displayName}</span>
          <span className="text-xs text-gray-400">{relativeTime(comment.createdAt)}</span>
          {comment.updatedAt !== comment.createdAt && (
            <span className="text-xs text-gray-400">(modifié)</span>
          )}
        </div>

        {/* Corps du commentaire ou éditeur inline */}
        {editing ? (
          <div className="mt-1 space-y-2">
            <textarea
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              rows={3}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              disabled={saving}
              autoFocus
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !editBody.trim()}
                className="px-3 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditBody(comment.body);
                  setError(null);
                }}
                disabled={saving}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap break-words">
            {comment.body}
          </p>
        )}

        {/* Actions Modifier / Supprimer */}
        {canEdit && !editing && (
          <div className="mt-1 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => {
                setEditBody(comment.body);
                setEditing(true);
              }}
              className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
            >
              Modifier
            </button>
            <button
              onClick={handleDelete}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Supprimer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

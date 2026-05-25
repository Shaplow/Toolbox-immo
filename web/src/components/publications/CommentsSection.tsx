"use client";

/**
 * CommentsSection — liste de commentaires + composer.
 *
 * Reçoit les commentaires initiaux du server component (page.tsx) et gère
 * les optimistic updates en local (create / edit / delete).
 *
 * Aucun dangerouslySetInnerHTML — le body est rendu via {comment.body} en JSX.
 */

import { useState } from "react";
import { CommentItem, type CommentData } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import type { UserRole } from "@/types/roles";

interface CommentsSectionProps {
  slotId: string;
  initialComments: CommentData[];
  currentUserId: string;
  currentUserRole: UserRole;
}

export function CommentsSection({
  slotId,
  initialComments,
  currentUserId,
  currentUserRole,
}: CommentsSectionProps) {
  const [comments, setComments] = useState<CommentData[]>(initialComments);

  function handleCreated(comment: CommentData) {
    setComments((prev) => [...prev, comment]);
  }

  function handleUpdated(updated: CommentData) {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  function handleDeleted(id: string) {
    // Marque le commentaire comme soft-deleted localement pour l'affichage cohérent.
    setComments((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c
      )
    );
  }

  return (
    <section
      id="comments"
      className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Conversation</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-gray-400 italic mt-2">
          Aucun commentaire pour le moment. Ajoutez-en un.
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {comments.map((comment) => {
            const canEdit =
              currentUserRole === "ADMIN" || comment.authorId === currentUserId;
            return (
              <CommentItem
                key={comment.id}
                comment={comment}
                canEdit={canEdit && comment.deletedAt === null}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
                slotId={slotId}
              />
            );
          })}
        </div>
      )}

      <CommentComposer slotId={slotId} onCreated={handleCreated} />
    </section>
  );
}

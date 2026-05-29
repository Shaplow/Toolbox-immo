"use client";

/**
 * CommentsSection — liste de commentaires + composer.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - Empty state custom italic gray-400 → EmptyState primitive (titre
 *   Caveat hand-signature "Aucun commentaire").
 * - Pagination hint amber-600 → Badge variant="info" (l'amber décoratif
 *   est hors doctrine).
 * - Section conteneur : px-6 rounded-xl shadow-sm → px-5 rounded-lg.
 */

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { CommentItem, type CommentData } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import type { UserRole } from "@/types/roles";

interface CommentsSectionProps {
  slotId: string;
  initialComments: CommentData[];
  /** True si le serveur a tronqué la liste à 50. */
  initialHasMore?: boolean;
  currentUserId: string;
  currentUserRole: UserRole;
}

export function CommentsSection({
  slotId,
  initialComments,
  initialHasMore = false,
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
    setComments((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c,
      ),
    );
  }

  return (
    <section
      id="comments"
      className="bg-white border border-gray-200 rounded-lg p-5"
    >
      <h2 className="text-[13px] font-semibold text-gray-950 mb-3">Conversation</h2>

      {initialHasMore && (
        <div className="mb-3">
          <Badge variant="info">
            Affichage des 50 plus anciens commentaires
          </Badge>
        </div>
      )}

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Aucun commentaire"
          description="Lance la conversation pour partager du contexte à l'équipe."
        />
      ) : (
        <div className="divide-y divide-gray-100">
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

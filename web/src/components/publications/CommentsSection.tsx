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
import { MessageSquare, ArrowRight } from "lucide-react";
import { CommentItem, type CommentData } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Section } from "@/components/ui/molecules/Section";
import type { UserRole } from "@/types/roles";

interface CommentsSectionProps {
  slotId: string;
  initialComments: CommentData[];
  /** True si le serveur a tronqué la liste à 50. */
  initialHasMore?: boolean;
  currentUserId: string;
  currentUserRole: UserRole;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  /** Phase 8 V2 — "preview" tronque à 5 commentaires les plus récents et
   *  expose un CTA "Voir tous les N" qui ouvre une modale lecture seule
   *  avec la liste complète. Composer reste toujours visible. */
  displayMode?: "full" | "preview";
}

export function CommentsSection({
  slotId,
  initialComments,
  initialHasMore = false,
  currentUserId,
  currentUserRole,
  sectionId = "comments",
  storageKey,
  defaultOpen = true,
  collapsible = false,
  displayMode = "full",
}: CommentsSectionProps) {
  const [comments, setComments] = useState<CommentData[]>(initialComments);
  // Phase 8 V2 — modale "Voir tout" déclenchée par CTA quand preview mode tronque.
  const [allModalOpen, setAllModalOpen] = useState(false);

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

  // Phase 8 V2 — preview tronque la liste affichée aux 5 commentaires actifs
  // les plus récents. La modale "Voir tout" peut afficher l'historique complet
  // (incluant les soft-deleted pour audit admin). On dérive preview + hidden
  // du même périmètre `activeComments` pour ne pas afficher "Voir tous les N"
  // avec un N qui ne matche pas la liste preview (incohérence quand des
  // commentaires soft-deleted étaient slice(-5) dans la version précédente).
  const isPreview = displayMode === "preview";
  const activeComments = comments.filter((c) => c.deletedAt === null);
  const activeCount = activeComments.length;
  const displayedComments = isPreview ? activeComments.slice(-5) : comments;
  const hiddenCount = isPreview
    ? Math.max(0, activeCount - displayedComments.length)
    : 0;

  function renderCommentList(items: CommentData[]) {
    return (
      <div className="divide-y divide-gray-100">
        {items.map((comment) => {
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
    );
  }

  return (
    <Section
      title="Conversation"
      icon={MessageSquare}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        activeCount > 0 ? (
          <span className="text-xs text-gray-400 tabular-nums">{activeCount}</span>
        ) : null
      }
    >
      {initialHasMore && (
        <div className="mb-3">
          <Badge variant="info">
            50 derniers · plus anciens masqués
          </Badge>
        </div>
      )}

      {comments.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Aucun commentaire" />
      ) : (
        renderCommentList(displayedComments)
      )}

      {/* Phase 8 V2 — CTA "Voir tous" si on a tronqué pour le mode preview. */}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setAllModalOpen(true)}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-gray-600 hover:text-gray-900 transition-colors font-medium pt-2"
        >
          Voir tous les {activeCount} commentaires
          <ArrowRight size={11} />
        </button>
      )}

      <CommentComposer slotId={slotId} onCreated={handleCreated} />

      {/* Phase 8 V2 — modale conversation complète. */}
      {allModalOpen && (
        <Modal open onClose={() => setAllModalOpen(false)} size="lg">
          <div className="flex flex-col max-h-[80vh]">
            <div className="shrink-0 px-5 pt-5 pb-3 border-b border-gray-100">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Conversation
              </p>
              <h3 className="mt-1 text-[18px] font-semibold tracking-tight text-gray-950">
                Tous les commentaires
                <span className="ml-2 text-[13px] font-normal text-gray-500 tabular-nums">
                  · {activeCount}
                </span>
              </h3>
              {initialHasMore && (
                <p className="mt-2 text-[11.5px] text-gray-500">
                  Seuls les 50 derniers sont chargés — les plus anciens sont
                  masqués.
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {comments.length === 0 ? (
                <EmptyState icon={MessageSquare} title="Aucun commentaire" />
              ) : (
                renderCommentList(comments)
              )}
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

"use client";

/**
 * PublicationFiche — wrapper client pour la fiche publication.
 *
 * Phase 1.3.5 : intégration des sections outils (render, cover, captions,
 * description, légende IG, publication). Les sections reçoivent leurs données
 * du server component (page.tsx) via des props sérialisables.
 *
 * Phase 1.3.6 : section commentaires + activité.
 * Phase 1.3.7 : câblage worklists + handleDeleteClick.
 */

import { PublicationHeader } from "@/components/publications/PublicationHeader";
import { ProductionChain } from "@/components/publications/ProductionChain";
import { RenderSection } from "@/components/publications/sections/RenderSection";
import { CoverSection } from "@/components/publications/sections/CoverSection";
import { CaptionsSection } from "@/components/publications/sections/CaptionsSection";
import { DescriptionSection } from "@/components/publications/sections/DescriptionSection";
import { CaptionIgSection } from "@/components/publications/sections/CaptionIgSection";
import { PublishSection } from "@/components/publications/sections/PublishSection";
import { CommentsSection } from "@/components/publications/CommentsSection";
import { ActivityTimeline } from "@/components/publications/ActivityTimeline";
import type { PublicationStep } from "@/lib/publications/steps";
import type { CommentData } from "@/components/publications/CommentItem";
import type { ActivityItem } from "@/components/publications/ActivityTimeline";
import type { UserRole } from "@/types/roles";

interface AssigneeInfo {
  id: string;
  name: string | null;
  email: string | null;
}

interface SlotInfo {
  id: string;
  title: string | null;
  status: string;
  scheduledAt: Date;
  contentType: string;
  caption: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  notes: string | null;
}

interface AccountInfo {
  id: string;
  handle: string;
  name: string;
  offre: string;
}

interface RecipeInfo {
  id: string;
  code: string;
  label: string;
  source: string;
  templateId: string | null;
  needsCover: string;
  needsCaptions: boolean;
  needsDescription: string;
}

interface RenderInfo {
  id: string;
  status: string;
  videoUrl: string | null;
  pngUrl: string | null;
}

interface CoverPackInfo {
  id: string;
  status: string;
  finalCoverUrl: string | null;
}

export interface PublicationFicheProps {
  slot: SlotInfo;
  account: AccountInfo;
  listing: { id: string } | null;
  recipe: RecipeInfo | null;
  render: RenderInfo | null;
  coverPack: CoverPackInfo | null;
  assigneeMonteur: AssigneeInfo | null;
  assigneeCm: AssigneeInfo | null;
  steps: PublicationStep[];
  canMarkPublished: boolean;
  canDelete: boolean;
  canEditRender: boolean;
  canEditCover: boolean;
  canEditCaptions: boolean;
  canEditDescription: boolean;
  // Phase 1.3.6
  comments: CommentData[];
  activities: ActivityItem[];
  activityHasMore: boolean;
  currentUserId: string;
  currentUserRole: UserRole;
}

export function PublicationFiche({
  slot,
  account,
  listing,
  recipe,
  render,
  coverPack,
  assigneeMonteur,
  assigneeCm,
  steps,
  canMarkPublished,
  canDelete,
  canEditRender,
  canEditCover,
  canEditCaptions,
  canEditDescription,
  comments,
  activities,
  activityHasMore,
  currentUserId,
  currentUserRole,
}: PublicationFicheProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header sticky */}
      <PublicationHeader
        slot={slot}
        account={account}
        listing={listing}
        recipe={recipe ? { id: recipe.id, code: recipe.code, label: recipe.label } : null}
        assigneeMonteur={assigneeMonteur}
        assigneeCm={assigneeCm}
        canMarkPublished={canMarkPublished}
        canDelete={canDelete}
        currentUserRole={currentUserRole}
      />

      {/* Corps de la fiche */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Chaîne de production */}
        <ProductionChain steps={steps} />

        {/* Rendu vidéo */}
        <RenderSection
          slot={{ id: slot.id }}
          recipe={recipe ? { source: recipe.source, templateId: recipe.templateId } : null}
          render={render}
          listingId={listing?.id ?? null}
          canEdit={canEditRender}
        />

        {/* Cover Instagram */}
        <CoverSection
          slot={{ id: slot.id }}
          recipe={recipe ? { needsCover: recipe.needsCover } : null}
          coverPack={coverPack}
          canEdit={canEditCover}
        />

        {/* Sous-titres */}
        <CaptionsSection
          slot={{ id: slot.id }}
          renderId={render?.id ?? null}
          recipe={recipe ? { needsCaptions: recipe.needsCaptions } : null}
          canEdit={canEditCaptions}
        />

        {/* Description (stockée dans notes) */}
        <DescriptionSection
          slot={{ id: slot.id }}
          recipe={recipe ? { needsDescription: recipe.needsDescription } : null}
          initialDescription={slot.notes ?? ""}
          canEdit={canEditDescription}
          renderId={render?.id ?? null}
        />

        {/* Légende Instagram */}
        <CaptionIgSection
          slot={{ id: slot.id, caption: slot.caption }}
          description={slot.notes}
          canEdit={canMarkPublished || canEditDescription}
        />

        {/* Publication */}
        <PublishSection
          slot={{
            id: slot.id,
            status: slot.status,
            publishedUrl: slot.publishedUrl,
            publishedAt: slot.publishedAt,
          }}
          canPublish={canMarkPublished}
        />

        {/* Section commentaires — Phase 1.3.6 */}
        <CommentsSection
          slotId={slot.id}
          initialComments={comments}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />

        {/* Historique d'activité — Phase 1.3.6 */}
        <ActivityTimeline
          slotId={slot.id}
          initialActivities={activities}
          initialHasMore={activityHasMore}
        />
      </div>
    </div>
  );
}

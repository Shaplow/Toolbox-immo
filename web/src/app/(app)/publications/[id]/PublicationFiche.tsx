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
import { RushesSection } from "@/components/publications/sections/RushesSection";
import { BriefSection } from "@/components/publications/sections/BriefSection";
import { VersionsSection } from "@/components/publications/sections/VersionsSection";
import type { VersionItem } from "@/components/publications/sections/VersionsSection";
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
  /** Champ dédié à la description de publication (R14 — Phase 1.3.5.6). */
  description: string | null;
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

interface PatternInfo {
  id: string;
  label: string;
  source: string;
  templateId: string | null;
  coverMode: string;
  needsCaptions: boolean;
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
}

interface RushItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedBy?: { id: string; name: string | null; email: string | null } | null;
}

interface BriefItem {
  id: string;
  body: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
}

interface BriefAttachmentItem {
  id: string;
  briefId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
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
  pattern: PatternInfo | null;
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
  // Phase B2 — Rushes
  rushes: RushItem[];
  canUploadRushes: boolean;
  canManageRushes: boolean;
  // Phase B3 — Brief
  brief: BriefItem | null;
  briefAttachments: BriefAttachmentItem[];
  canEditBrief: boolean;
  canManageAttachments: boolean;
  // Phase C1 — Versions
  versions: VersionItem[];
  currentVersionId: string | null;
  canUploadVersion: boolean;
  canPromoteVersion: boolean;
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
  pattern,
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
  rushes,
  canUploadRushes,
  canManageRushes,
  brief,
  briefAttachments,
  canEditBrief,
  canManageAttachments,
  versions,
  currentVersionId,
  canUploadVersion,
  canPromoteVersion,
  comments,
  activities,
  activityHasMore,
  currentUserId,
  currentUserRole,
}: PublicationFicheProps) {
  // Résoudre la version courante pour CaptionsSection et CoverSection (C3)
  const currentVersion = currentVersionId
    ? (versions.find((v) => v.id === currentVersionId && v.deletedAt === null) ?? null)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header sticky */}
      <PublicationHeader
        slot={slot}
        account={account}
        listing={listing}
        pattern={pattern ? { id: pattern.id, label: pattern.label } : null}
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

        {/* Brief éditorial — Phase B3, conditionné par pattern.needsBrief */}
        {pattern?.needsBrief && (
          <BriefSection
            slotId={slot.id}
            brief={brief}
            attachments={briefAttachments}
            canEditBrief={canEditBrief}
            canManageAttachments={canManageAttachments}
          />
        )}

        {/* Rushes — Phase B2, conditionné par pattern.needsRushes */}
        {pattern?.needsRushes && (
          <RushesSection
            slotId={slot.id}
            rushes={rushes}
            canUploadRushes={canUploadRushes}
            canManageRushes={canManageRushes}
            currentUserId={currentUserId}
          />
        )}

        {/* Versions livrées — Phase C1, conditionné par pattern.needsRushes */}
        {pattern?.needsRushes && (
          <VersionsSection
            slotId={slot.id}
            versions={versions}
            currentVersionId={currentVersionId}
            canUploadVersion={canUploadVersion}
            canPromoteVersion={canPromoteVersion}
            isAdmin={currentUserRole === "ADMIN"}
            currentUserId={currentUserId}
          />
        )}

        {/* Rendu vidéo */}
        <RenderSection
          slot={{ id: slot.id }}
          pattern={pattern ? { source: pattern.source, templateId: pattern.templateId } : null}
          render={render}
          listingId={listing?.id ?? null}
          canEdit={canEditRender}
        />

        {/* Cover Instagram */}
        <CoverSection
          slot={{ id: slot.id }}
          pattern={pattern ? { coverMode: pattern.coverMode } : null}
          coverPack={coverPack}
          canEdit={canEditCover}
          currentVersion={currentVersion}
        />

        {/* Sous-titres */}
        <CaptionsSection
          slot={{ id: slot.id }}
          renderId={render?.id ?? null}
          pattern={pattern ? { needsCaptions: pattern.needsCaptions } : null}
          canEdit={canEditCaptions}
          currentVersion={currentVersion}
        />

        {/* Description de publication */}
        <DescriptionSection
          slot={{ id: slot.id }}
          pattern={pattern ? { needsDescription: pattern.needsDescription } : null}
          initialDescription={slot.description ?? ""}
          canEdit={canEditDescription}
          renderId={render?.id ?? null}
        />

        {/* Légende Instagram */}
        <CaptionIgSection
          slot={{ id: slot.id, caption: slot.caption }}
          description={slot.description}
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

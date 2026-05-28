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
 * Phase 1.9 (A1) : collapse des sections non-primaires selon le rôle.
 */

import { PublicationHeader } from "@/components/publications/PublicationHeader";
import { NextActionBanner } from "@/components/publications/NextActionBanner";
import { ProductionChain } from "@/components/publications/ProductionChain";
import { RenderSection } from "@/components/publications/sections/RenderSection";
import { getSlotFinalVideoUrl, isFinalVideoCaptioned } from "@/lib/publications/finalVideo";
import { CoverSection } from "@/components/publications/sections/CoverSection";
import { CaptionsSection } from "@/components/publications/sections/CaptionsSection";
import { DescriptionSection } from "@/components/publications/sections/DescriptionSection";
import { CaptionIgSection } from "@/components/publications/sections/CaptionIgSection";
import { ClientValidationSection } from "@/components/publications/sections/ClientValidationSection";
import { OneOffTriggerButtons } from "@/components/publications/sections/OneOffTriggerButtons";
import { PublishSection } from "@/components/publications/sections/PublishSection";
import { RushesSection } from "@/components/publications/sections/RushesSection";
import { BriefSection } from "@/components/publications/sections/BriefSection";
import { VersionsSection } from "@/components/publications/sections/VersionsSection";
import type { VersionItem } from "@/components/publications/sections/VersionsSection";
import { CommentsSection } from "@/components/publications/CommentsSection";
import { ActivityTimeline } from "@/components/publications/ActivityTimeline";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { PublicationStep } from "@/lib/publications/steps";
import type { CommentData } from "@/components/publications/CommentItem";
import type { ActivityItem } from "@/components/publications/ActivityTimeline";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// Logique de priorité des sections selon le rôle
// ---------------------------------------------------------------------------

type SectionKey =
  | "brief"
  | "rushes"
  | "versions"
  | "render"
  | "cover"
  | "captions"
  | "description"
  | "captionIg"
  | "clientValidation"
  | "publish"
  | "comments"
  | "activity";

/**
 * Retourne true si la section est "primaire" pour ce rôle (déplié par défaut).
 *
 * - ADMIN : tout déplié (vision complète de la pipeline).
 * - MONTEUR : travail = Brief, Rushes, Versions, Commentaires — le reste est secondaire.
 * - CM : travail = Render (lecture), Cover, Captions, Description, Légende IG, Publication.
 * - USER : tout replié par défaut (accès minimal, rôle legacy).
 */
function isPrimaryForRole(section: SectionKey, role: UserRole): boolean {
  if (role === "ADMIN") return true;

  const primaryByRole: Record<Exclude<UserRole, "ADMIN">, SectionKey[]> = {
    // VIDÉASTE : travaille uniquement sur le brief + rushes (upload). Les
    // autres sections sont en lecture seule (informatif, replié par défaut).
    VIDEASTE: ["brief", "rushes", "comments"],
    MONTEUR: ["brief", "rushes", "versions", "comments"],
    // F1.9 — Le CM a besoin de voir rushes + versions pour valider le matériel
    // avant de préparer cover/captions/description. Section ouverte par défaut.
    CM: ["render", "rushes", "versions", "cover", "captions", "description", "captionIg", "clientValidation", "publish", "comments"],
    EXTERNAL_GENERATOR: [],
  };

  return primaryByRole[role]?.includes(section) ?? true;
}

/** Labels lisibles pour les sections repliées. */
const SECTION_LABELS: Record<SectionKey, string> = {
  brief: "Brief éditorial",
  rushes: "Rushes",
  versions: "Versions livrées",
  render: "Rendu vidéo",
  cover: "Cover Instagram",
  captions: "Sous-titres",
  description: "Description",
  captionIg: "Légende Instagram",
  clientValidation: "Validation client",
  publish: "Publication",
  comments: "Commentaires",
  activity: "Historique d'activité",
};

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
  caption: string | null;
  /** Champ dédié à la description de publication (R14 — Phase 1.3.5.6). */
  description: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  notes: string | null;
  // Phase 5 — overrides ressources (per-slot, ont priorité sur pattern)
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
}

interface AccountInfo {
  id: string;
  handle: string;
  name: string;
}

interface PatternInfo {
  id: string;
  label: string;
  source: string;
  templateId: string | null;
  coverMode: string;
  needsCaptions: boolean;
  needsDescription: string;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsRushes: boolean;
  needsBrief: boolean;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
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
  errorMsg?: string | null;
}

interface CoverConfigError {
  reason: string;
  presetName?: string;
  message: string;
}

/**
 * F4 — Permissions regroupées pour la fiche publication.
 *
 * Avant : 12 props canXxx propagées une par une à PublicationFiche.
 * Après : 1 prop `permissions` typée — plus lisible, plus testable
 * (création de fixtures plus simple), et regroupement sémantique
 * cohérent (toutes les décisions d'autorisation viennent du même endroit).
 */
export interface PublicationFichePermissions {
  canMarkPublished: boolean;
  canDelete: boolean;
  canEditRender: boolean;
  canEditCover: boolean;
  canEditCaptions: boolean;
  canEditDescription: boolean;
  canUploadRushes: boolean;
  canManageRushes: boolean;
  canEditBrief: boolean;
  canManageAttachments: boolean;
  canUploadVersion: boolean;
  canPromoteVersion: boolean;
}

export interface PublicationFicheProps {
  slot: SlotInfo;
  account: AccountInfo;
  listing: { id: string } | null;
  pattern: PatternInfo | null;
  render: RenderInfo | null;
  coverPack: CoverPackInfo | null;
  coverConfigError: CoverConfigError | null;
  assigneeMonteur: AssigneeInfo | null;
  assigneeCm: AssigneeInfo | null;
  assigneeVideaste: AssigneeInfo | null;
  steps: PublicationStep[];
  permissions: PublicationFichePermissions;
  // Phase B2 — Rushes
  rushes: RushItem[];
  // Phase B3 — Brief
  brief: BriefItem | null;
  briefAttachments: BriefAttachmentItem[];
  // Phase C1 — Versions
  versions: VersionItem[];
  currentVersionId: string | null;
  // Phase 1.9 A2 — Dernier job captions lié
  latestCaptionJob: {
    id: string;
    status: string;
    outputUrl: string | null;
    errorMsg: string | null;
    createdAt: string;
  } | null;
  // W2 — Validation client (résolu pattern + override)
  clientValidation: {
    needsClientValidation: boolean;
    allowsClientRevision: boolean;
    needsClientValidationOverride: boolean | null;
    allowsClientRevisionOverride: boolean | null;
    activeToken: {
      id: string;
      createdAt: string;
      expiresAt: string;
      createdBy: { id: string; name: string | null; email: string | null } | null;
    } | null;
    rounds: Array<{
      roundNumber: number;
      action: string;
      comment: string | null;
      respondedAt: string;
    }>;
  };
  // Phase 4 cohérence — config résolue (override + pattern) pour OneOffTriggerButtons
  // (le composant utilise ces 4 fields pour décider affichage + disabled).
  resolvedConfig: {
    coverMode: string;
    coverPresetId: string | null;
    needsCaptions: boolean;
    captionPresetId: string | null;
  };
  // Phase 1.3.6
  comments: CommentData[];
  commentsHasMore: boolean;
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
  coverConfigError,
  assigneeMonteur,
  assigneeCm,
  assigneeVideaste,
  steps,
  permissions,
  rushes,
  brief,
  briefAttachments,
  versions,
  currentVersionId,
  latestCaptionJob,
  clientValidation,
  resolvedConfig,
  comments,
  commentsHasMore,
  activities,
  activityHasMore,
  currentUserId,
  currentUserRole,
}: PublicationFicheProps) {
  // F4 — Destructure local des permissions pour garder les call sites
  // historiques inchangés (`{canEditRender}` etc.). Le grouping est dans
  // la signature externe pour les consumers (page.tsx) ; à l'intérieur
  // on reste sur l'API plate.
  const {
    canMarkPublished, canDelete, canEditRender, canEditCover,
    canEditCaptions, canEditDescription, canUploadRushes, canManageRushes,
    canEditBrief, canManageAttachments, canUploadVersion, canPromoteVersion,
  } = permissions;

  // Résoudre la version courante pour CaptionsSection et CoverSection (C3)
  const currentVersion = currentVersionId
    ? (versions.find((v) => v.id === currentVersionId && v.deletedAt === null) ?? null)
    : null;

  // Helper pour wrap conditionnel selon le rôle.
  // Le storageKey persiste l'état open/closed par slot + key dans
  // localStorage, donc l'user qui réduit "Render" sur une fiche A
  // retrouve "Render" réduit la prochaine fois qu'il ouvre la même
  // fiche A. La préférence est par-slot (pas globale) pour ne pas
  // surprendre quand on change de publication.
  const wrap = (key: SectionKey, node: React.ReactNode) => (
    <CollapsibleSection
      title={SECTION_LABELS[key]}
      defaultOpen={isPrimaryForRole(key, currentUserRole)}
      storageKey={`pub-section:${slot.id}:${key}`}
      sectionId={key}
    >
      {node}
    </CollapsibleSection>
  );

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

      {/* Bandeau "À ton tour" — affiché si l'user est le owner du statut actuel.
          Permet au monteur/CM/vidéaste de voir immédiatement ce qu'il doit faire,
          sans avoir à interpréter la ProductionChain. */}
      <NextActionBanner
        slotStatus={slot.status}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        assigneeMonteurId={assigneeMonteur?.id ?? null}
        assigneeCmId={assigneeCm?.id ?? null}
        assigneeVideasteId={assigneeVideaste?.id ?? null}
      />

      {/* ProductionChain — sticky sous le header pour rester visible pendant le scroll. */}
      <div className="sticky top-[68px] z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <ProductionChain steps={steps} />
        </div>
      </div>

      {/* Corps de la fiche — 2 colonnes en xl, stack vertical en dessous. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6">
          {/* Colonne workflow — sections d'action */}
          <div className="space-y-6 min-w-0">
            {/* Brief éditorial — Phase B3, conditionné par pattern.needsBrief */}
            {pattern?.needsBrief &&
              wrap(
                "brief",
                <BriefSection
                  slotId={slot.id}
                  brief={brief}
                  attachments={briefAttachments}
                  canEditBrief={canEditBrief}
                  canManageAttachments={canManageAttachments}
                />
              )}

            {/* Rushes — Phase B2, conditionné par pattern.needsRushes */}
            {pattern?.needsRushes &&
              wrap(
                "rushes",
                <RushesSection
                  slotId={slot.id}
                  rushes={rushes}
                  canUploadRushes={canUploadRushes}
                  canManageRushes={canManageRushes}
                  currentUserId={currentUserId}
                />
              )}

            {/* Versions livrées — Phase C1, conditionné par pattern.needsRushes */}
            {pattern?.needsRushes &&
              wrap(
                "versions",
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

            {/* Rendu vidéo — version finale (avec captions incrustées si dispo) */}
            {wrap(
              "render",
              <RenderSection
                slot={{ id: slot.id }}
                pattern={pattern ? { source: pattern.source, templateId: pattern.templateId } : null}
                render={render}
                finalVideoUrl={getSlotFinalVideoUrl({
                  render,
                  latestCaptionJob: latestCaptionJob
                    ? { status: latestCaptionJob.status, outputUrl: latestCaptionJob.outputUrl }
                    : null,
                })}
                isCaptioned={isFinalVideoCaptioned({
                  render,
                  latestCaptionJob: latestCaptionJob
                    ? { status: latestCaptionJob.status, outputUrl: latestCaptionJob.outputUrl }
                    : null,
                })}
                listingId={listing?.id ?? null}
                canEdit={canEditRender}
              />
            )}

            {/* Cover Instagram */}
            {wrap(
              "cover",
              <CoverSection
                slot={{ id: slot.id }}
                pattern={pattern ? { coverMode: pattern.coverMode } : null}
                coverPack={coverPack}
                coverConfigError={coverConfigError}
                canEdit={canEditCover}
                currentVersion={currentVersion}
              />
            )}

            {/* Sous-titres — conditionné par pattern.needsCaptions */}
            {pattern?.needsCaptions === true &&
              wrap(
                "captions",
                <CaptionsSection
                  slot={{ id: slot.id }}
                  renderId={render?.id ?? null}
                  pattern={pattern ? { needsCaptions: pattern.needsCaptions } : null}
                  canEdit={canEditCaptions}
                  currentVersion={currentVersion}
                  latestCaptionJob={latestCaptionJob}
                />
              )}

            {/* Description de publication */}
            {wrap(
              "description",
              <DescriptionSection
                slot={{ id: slot.id }}
                pattern={pattern ? { needsDescription: pattern.needsDescription } : null}
                initialDescription={slot.description ?? ""}
                canEdit={canEditDescription}
                renderId={render?.id ?? null}
                /**
                 * Prompt par défaut : override slot > pattern.
                 * Quand l'admin a configuré un prompt sur le pattern (et/ou un
                 * override sur le slot), il doit être pré-sélectionné dans la
                 * modal IA — pas un fallback "data[0]".
                 */
                defaultPromptId={
                  slot.descriptionPromptIdOverride ??
                  pattern?.descriptionPromptId ??
                  null
                }
              />
            )}

            {/* Légende Instagram */}
            {wrap(
              "captionIg",
              <CaptionIgSection
                slot={{ id: slot.id, caption: slot.caption }}
                description={slot.description}
                canEdit={canMarkPublished || canEditDescription}
              />
            )}

            {/* Validation client externe (W2) — masquée si needsClientValidation false */}
            {wrap(
              "clientValidation",
              <ClientValidationSection
                slotId={slot.id}
                slotStatus={slot.status}
                needsClientValidation={clientValidation.needsClientValidation}
                allowsClientRevision={clientValidation.allowsClientRevision}
                initialActiveToken={clientValidation.activeToken}
                rounds={clientValidation.rounds}
                currentUserRole={currentUserRole}
              />
            )}

            {/* Phase 6 — Boutons triggers manuels pour slots one-off (ADMIN only)
                Utilise resolvedConfig (override slot + pattern) au lieu de pattern brut
                pour respecter les overrides du slot (Phase 4 cohérence). */}
            <OneOffTriggerButtons
              slotId={slot.id}
              isAdmin={currentUserRole === "ADMIN"}
              hasCurrentVersion={!!currentVersion}
              hasNoRender={!render}
              resolvedConfig={resolvedConfig}
            />

            {/* Publication */}
            {wrap(
              "publish",
              <PublishSection
                slot={{
                  id: slot.id,
                  status: slot.status,
                  publishedUrl: slot.publishedUrl,
                  publishedAt: slot.publishedAt,
                }}
                canPublish={canMarkPublished}
              />
            )}
          </div>

          {/* Colonne droite — Conversation + Activité, sticky en xl. */}
          <aside className="mt-6 xl:mt-0 space-y-6">
            <div className="xl:sticky xl:top-[200px] space-y-6 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto xl:pr-1">
              {wrap(
                "comments",
                <CommentsSection
                  slotId={slot.id}
                  initialComments={comments}
                  initialHasMore={commentsHasMore}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                />
              )}

              <ActivityTimeline
                slotId={slot.id}
                initialActivities={activities}
                initialHasMore={activityHasMore}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

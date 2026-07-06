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
import { PublicationLiveRefresh } from "@/components/publications/PublicationLiveRefresh";
import { NextActionBanner } from "@/components/publications/NextActionBanner";
import { ProductionChain } from "@/components/publications/ProductionChain";
import { SlotPropertySelect } from "@/components/publications/SlotPropertySelect";
import { RenderSection } from "@/components/publications/sections/RenderSection";
import { getSlotFinalVideoUrl, isFinalVideoCaptioned } from "@/lib/publications/finalVideo";
import { CoverSection } from "@/components/publications/sections/CoverSection";
import { CaptionsSection } from "@/components/publications/sections/CaptionsSection";
import { DescriptionSection } from "@/components/publications/sections/DescriptionSection";
import { ClientValidationSection } from "@/components/publications/sections/ClientValidationSection";
import { OneOffTriggerButtons } from "@/components/publications/sections/OneOffTriggerButtons";
import { PublishSection } from "@/components/publications/sections/PublishSection";
import { RushesSection } from "@/components/publications/sections/RushesSection";
import { BriefSection } from "@/components/publications/sections/BriefSection";
import { VersionsSection } from "@/components/publications/sections/VersionsSection";
import type { VersionItem } from "@/components/publications/sections/VersionsSection";
import { CommentsSection } from "@/components/publications/CommentsSection";
import { ActivityToggleButton } from "@/components/publications/ActivityToggleButton";
import { cloneElement } from "react";
import type { ReactElement } from "react";
import type { PublicationStep } from "@/lib/publications/steps";
import { promoteVersionWarning } from "@/lib/publications/actions";
import { resolveCaptionsMode, isCaptionsEnabled } from "@/lib/publications/captionsMode";
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
  | "clientValidation"
  | "publish"
  | "comments"
  | "activity";

/**
 * Sections RENDUES (vs simplement repliées) pour un rôle donné. Les
 * sections hors liste ne sont pas du tout montées dans le DOM — pas
 * de chevron à ignorer, pas de bruit visuel pour les rôles qui n'ont
 * rien à y faire.
 *
 * ADMIN : tout (pas d'entrée dans le record, voir wrap()).
 * VIDÉASTE : brief + rushes + comments. Le reste lui est inutile.
 * MONTEUR : brief + rushes + versions + render (lecture seule pour
 *   référencer le rendu final) + comments. Cover/captions/description
 *   ne le concernent pas.
 * CM : tout sauf brief (qui appartient au pipeline amont). Activity
 *   reste repliée par défaut.
 */
const PRIMARY_SECTIONS_BY_ROLE: Record<Exclude<UserRole, "ADMIN">, SectionKey[]> = {
  VIDEASTE: ["brief", "rushes", "comments"],
  // Phase 2.5 : MONTEUR voit aussi "cover" pour le cas monteurUpload (il
  // uploade la cover avec sa version). CoverSection se masque elle-même
  // si le mode n'est pas monteurUpload, donc pas de bruit pour les autres
  // patterns.
  MONTEUR: ["brief", "rushes", "versions", "render", "cover", "comments"],
  // Ordre du process (2026-05-30) : render → captions → clientValidation
  // → description → cover → publish (les versions/rushes restent en amont,
  // comments à la fin de la fiche).
  CM: ["render", "rushes", "versions", "captions", "clientValidation", "description", "cover", "publish", "comments"],
  EXTERNAL_GENERATOR: [],
};

/**
 * true = la section est MONTÉE dans le DOM pour ce rôle. false = ne
 * s'affiche pas du tout. ADMIN voit tout. Le pliage ouvert/fermé est
 * géré séparément par Section (defaultOpen + persistance localStorage).
 */
function shouldRenderForRole(section: SectionKey, role: UserRole): boolean {
  if (role === "ADMIN") return true;
  const list = PRIMARY_SECTIONS_BY_ROLE[role as Exclude<UserRole, "ADMIN">];
  // Activité = fil d'audit réservé aux ADMIN. Les ADMIN ont déjà renvoyé true
  // ci-dessus ; tout autre rôle est explicitement exclu ici.
  if (section === "activity") return false;
  return list?.includes(section) ?? false;
}


interface AssigneeInfo {
  id: string;
  name: string | null;
  email: string | null;
}

interface SlotInfo {
  id: string;
  title: string | null;
  status: string;
  /** null = slot stocké en banque (sans date programmée). */
  scheduledAt: Date | null;
  /** Légende Instagram (Phase 2.1 : fusion ancien caption + description). */
  description: string | null;
  publishedUrl: string | null;
  publishedAt: Date | null;
  notes: string | null;
  // Phase 5 — overrides ressources (per-slot, ont priorité sur pattern)
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
  /** Biens — fiche de données partagée rattachée. */
  propertyId?: string | null;
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
  /** @deprecated V8 — utiliser needsCaptionsMode. Conservé pour compat. */
  needsCaptions: boolean;
  /** V8 — "none" | "auto" | "manual". null = lit needsCaptions Boolean en fallback. */
  needsCaptionsMode?: string | null;
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
  /** V6 — Pack obsolète (version promute ou render replacé). Affiché en badge UI. */
  staleSince?: Date | string | null;
  staleReason?: string | null;
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
  /** null = mission sans compte Instagram (production stock). */
  account: AccountInfo | null;
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
  // Phase 1.9 A2 — Dernier job captions lié (peut être PROCESSING/FAILED après retry).
  // V6.4.1 — ajout staleSince/staleReason pour badge UI "Obsolète" si l'input
  // upstream a changé (promote nouvelle version, render replaced).
  latestCaptionJob: {
    id: string;
    status: string;
    outputUrl: string | null;
    errorMsg: string | null;
    createdAt: string;
    staleSince: string | null;
    staleReason: string | null;
  } | null;
  // Fix bug 2026-05-30 — dernier CaptionJob COMPLETED avec outputUrl.
  // Source de vérité pour getSlotFinalVideoUrl (le bon outputUrl à utiliser
  // comme rendu final, même si un retry plus récent est en cours/échec).
  latestCompletedCaptionJob: {
    status: string;
    outputUrl: string | null;
  } | null;
  /** Dernier DescriptionJob auto pour ce slot (status + result + errorMsg pour la section). */
  latestDescriptionJob: {
    status: string;
    result: string | null;
    errorMsg: string | null;
    staleSince: string | null;
    staleReason: string | null;
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
    /** @deprecated V8 — utiliser needsCaptionsMode. */
    needsCaptions: boolean;
    /** V8 — "none" | "auto" | "manual". */
    needsCaptionsMode?: "none" | "auto" | "manual";
    captionPresetId: string | null;
  };
  // Phase 1.3.6
  comments: CommentData[];
  commentsHasMore: boolean;
  activities: ActivityItem[];
  activityHasMore: boolean;
  currentUserId: string;
  currentUserRole: UserRole;
  /** V2 friction HIGH-3 : indique au DescriptionSection inline modal quels
   *  modèles IA sont configurés (Claude/GPT). Sans ça, la modal hardcoderait
   *  "claude" et échouerait silencieusement si seul GPT était configuré. */
  aiConfig?: { hasClaude: boolean; hasGPT: boolean };
  /** V6.6.2 — Status transcription pour DescriptionSection (évite "Lancer
   *  la chaîne" trompeur quand transcription PROCESSING). */
  transcriptionJobStatus?: string | null;
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
  latestCompletedCaptionJob,
  latestDescriptionJob,
  clientValidation,
  resolvedConfig,
  comments,
  commentsHasMore,
  activities,
  activityHasMore,
  currentUserId,
  currentUserRole,
  aiConfig,
  transcriptionJobStatus,
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

  // Set des sections rendues dans le DOM — passé au NextActionBanner pour
  // masquer le lien "Aller à la section" si la cible n'existe pas (sinon
  // scroll mort sur slot CM en READY_FOR_CM + needsDescription="none").
  const visibleSectionIds = new Set<string>();
  const trackVisible = (key: SectionKey, condition: boolean) => {
    if (condition && shouldRenderForRole(key, currentUserRole)) {
      visibleSectionIds.add(key);
    }
  };
  trackVisible("brief", !!pattern?.needsBrief);
  trackVisible(
    "rushes",
    !!pattern?.needsRushes ||
      slot.status === "RUSHES_EXPECTED" ||
      slot.status === "RUSHES_RECEIVED" ||
      rushes.length > 0,
  );
  trackVisible(
    "versions",
    pattern?.source === "manual_rushes" ||
      !!pattern?.needsRushes ||
      !!pattern?.needsBrief ||
      slot.status === "RUSHES_EXPECTED" ||
      slot.status === "RUSHES_RECEIVED" ||
      slot.status === "IN_EDIT" ||
      slot.status === "EDIT_REVIEW" ||
      slot.status === "EDIT_APPROVED" ||
      versions.length > 0,
  );
  trackVisible("render", true);
  trackVisible("cover", true);
  // V8 — captions visible si mode auto OU manual. resolveCaptionsMode gère
  // le fallback Boolean → enum pour les patterns pas encore migrés.
  const captionsActive = !!pattern && isCaptionsEnabled(resolveCaptionsMode({ pattern }));
  trackVisible("captions", captionsActive);
  trackVisible("description", true);
  trackVisible("clientValidation", true);
  trackVisible("publish", true);
  trackVisible("comments", true);
  trackVisible("activity", true);

  // Helper pour wrap conditionnel : chaque section enfant utilise la molécule
  // Section (icon + title + actions + collapsible). wrap() injecte les props
  // de collapse/storage via cloneElement et retourne null si le rôle ne doit
  // pas voir la section.
  //
  // Phase 8 V2 — `permanent: true` retire le pli/dépli pour les sections
  // critiques (Render, Captions) qui doivent rester toujours visibles. Aucun
  // localStorage, pas de chevron, le contenu est ancré.
  const wrap = (
    key: SectionKey,
    node: ReactElement,
    permanent?: boolean,
  ): ReactElement | null => {
    if (!shouldRenderForRole(key, currentUserRole)) return null;
    if (permanent) {
      return cloneElement(node, {
        sectionId: key,
        collapsible: false,
      } as Record<string, unknown>);
    }
    return cloneElement(node, {
      sectionId: key,
      // v2 : bump du préfixe pour invalider les états "closed" hérités des anciens
      // défauts (repli auto), tout en conservant la mémoire des replis manuels futurs.
      storageKey: `pub-section-v2:${slot.id}:${key}`,
      // Toutes les sections montées sont dépliées par défaut. Un repli manuel reste
      // mémorisé via storageKey (restauré au prochain chargement).
      defaultOpen: true,
      collapsible: true,
    } as Record<string, unknown>);
  };

  // Connecteurs gradient entre sections retirés (DA v3) — la navigation
  // inter-étapes est assurée par le stepper ProductionChain (clic → scroll).

  return (
    <div className="min-h-screen bg-background">
      {/* Refresh live de la fiche sur events SSE — supprime le besoin de F5
          pour voir l'avancement du pipeline (render/captions/description/cover). */}
      <PublicationLiveRefresh
        knownJobIds={[
          render?.id,
          coverPack?.id,
          latestCaptionJob?.id,
        ]}
        expectedJobTypes={["captions", "transcription", "render", "cover", "description"]}
      />

      {/* Header sticky flat (DA v3) — le composant porte sa propre barre. */}
      <PublicationHeader
        slot={slot}
        account={account}
        pattern={pattern ? { id: pattern.id, label: pattern.label } : null}
        canMarkPublished={canMarkPublished}
        canDelete={canDelete}
        currentUserRole={currentUserRole}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <NextActionBanner
          slotStatus={slot.status}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          assigneeMonteurId={assigneeMonteur?.id ?? null}
          assigneeCmId={assigneeCm?.id ?? null}
          assigneeVideasteId={assigneeVideaste?.id ?? null}
          visibleSectionIds={visibleSectionIds}
        />

        {/* Chaîne de production */}
        <div className="mt-4 p-4 rounded-lg bg-card border border-border">
          <ProductionChain steps={steps} viewerRole={currentUserRole} />
        </div>

        {/* Biens — rattacher/changer la fiche partagée (admin + CM). */}
        {(currentUserRole === "ADMIN" || currentUserRole === "CM") && (
          <div className="mt-4 p-4 rounded-lg bg-card border border-border flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Bien</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fiche partagée (adresse, prix…) qui préremplit la génération.
              </p>
            </div>
            <div className="w-64 shrink-0">
              <SlotPropertySelect slotId={slot.id} initialPropertyId={slot.propertyId ?? null} />
            </div>
          </div>
        )}

        <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
          {/* Colonne workflow — sections d'action */}
          <div className="space-y-4 min-w-0">
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

            {/* Rushes — visible si la recipe en attend (pattern.needsRushes)
                OU si l'on est déjà dans une phase rushs/montage (statut le
                signale) OU si des rushs ont déjà été déposés. Robuste aux
                slots dont le pattern a été modifié après création. */}
            {(pattern?.needsRushes ||
              slot.status === "RUSHES_EXPECTED" ||
              slot.status === "RUSHES_RECEIVED" ||
              rushes.length > 0) &&
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

            {/* Versions livrées — visible si le pattern implique un montage
                humain (manual_rushes, needsRushes ou needsBrief), ou si une
                phase de montage est atteinte côté statut, ou si une version
                existe déjà. Aligné sur editVisible de computePublicationSteps. */}
            {(pattern?.source === "manual_rushes" ||
              pattern?.needsRushes ||
              pattern?.needsBrief ||
              slot.status === "RUSHES_EXPECTED" ||
              slot.status === "RUSHES_RECEIVED" ||
              slot.status === "IN_EDIT" ||
              slot.status === "EDIT_REVIEW" ||
              slot.status === "EDIT_APPROVED" ||
              versions.length > 0) &&
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
                  displayMode="preview"
                  promoteCoherenceWarning={promoteVersionWarning({
                    pattern: pattern
                      ? {
                          source: pattern.source,
                          needsCaptions: pattern.needsCaptions,
                          needsCaptionsMode: pattern.needsCaptionsMode,
                          needsDescription: pattern.needsDescription,
                          coverMode: pattern.coverMode,
                        }
                      : null,
                    resolved: {
                      needsCaptions: resolvedConfig.needsCaptions,
                      needsCaptionsMode: resolvedConfig.needsCaptionsMode,
                      needsDescription: pattern?.needsDescription ?? "none",
                      coverMode: resolvedConfig.coverMode,
                      coverPresetId: resolvedConfig.coverPresetId,
                      captionPresetId: resolvedConfig.captionPresetId,
                      descriptionPromptId:
                        slot.descriptionPromptIdOverride ??
                        pattern?.descriptionPromptId ??
                        null,
                    },
                    render: render ? { status: render.status } : null,
                    currentVersion: currentVersion ? { id: currentVersion.id } : null,
                    coverPack: coverPack ? { status: coverPack.status } : null,
                    latestCaptionJob: latestCaptionJob ? { status: latestCaptionJob.status } : null,
                    isAdmin: currentUserRole === "ADMIN",
                    canEdit: canPromoteVersion,
                  })}
                />
              )}

            {/* Ordre process (2026-05-30) : Render → Captions → Validation client
                → Description → Cover → Publier. Le sous-titrage précède la
                validation pour que le client reçoive la vidéo finale (avec
                sous-titres si requis). */}

            {/* 1. Rendu vidéo — version finale (avec captions incrustées si dispo).
                Phase 8 V2 — section permanente (toujours ouverte, pas de pli). */}
            {wrap(
              "render",
              <RenderSection
                slot={{ id: slot.id }}
                pattern={pattern ? { source: pattern.source, templateId: pattern.templateId } : null}
                render={render}
                /* Fix 2026-05-30 : on passe latestCompletedCaptionJob (dernier
                   CaptionJob COMPLETED), pas latestCaptionJob (qui peut être
                   PROCESSING/FAILED après retry et masquait la version finale). */
                finalVideoUrl={getSlotFinalVideoUrl({
                  render,
                  latestCaptionJob: latestCompletedCaptionJob,
                })}
                isCaptioned={isFinalVideoCaptioned({
                  render,
                  latestCaptionJob: latestCompletedCaptionJob,
                })}
                /* V8.10 — Indique si on attend l'incrustation des sous-titres
                   alors que la vidéo brute est dispo. Évite l'écran noir
                   pendant que les captions burn-in tournent. */
                pendingCaptionsBurnIn={
                  captionsActive &&
                  latestCaptionJob?.status !== "COMPLETED" &&
                  latestCaptionJob?.status !== "FAILED" &&
                  Boolean(render?.videoUrl)
                }
                listingId={listing?.id ?? null}
                canEdit={canEditRender}
              />,
              true,
            )}

            {/* 2. Sous-titres — visible si mode auto OU manual (V8).
                Phase 8 V2 — section permanente (toujours ouverte, pas de pli). */}
            {captionsActive &&
              wrap(
                "captions",
                <CaptionsSection
                  slot={{ id: slot.id }}
                  renderId={render?.id ?? null}
                  renderStatus={render?.status ?? null}
                  pattern={
                    pattern
                      ? {
                          needsCaptions: pattern.needsCaptions,
                          needsCaptionsMode: pattern.needsCaptionsMode,
                          source: pattern.source,
                        }
                      : null
                  }
                  canEdit={canEditCaptions}
                  isAdmin={currentUserRole === "ADMIN"}
                  currentVersion={currentVersion}
                  latestCaptionJob={latestCaptionJob}
                  effectiveCaptionPresetId={
                    slot.captionPresetIdOverride ??
                    pattern?.captionPresetId ??
                    null
                  }
                />,
                true,
              )}

            {/* 3. Validation client externe — masquée si needsClientValidation false.
                V8.10 — On bloque l'envoi tant que les sous-titres ne sont pas
                COMPLETED (le client doit voir la version finale avec captions). */}
            {(() => {
              const captionsRequired = captionsActive;
              // Bug-hunter #2 (2026-06-01) : exiger !staleSince pour éviter
              // d'envoyer au client une validation sur un caption obsolète
              // (lié à l'ancienne version pré-promote).
              const captionsReady =
                !captionsRequired ||
                (latestCaptionJob?.status === "COMPLETED" && !latestCaptionJob?.staleSince);
              const canSendValidation = captionsReady;
              const cannotSendReason = !captionsReady
                ? latestCaptionJob?.staleSince
                  ? "Les sous-titres en place sont obsolètes (lien à l'ancienne version). Relance la chaîne avant de valider."
                  : "Les sous-titres ne sont pas encore générés. Le client doit voir la vidéo finale avec sous-titres avant validation."
                : null;
              return wrap(
                "clientValidation",
                <ClientValidationSection
                  slotId={slot.id}
                  slotStatus={slot.status}
                  needsClientValidation={clientValidation.needsClientValidation}
                  allowsClientRevision={clientValidation.allowsClientRevision}
                  initialActiveToken={clientValidation.activeToken}
                  rounds={clientValidation.rounds}
                  currentUserRole={currentUserRole}
                  canSendValidation={canSendValidation}
                  cannotSendReason={cannotSendReason}
                />
              );
            })()}

            {/* 4. Description de publication */}
            {wrap(
              "description",
              <DescriptionSection
                slot={{ id: slot.id }}
                pattern={
                  pattern
                    ? {
                        needsDescription: pattern.needsDescription,
                        source: pattern.source,
                        needsCaptions: pattern.needsCaptions,
                        needsCaptionsMode: pattern.needsCaptionsMode,
                        coverMode: pattern.coverMode,
                      }
                    : null
                }
                initialDescription={slot.description ?? ""}
                canEdit={canEditDescription}
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
                descriptionJobStatus={latestDescriptionJob?.status ?? null}
                descriptionJobResult={latestDescriptionJob?.result ?? null}
                descriptionJobErrorMsg={latestDescriptionJob?.errorMsg ?? null}
                slotStatus={slot.status}
                aiConfig={aiConfig}
                renderStatus={render?.status ?? null}
                hasCurrentVersion={!!currentVersionId}
                needsClientValidation={clientValidation.needsClientValidation}
                transcriptionJobStatus={transcriptionJobStatus}
              />
            )}

            {/* 5. Cover Instagram */}
            {wrap(
              "cover",
              <CoverSection
                slot={{ id: slot.id }}
                pattern={pattern ? { coverMode: pattern.coverMode } : null}
                renderId={render?.status === "DONE" ? render.id : null}
                coverPack={
                  coverPack
                    ? {
                        id: coverPack.id,
                        status: coverPack.status,
                        finalCoverUrl: coverPack.finalCoverUrl,
                        errorMsg: coverPack.errorMsg ?? null,
                        // V6.5.1 — sérialisation Date → string ISO côté boundary client.
                        staleSince:
                          coverPack.staleSince instanceof Date
                            ? coverPack.staleSince.toISOString()
                            : coverPack.staleSince ?? null,
                        staleReason: coverPack.staleReason ?? null,
                      }
                    : null
                }
                coverConfigError={coverConfigError}
                canEdit={canEditCover}
                viewerRole={currentUserRole}
                canMonteurUpload={
                  currentUserRole === "ADMIN" ||
                  (currentUserRole === "MONTEUR" &&
                    assigneeMonteur?.id === currentUserId)
                }
                currentVersion={currentVersion}
                needsClientValidation={clientValidation.needsClientValidation}
                slotStatus={slot.status}
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
              hasCaptionJob={!!latestCaptionJob}
              hasCoverPack={!!coverPack && coverPack.status !== "FAILED"}
            />

            {/* Publication — récupère les steps incomplets pour afficher
                un warning non-bloquant si le CM tente de publier alors
                que cover/captions/description sont todo ou failed. */}
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
                incompleteSteps={steps
                  .filter((s) => s.visible && s.key !== "publish")
                  .filter((s): s is typeof s & { status: "todo" | "failed" } =>
                    s.status === "todo" || s.status === "failed",
                  )
                  .map((s) => ({ key: String(s.key), label: s.label, status: s.status }))}
              />
            )}
          </div>

          {/* Colonne droite — Conversation + Activité, sticky en xl.
              Pas de max-h + overflow-y-auto interne : laisse scroller la page
              naturellement. Sinon scrollbar visible + activité tronquée. */}
          <aside className="mt-6 xl:mt-0">
            <div className="xl:sticky xl:top-[128px] space-y-4">
              {wrap(
                "comments",
                <CommentsSection
                  slotId={slot.id}
                  initialComments={comments}
                  initialHasMore={commentsHasMore}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  displayMode="preview"
                />
              )}

              {/* V8 Phase 8 — Activity timeline en bouton + modale.
                  La timeline n'est plus rendue inline (gain ~25% viewport).
                  Le bouton expose le count comme signal et ouvre la modale
                  uniquement quand l'admin en a besoin. */}
              {shouldRenderForRole("activity", currentUserRole) && (
                <ActivityToggleButton
                  slotId={slot.id}
                  initialActivities={activities}
                  initialHasMore={activityHasMore}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

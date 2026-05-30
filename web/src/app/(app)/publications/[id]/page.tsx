import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canMarkPublished, canUploadRushes, canEditBrief, canUploadVersion, canPromoteVersion } from "@/lib/permissions/publications";
import { computePublicationSteps } from "@/lib/publications/steps";
import { toUserRole } from "@/lib/permissions/role";
import { syncSlotsPipelineStatuses } from "@/lib/services/slot/transitions";
import { resolveSlotConfig } from "@/lib/services/slot/config";
import { PublicationFiche } from "./PublicationFiche";
import type { CommentData } from "@/components/publications/CommentItem";
import type { ActivityItem } from "@/components/publications/ActivityTimeline";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      title: true,
      pattern: { select: { label: true } },
      account: { select: { handle: true } },
    },
  });
  if (!slot) return { title: "Publication | Toolbox Immo" };
  const label = slot.pattern?.label ?? slot.title ?? "Publication";
  return {
    title: `${label} · @${slot.account.handle} | Toolbox Immo`,
  };
}

export default async function PublicationPage({ params }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    redirect("/login");
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    include: {
      account: {
        select: {
          id: true,
          handle: true,
          name: true,
          client: { select: { name: true } },
        },
      },
      pattern: {
        select: {
          id: true,
          label: true,
          source: true,
          templateId: true,
          coverMode: true,
          needsCaptions: true,
          needsDescription: true,
          needsClientValidation: true,
          allowsClientRevision: true,
          needsRushes: true,
          needsBrief: true,
          captionPresetId: true,
          descriptionPromptId: true,
        },
      },
      assigneeMonteur: { select: { id: true, name: true, email: true } },
      assigneeCm: { select: { id: true, name: true, email: true } },
      assigneeVideaste: { select: { id: true, name: true, email: true } },
      render: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          pngUrl: true,
          createdAt: true,
          coverFramePack: {
            select: { id: true, status: true, finalCoverUrl: true, errorMsg: true },
          },
          listing: { select: { id: true } },
        },
      },
      // Fix bug 2026-05-30 : take: 5 (au lieu de 1) pour distinguer le dernier
      // captionJob (pour l'état UI CaptionsSection) du dernier COMPLETED (pour
      // déterminer la version sous-titrée à utiliser comme rendu final).
      // Sans ça, un retry échec/processing écrasait la version COMPLETED
      // précédente comme source de finalVideoUrl → on retombait sur la brute.
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          outputUrl: true,
          errorMsg: true,
          createdAt: true,
        },
      },
      // Dernier job description IA lié au slot (P0.2 — alimente la ProductionChain)
      descriptionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          result: true,
        },
      },
    },
  });

  // 404 systématique : slot inexistant OU pas accessible (anti-énumération)
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    notFound();
  }

  // Rattrapage opportuniste : si le render existe (PROCESSING/DONE) mais le
  // slot est resté en TO_DO/IN_PROGRESS, on applique la bonne transition.
  // Couvre les slots créés avant l'intro des auto-transitions pipeline.
  const pipelineUpdates = await syncSlotsPipelineStatuses(prisma, [
    {
      id: slot.id,
      status: slot.status,
      pattern: slot.pattern
        ? { source: slot.pattern.source, needsCaptions: slot.pattern.needsCaptions }
        : null,
      render: slot.render ? { status: slot.render.status } : null,
      captionJobs: slot.captionJobs.map((c) => ({ status: c.status })),
    },
  ]);
  const effectiveStatus = pipelineUpdates.get(slot.id) ?? slot.status;

  // Dériver le listing depuis le render si présent
  const listing = slot.render?.listing ?? null;

  // F1.5 — Fetch des 5 collections en parallèle (toutes indépendantes : pas
  // de dépendance entre comments / activities / rushes / versions / brief).
  // Avant : 5 round-trips DB séquentiels. Maintenant : 1 batch.
  const isAdmin = role === "ADMIN";
  const [rawComments, rawActivities, rawRushes, rawVersions, rawBrief] = await Promise.all([
    prisma.publicationComment.findMany({
      where: { slotId: id },
      orderBy: { createdAt: "desc" },
      take: 51,
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.publicationActivity.findMany({
      where: { slotId: id },
      orderBy: { createdAt: "desc" },
      take: 31, // +1 pour détecter hasMore
      include: {
        actor: { select: { id: true, name: true } },
      },
    }),
    prisma.publicationRush.findMany({
      where: { slotId: id, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.publicationVersion.findMany({
      where: {
        slotId: id,
        ...(isAdmin ? {} : { deletedAt: null }),
      },
      orderBy: { versionNumber: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.publicationBrief.findUnique({
      where: { slotId: id },
      include: {
        attachments: {
          orderBy: { createdAt: "asc" },
        },
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  // Charge plus la chaîne récente puis affiche en ordre ASC (lecture naturelle).
  // Les 50 plus récents = ce qu'on garde ; les anciens (>50) sont signalés par
  // commentsHasMore et masqués jusqu'à pagination future.
  const commentsHasMore = rawComments.length > 50;
  const comments: CommentData[] = rawComments.slice(0, 50).reverse().map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
    authorId: c.authorId,
    author: {
      id: c.author.id,
      name: c.author.name,
      email: c.author.email,
    },
  }));

  const activityHasMore = rawActivities.length > 30;
  const activities: ActivityItem[] = rawActivities.slice(0, 30).map((a) => ({
    id: a.id,
    type: a.type,
    payload: (a.payload as Record<string, unknown> | null) ?? null,
    createdAt: a.createdAt.toISOString(),
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
  }));

  const rushes = rawRushes.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    durationSec: r.durationSec,
    uploadedAt: r.uploadedAt.toISOString(),
    uploadedByUserId: r.uploadedByUserId,
    uploadedBy: r.uploadedBy,
  }));

  const versions = rawVersions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    fileName: v.fileName,
    mimeType: v.mimeType,
    fileSizeBytes: v.fileSizeBytes,
    durationSec: v.durationSec,
    notes: v.notes,
    deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    uploadedByUserId: v.uploadedByUserId,
    uploadedBy: v.uploadedBy,
  }));

  const brief = rawBrief
    ? {
        id: rawBrief.id,
        body: rawBrief.body,
        updatedAt: rawBrief.updatedAt.toISOString(),
        updatedByUserId: rawBrief.updatedByUserId,
      }
    : null;

  const briefAttachments = rawBrief?.attachments.map((a) => ({
    id: a.id,
    briefId: a.briefId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  })) ?? [];

  // Phase 1.9 A2 — dernier job captions lié (pour l'état UI CaptionsSection).
  const latestCaptionJob = slot.captionJobs[0] ?? null;
  // Fix bug 2026-05-30 : dernier CaptionJob COMPLETED — source de vérité pour
  // la "version sous-titrée" qui doit remplacer la brute dans la fiche +
  // validation client. Distinct du latestCaptionJob qui peut être en
  // PROCESSING / FAILED après un retry et masquait la version finale.
  const latestCompletedCaptionJob =
    slot.captionJobs.find((j) => j.status === "COMPLETED" && j.outputUrl) ?? null;
  // P0.2 — dernier job description IA lié (le step utilise aussi slot.description en fallback)
  const latestDescriptionJob = slot.descriptionJobs[0] ?? null;

  // Cohérence Workflows Phase 4 — Résolution exhaustive (pattern + overrides slot)
  // Couvre validation client + needsCaptions/Description/Rushes/Brief en un seul appel.
  const resolvedConfig = resolveSlotConfig(
    {
      needsClientValidationOverride: slot.needsClientValidationOverride,
      allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
      needsCaptionsOverride: slot.needsCaptionsOverride,
      needsDescriptionOverride: slot.needsDescriptionOverride,
      needsRushesOverride: slot.needsRushesOverride,
      needsBriefOverride: slot.needsBriefOverride,
    },
    slot.pattern,
  );
  // Pattern "effectif" : pattern parent enrichi des valeurs résolues — utilisé
  // par computePublicationSteps + sections enfant qui lisent pattern.needs*.
  // Les overrides sont ainsi transparents pour la couche d'affichage.
  const effectivePattern = slot.pattern
    ? {
        ...slot.pattern,
        needsCaptions: resolvedConfig.needsCaptions,
        needsDescription: resolvedConfig.needsDescription,
        needsClientValidation: resolvedConfig.needsClientValidation,
        allowsClientRevision: resolvedConfig.allowsClientRevision,
        needsRushes: resolvedConfig.needsRushes,
        needsBrief: resolvedConfig.needsBrief,
      }
    : null;

  const [activeValidationToken, validationRounds] = await Promise.all([
    prisma.clientValidationToken.findFirst({
      where: { slotId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.clientValidationRound.findMany({
      where: { slotId: id },
      orderBy: { roundNumber: "desc" },
      take: 20,
      select: { roundNumber: true, action: true, comment: true, respondedAt: true },
    }),
  ]);

  // Cover pack : un CoverFramePack peut être rattaché à un Render
  // (auto_template) OU à une PublicationVersion promue (manual_rushes,
  // external_upload). Sans ce fallback, le pack créé par tryAutoTrigger
  // Cover post-promote restait invisible pour les slots manual_rushes et
  // le step "cover" était figé à "todo".
  const versionCoverPack = slot.currentVersionId
    ? await prisma.coverFramePack.findUnique({
        where: { publicationVersionId: slot.currentVersionId },
        select: { id: true, status: true, finalCoverUrl: true, errorMsg: true },
      })
    : null;
  const effectiveCoverPack = versionCoverPack ?? slot.render?.coverFramePack ?? null;

  // Calcul des steps — utilise le pattern effectif (overrides résolus)
  const steps = computePublicationSteps({
    slot: { status: effectiveStatus, description: slot.description },
    pattern: effectivePattern,
    renderJob: slot.render ?? null,
    coverPack: effectiveCoverPack,
    captionJob: latestCaptionJob,
    descriptionJob: latestDescriptionJob,
    versionsCount: rawVersions.filter((v) => v.deletedAt === null).length,
    rushesCount: rushes.length,
    currentVersionId: slot.currentVersionId ?? null,
  });

  // Cover config error : si aucun pack n'a été créé (ni côté render, ni côté
  // version) alors que pattern.coverMode=auto, on cherche la dernière activity
  // COVER_CONFIG_ERROR pour afficher un warning contextuel dans CoverSection.
  let coverConfigError: { reason: string; presetName?: string; message: string } | null = null;
  if (!effectiveCoverPack && slot.pattern?.coverMode === "autoPack") {
    const lastConfigError = await prisma.publicationActivity.findFirst({
      where: { slotId: id, type: "COVER_CONFIG_ERROR" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    if (lastConfigError?.payload) {
      const p = lastConfigError.payload as Record<string, unknown>;
      coverConfigError = {
        reason: typeof p.reason === "string" ? p.reason : "unknown",
        presetName: typeof p.presetName === "string" ? p.presetName : undefined,
        message: typeof p.message === "string" ? p.message : "Configuration cover invalide",
      };
    }
  }

  // Permissions UI
  const userForPermission = { id: userId, role };
  // assigneeVideasteId est REQUIS ici sinon canUploadRushes retourne toujours
  // false pour un vidéaste assigné (compare undefined === user.id).
  const slotForPermission = {
    assigneeMonteurId: slot.assigneeMonteurId,
    assigneeCmId: slot.assigneeCmId,
    assigneeVideasteId: slot.assigneeVideasteId,
  };

  const canPublish = canMarkPublished(userForPermission, slotForPermission);
  const canDelete = role === "ADMIN";
  const canEditRender = role === "ADMIN";
  const canEditCover = role === "ADMIN" || role === "CM";
  const canEditCaptions = role === "ADMIN" || role === "MONTEUR" || role === "CM";
  const canEditDescription = role === "ADMIN" || role === "CM";
  const canUploadRushesFlag = canUploadRushes(userForPermission, slotForPermission);
  // canManageRushes = peut supprimer tous les rushes (ADMIN) — auteur peut supprimer les siens dans le composant
  const canManageRushes = role === "ADMIN";
  const canEditBriefFlag = canEditBrief(userForPermission, slotForPermission);
  const canManageAttachments = canEditBriefFlag;
  const canUploadVersionFlag = canUploadVersion(userForPermission, slotForPermission);
  const canPromoteVersionFlag = canPromoteVersion(userForPermission);

  return (
    <PublicationFiche
      slot={{
        id: slot.id,
        title: slot.title,
        status: effectiveStatus,
        scheduledAt: slot.scheduledAt,
        description: slot.description,
        publishedUrl: slot.publishedUrl,
        publishedAt: slot.publishedAt,
        notes: slot.notes,
        captionPresetIdOverride: slot.captionPresetIdOverride,
        descriptionPromptIdOverride: slot.descriptionPromptIdOverride,
      }}
      account={{
        id: slot.account.id,
        handle: slot.account.handle,
        name: slot.account.name,
      }}
      listing={listing}
      pattern={
        effectivePattern
          ? {
              id: effectivePattern.id,
              label: effectivePattern.label,
              source: effectivePattern.source,
              templateId: effectivePattern.templateId,
              coverMode: effectivePattern.coverMode,
              // Toutes les valeurs needs* sont déjà résolues (overrides appliqués)
              needsCaptions: effectivePattern.needsCaptions,
              needsDescription: effectivePattern.needsDescription,
              needsClientValidation: effectivePattern.needsClientValidation,
              allowsClientRevision: effectivePattern.allowsClientRevision,
              needsRushes: effectivePattern.needsRushes,
              needsBrief: effectivePattern.needsBrief,
              // FK presets/prompts — pré-remplissent les modals IA / captions de la fiche
              captionPresetId: slot.pattern?.captionPresetId ?? null,
              descriptionPromptId: slot.pattern?.descriptionPromptId ?? null,
            }
          : null
      }
      render={
        slot.render
          ? {
              id: slot.render.id,
              status: slot.render.status,
              videoUrl: slot.render.videoUrl,
              pngUrl: slot.render.pngUrl,
            }
          : null
      }
      coverPack={effectiveCoverPack}
      coverConfigError={coverConfigError}
      assigneeMonteur={slot.assigneeMonteur}
      assigneeCm={slot.assigneeCm}
      assigneeVideaste={slot.assigneeVideaste}
      steps={steps}
      permissions={{
        canMarkPublished: canPublish,
        canDelete,
        canEditRender,
        canEditCover,
        canEditCaptions,
        canEditDescription,
        canUploadRushes: canUploadRushesFlag,
        canManageRushes,
        canEditBrief: canEditBriefFlag,
        canManageAttachments,
        canUploadVersion: canUploadVersionFlag,
        canPromoteVersion: canPromoteVersionFlag,
      }}
      rushes={rushes}
      brief={brief}
      briefAttachments={briefAttachments}
      versions={versions}
      currentVersionId={slot.currentVersionId ?? null}
      latestCaptionJob={
        latestCaptionJob
          ? {
              id: latestCaptionJob.id,
              status: latestCaptionJob.status,
              outputUrl: latestCaptionJob.outputUrl,
              errorMsg: latestCaptionJob.errorMsg,
              createdAt: latestCaptionJob.createdAt.toISOString(),
            }
          : null
      }
      latestCompletedCaptionJob={
        latestCompletedCaptionJob
          ? {
              status: latestCompletedCaptionJob.status,
              outputUrl: latestCompletedCaptionJob.outputUrl,
            }
          : null
      }
      latestDescriptionJob={
        latestDescriptionJob
          ? {
              status: latestDescriptionJob.status,
              result: latestDescriptionJob.result,
            }
          : null
      }
      clientValidation={{
        needsClientValidation: resolvedConfig.needsClientValidation,
        allowsClientRevision: resolvedConfig.allowsClientRevision,
        needsClientValidationOverride: slot.needsClientValidationOverride,
        allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
        activeToken: activeValidationToken
          ? {
              id: activeValidationToken.id,
              createdAt: activeValidationToken.createdAt.toISOString(),
              expiresAt: activeValidationToken.expiresAt.toISOString(),
              createdBy: activeValidationToken.createdBy,
            }
          : null,
        rounds: validationRounds.map((r) => ({
          roundNumber: r.roundNumber,
          action: r.action,
          comment: r.comment,
          respondedAt: r.respondedAt.toISOString(),
        })),
      }}
      resolvedConfig={{
        coverMode: resolvedConfig.coverMode,
        coverPresetId: resolvedConfig.coverPresetId,
        needsCaptions: resolvedConfig.needsCaptions,
        captionPresetId: resolvedConfig.captionPresetId,
      }}
      comments={comments}
      commentsHasMore={commentsHasMore}
      activities={activities}
      activityHasMore={activityHasMore}
      currentUserId={userId}
      currentUserRole={role}
    />
  );
}

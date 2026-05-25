import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canMarkPublished } from "@/lib/permissions/publications";
import { computePublicationSteps } from "@/lib/publications/steps";
import { toUserRole } from "@/lib/permissions/role";
import { PublicationFiche } from "./PublicationFiche";
import type { CommentData } from "@/components/publications/CommentItem";
import type { ActivityItem } from "@/components/publications/ActivityTimeline";

type PageProps = { params: Promise<{ id: string }> };

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
          offre: true,
          client: { select: { name: true } },
        },
      },
      recipe: {
        select: {
          id: true,
          code: true,
          label: true,
          source: true,
          templateId: true,
          needsCover: true,
          needsCaptions: true,
          needsDescription: true,
          needsClientValidation: true,
        },
      },
      assigneeMonteur: { select: { id: true, name: true, email: true } },
      assigneeCm: { select: { id: true, name: true, email: true } },
      render: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          pngUrl: true,
          createdAt: true,
          coverFramePack: {
            select: { id: true, status: true, finalCoverUrl: true },
          },
          listing: { select: { id: true } },
        },
      },
    },
  });

  // 404 systématique : slot inexistant OU pas accessible (anti-énumération)
  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    notFound();
  }

  // Dériver le listing depuis le render si présent
  const listing = slot.render?.listing ?? null;

  // Fetch commentaires (50 premiers, oldest first)
  const rawComments = await prisma.publicationComment.findMany({
    where: { slotId: id },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: {
      author: { select: { id: true, name: true, email: true } },
    },
  });

  const comments: CommentData[] = rawComments.map((c) => ({
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

  // Fetch activités (30 premières, newest first)
  const rawActivities = await prisma.publicationActivity.findMany({
    where: { slotId: id },
    orderBy: { createdAt: "desc" },
    take: 31, // +1 pour détecter hasMore
    include: {
      actor: { select: { id: true, name: true } },
    },
  });

  const activityHasMore = rawActivities.length > 30;
  const activities: ActivityItem[] = rawActivities.slice(0, 30).map((a) => ({
    id: a.id,
    type: a.type,
    payload: (a.payload as Record<string, unknown> | null) ?? null,
    createdAt: a.createdAt.toISOString(),
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
  }));

  // Calcul des steps
  const steps = computePublicationSteps({
    slot: { status: slot.status, caption: slot.caption },
    recipe: slot.recipe ?? null,
    renderJob: slot.render ?? null,
    coverPack: slot.render?.coverFramePack ?? null,
    captionJob: null,
    descriptionJob: null,
  });

  // Permissions UI
  const userForPermission = { id: userId, role };
  const slotForPermission = {
    assigneeMonteurId: slot.assigneeMonteurId,
    assigneeCmId: slot.assigneeCmId,
  };

  const canPublish = canMarkPublished(userForPermission, slotForPermission);
  const canDelete = role === "ADMIN";
  const canEditRender = role === "ADMIN";
  const canEditCover = role === "ADMIN" || role === "CM";
  const canEditCaptions = role === "ADMIN" || role === "MONTEUR" || role === "CM";
  const canEditDescription = role === "ADMIN" || role === "CM";

  return (
    <PublicationFiche
      slot={{
        id: slot.id,
        title: slot.title,
        status: slot.status,
        scheduledAt: slot.scheduledAt,
        contentType: slot.contentType,
        caption: slot.caption,
        description: slot.description,
        publishedUrl: slot.publishedUrl,
        publishedAt: slot.publishedAt,
        notes: slot.notes,
      }}
      account={{
        id: slot.account.id,
        handle: slot.account.handle,
        name: slot.account.name,
        offre: slot.account.offre,
      }}
      listing={listing}
      recipe={
        slot.recipe
          ? {
              id: slot.recipe.id,
              code: slot.recipe.code,
              label: slot.recipe.label,
              source: slot.recipe.source,
              templateId: slot.recipe.templateId,
              needsCover: slot.recipe.needsCover,
              needsCaptions: slot.recipe.needsCaptions,
              needsDescription: slot.recipe.needsDescription,
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
      coverPack={slot.render?.coverFramePack ?? null}
      assigneeMonteur={slot.assigneeMonteur}
      assigneeCm={slot.assigneeCm}
      steps={steps}
      canMarkPublished={canPublish}
      canDelete={canDelete}
      canEditRender={canEditRender}
      canEditCover={canEditCover}
      canEditCaptions={canEditCaptions}
      canEditDescription={canEditDescription}
      comments={comments}
      activities={activities}
      activityHasMore={activityHasMore}
      currentUserId={userId}
      currentUserRole={role}
    />
  );
}

import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canMarkPublished } from "@/lib/permissions/publications";
import { computePublicationSteps } from "@/lib/publications/steps";
import { PublicationFiche } from "./PublicationFiche";
import type { UserRole } from "@/types/roles";
import { USER_ROLES } from "@/types/roles";

/** Normalise un rôle brut vers UserRole. Valeur inconnue → USER. */
function toUserRole(raw?: string | null): UserRole {
  if (raw && Object.hasOwn(USER_ROLES, raw)) return raw as UserRole;
  return "USER";
}

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

  return (
    <PublicationFiche
      slot={{
        id: slot.id,
        title: slot.title,
        status: slot.status,
        scheduledAt: slot.scheduledAt,
        contentType: slot.contentType,
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
            }
          : null
      }
      assigneeMonteur={slot.assigneeMonteur}
      assigneeCm={slot.assigneeCm}
      steps={steps}
      canMarkPublished={canPublish}
      canDelete={canDelete}
    />
  );
}

import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
import { getEvent } from "@/lib/services/event/eventService";
import { canAttachReelToEvent, canUploadEventRushes } from "@/lib/permissions/eventScope";
import { NotFoundError } from "@/lib/services/_runtime/errors";
import { PageShell } from "@/components/ui/PageShell";
import { EventFiche, type EventFicheData } from "@/components/events/EventFiche";
import { longDateTimeFr } from "@/lib/date/formatFr";
import type { ShootEventStatus } from "@/types/events";

type Params = { params: Promise<{ id: string }> };

export default async function EventDetailPage({ params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  let event;
  try {
    event = await getEvent(id, userContext);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  // Recettes actives du compte pour le modal d'attache — uniquement les recettes
  // de montage manuel (manual_rushes/external_upload) : une recette auto_template
  // casserait la chaîne de production du reel (step Rendu fantôme).
  const bindings = await prisma.patternBinding.findMany({
    where: {
      accountId: event.accountId,
      isActive: true,
      patternTemplate: { source: { in: ["manual_rushes", "external_upload"] } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, customLabel: true, patternTemplate: { select: { label: true } } },
  });
  const recipes = bindings.map((b) => ({
    id: b.id,
    label: b.customLabel ?? b.patternTemplate.label,
  }));

  const canUploadRushes = canUploadEventRushes(
    { assigneeVideasteId: event.assigneeVideasteId },
    role,
    userId,
  );
  const canAttach = canAttachReelToEvent(role);

  const data: EventFicheData = {
    id: event.id,
    title: event.title,
    status: event.status as ShootEventStatus,
    accountLabel: event.account?.handle ?? null,
    propertyLabel: event.property?.label ?? null,
    scheduledAtLabel: longDateTimeFr(event.scheduledAt),
    videasteName: event.assigneeVideaste?.name ?? null,
    notes: event.notes,
    reels: event.slots.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
    })),
    rushes: event.rushes.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      durationSec: r.durationSec,
      uploadedAt: r.uploadedAt.toISOString(),
      uploadedByName: r.uploadedBy?.name ?? null,
    })),
    activities: event.activities.map((a) => ({
      id: a.id,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
      actorName: a.actor?.name ?? null,
    })),
  };

  return (
    <PageShell variant="narrow">
      <EventFiche
        event={data}
        recipes={recipes}
        canUploadRushes={canUploadRushes}
        canAttachReel={canAttach}
      />
    </PageShell>
  );
}

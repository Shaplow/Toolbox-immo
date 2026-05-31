import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { isSafeRelativePath } from "@/lib/safeUrl";
import { TranscriptionList } from "@/components/transcription/TranscriptionList";

export default async function TranscriptionPage({
  searchParams,
}: {
  // V2 friction MED-6 du audit 2026-05-31 : avant, /transcriptions n'acceptait
  // aucun paramètre de contexte. Si un CM/admin arrivait depuis une fiche,
  // aucun retour automatique. Désormais on lit slotId + returnTo pour
  // afficher un banner contextuel et un breadcrumb retour. Pattern aligné
  // sur /descriptions et /captions/[presetId]/generate.
  searchParams: Promise<{ slotId?: string; returnTo?: string }>;
}) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    redirect("/home");
  }

  const { slotId: rawSlotId, returnTo: rawReturnTo } = await searchParams;

  // Validation slot : 404 anti-énumération si non accessible.
  let slotContext: { id: string; title: string | null; accountHandle: string } | null = null;
  if (rawSlotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: rawSlotId },
      select: {
        id: true,
        title: true,
        assigneeMonteurId: true,
        assigneeCmId: true,
        assigneeVideasteId: true,
        account: { select: { handle: true } },
      },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (slot && canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
      slotContext = {
        id: slot.id,
        title: slot.title,
        accountHandle: slot.account.handle,
      };
    }
  }

  // returnTo : URL relative seulement (anti-open-redirect). Fallback sur la
  // fiche du slot si valide, sinon null.
  const safeReturnTo =
    rawReturnTo && isSafeRelativePath(rawReturnTo)
      ? rawReturnTo
      : slotContext
      ? `/publications/${slotContext.id}`
      : null;

  const jobs = await prisma.transcriptionJob.findMany({
    where: { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      inputFilename: true,
      model: true,
      language: true,
      enableDiarization: true,
      hasDiarization: true,
      segmentCount: true,
      duration: true,
      createdAt: true,
      errorMsg: true,
    },
  });

  return (
    <TranscriptionList
      initialJobs={jobs.map((j) => ({
        ...j,
        status: j.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        createdAt: j.createdAt.toISOString(),
      }))}
      slotContext={slotContext}
      returnTo={safeReturnTo}
    />
  );
}

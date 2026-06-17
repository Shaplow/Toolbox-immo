import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canUploadVersion, canPromoteVersion } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { VersionsSection } from "@/components/publications/sections/VersionsSection";

/**
 * /publications/[id]/versions — vue plein écran de l'historique versions.
 *
 * Phase 8 V2 — la fiche publication affiche désormais un preview top 3 des
 * versions (cf. PublicationFiche → VersionsSection displayMode="preview"). La
 * liste complète vit ici pour ne pas surcharger la fiche, tout en gardant les
 * actions upload / promote / soft-delete accessibles.
 */

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: { account: { select: { handle: true } } },
  });
  return {
    title: slot
      ? `Versions · @${slot.account.handle} | Toolbox Immo`
      : "Versions | Toolbox Immo",
  };
}

export default async function PublicationVersionsPage({ params }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      accountId: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      currentVersionId: true,
      account: { select: { handle: true, name: true } },
    },
  });
  if (!slot || !canUserAccessSlot(slot, role, userId)) notFound();

  const isAdmin = role === "ADMIN";
  const rawVersions = await prisma.publicationVersion.findMany({
    where: { slotId: id, ...(isAdmin ? {} : { deletedAt: null }) },
    orderBy: { versionNumber: "desc" },
    include: { uploadedBy: { select: { id: true, name: true, email: true } } },
  });

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

  const canUpload = canUploadVersion(
    { id: userId, role },
    { assigneeMonteurId: slot.assigneeMonteurId },
  );
  const canPromote = canPromoteVersion({ role });

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-[1400px] px-6 py-8"
        style={{ background: "rgb(212, 212, 216)" }}
      >
        <div className="rounded-t-3xl overflow-hidden px-6 sm:px-8 pt-6 pb-2">
          <div className="max-w-4xl mx-auto">
            <Link
              href={`/publications/${slot.id}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-gray-900 transition-colors font-medium"
            >
              <ArrowLeft size={13} />
              Retour à la publication
            </Link>
            <p className="mt-4 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              Publication · @{slot.account.handle}
            </p>
            <h1 className="mt-1 text-[28px] sm:text-[36px] font-semibold tracking-tight text-foreground leading-[1.05]">
              Versions livrées
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Historique complet des montages livrés pour ce slot.
            </p>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-4xl mx-auto">
            <VersionsSection
              slotId={slot.id}
              versions={versions}
              currentVersionId={slot.currentVersionId}
              canUploadVersion={canUpload}
              canPromoteVersion={canPromote}
              isAdmin={isAdmin}
              currentUserId={userId}
              displayMode="full"
              collapsible={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

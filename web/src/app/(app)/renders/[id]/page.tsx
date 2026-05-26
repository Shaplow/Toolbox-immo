import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RenderResult } from "@/components/renders/RenderResult";
import { getUserContext, parsePermissions } from "@/lib/userContext";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const render = await prisma.render.findUnique({
    where: { id },
    select: { template: { select: { name: true } } },
  });
  const name = render?.template?.name ?? "Rendu";
  return { title: `${name} | Toolbox Immo` };
}

export default async function RenderPage({ params }: Props) {
  const { id } = await params;
  const userContext = await getUserContext();
  if (!userContext) notFound();

  const render = await prisma.render.findUnique({
    where: { id },
    include: {
      listing: true,
      template: { select: { id: true, name: true, client: true, jsonData: true } },
      publicationSlot: {
        select: {
          id: true,
          pattern: { select: { coverMode: true, coverConfig: true } },
        },
      },
    },
  });

  if (!render) notFound();

  // Security: ensure render belongs to the user (admin can access any render)
  const isAdmin = userContext.canAdminBypass;
  const userPerms = parsePermissions(userContext.effectiveUser.permissions);
  const hasCovers = isAdmin || userPerms.includes("covers");

  // Lire Pattern.coverConfig (source de vérité Phase 1.8 — template.coverAutoConfig supprimé)
  const slotPattern = render.publicationSlot?.pattern;
  const patternCoverConfig = slotPattern?.coverMode === "auto" && slotPattern.coverConfig
    ? (slotPattern.coverConfig as { enabled?: boolean })
    : null;
  const coverAutoEnabled = patternCoverConfig?.enabled === true;
  if (!isAdmin) {
    const listing = await prisma.listing.findFirst({
      where: { id: render.listingId, userId: userContext.effectiveUser.id },
    });
    if (!listing) notFound();
  }

  // Lien retour contextualisé : fiche publication si lié, sinon liste des générations
  const backHref = render.publicationSlot?.id
    ? `/publications/${render.publicationSlot.id}`
    : "/listings";
  const backLabel = render.publicationSlot?.id ? "Retour à la publication" : "Retour aux générations";

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Lien retour — Phase 1.9 A3 */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ChevronLeft size={13} />
        {backLabel}
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Résultat</h1>
        <p className="text-sm text-gray-500 mt-1">
          {render.template
            ? `${render.template.name}${render.template.client ? ` · ${render.template.client}` : ""}`
            : "Template supprimé"}
        </p>
      </div>
      <RenderResult
        renderId={render.id}
        initialStatus={render.status}
        pngUrl={render.pngUrl}
        videoUrl={render.videoUrl}
        errorMsg={render.errorMsg}
        templateId={render.template?.id ?? ""}
        listingId={render.listingId}
        stage={render.stage}
        statusDetail={render.statusDetail}
        progress={render.progress}
        coverAutoEnabled={coverAutoEnabled}
        hasCovers={hasCovers}
      />
    </div>
  );
}

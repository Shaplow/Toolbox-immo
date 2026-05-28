import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { RenderResult } from "@/components/renders/RenderResult";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { getUserContext, parsePermissions } from "@/lib/userContext";
import { getSlotFinalVideoUrl } from "@/lib/publications/finalVideo";

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
          title: true,
          account: { select: { handle: true } },
          pattern: { select: { coverMode: true, coverConfig: true } },
          // Charge le dernier CaptionJob du slot pour résoudre la version finale
          // (captions incrustées si dispo, sinon vidéo brute).
          captionJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, outputUrl: true },
          },
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
  const patternCoverConfig = slotPattern?.coverMode === "autoPack" && slotPattern.coverConfig
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

  // Breadcrumb hiérarchisé. Deux variantes selon le contexte :
  // - Lié à une publication : Calendrier > [Publication] > Render
  // - Sinon : Templates > [Template] > Render
  const breadcrumb: { href: string; label: string }[] =
    render.publicationSlot
      ? [
          ...(isAdmin ? [{ href: "/calendar", label: "Calendrier" }] : []),
          {
            href: `/publications/${render.publicationSlot.id}`,
            label:
              render.publicationSlot.title ??
              `@${render.publicationSlot.account.handle}`,
          },
        ]
      : [
          { href: "/templates", label: "Templates" },
          ...(render.template
            ? [
                {
                  href: `/templates/${render.template.id}/edit`,
                  label: render.template.name,
                },
              ]
            : []),
        ];

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back link + breadcrumb hiérarchisé */}
      <div className="mb-6 space-y-1.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronLeft size={13} />
          {backLabel}
        </Link>
        {breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
            {breadcrumb.map((item, i) => (
              <span key={item.href} className="flex items-center gap-1">
                <Link
                  href={item.href}
                  className="hover:text-indigo-600 transition-colors truncate max-w-[200px]"
                >
                  {item.label}
                </Link>
                <ChevronRight size={11} className="text-gray-300" />
                {i === breadcrumb.length - 1 && (
                  <span className="text-gray-500 font-medium">Render</span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>

      <ToolPageHeader
        icon={Sparkles}
        iconColor="indigo"
        title={render.template?.name ?? "Résultat"}
        subtitle={
          render.template?.client
            ? `${render.template.client} · ${new Date(render.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : render.template
              ? `Généré le ${new Date(render.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : "Template supprimé"
        }
      />
      <RenderResult
        renderId={render.id}
        initialStatus={render.status}
        pngUrl={render.pngUrl}
        videoUrl={
          // Si ce render est lié à un slot avec captions COMPLETED, on affiche
          // la version sous-titrée. Sinon, vidéo brute du render.
          getSlotFinalVideoUrl({
            render: { videoUrl: render.videoUrl },
            latestCaptionJob: render.publicationSlot?.captionJobs[0] ?? null,
          })
        }
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

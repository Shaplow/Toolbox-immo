import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
          title: true,
          account: { select: { handle: true } },
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

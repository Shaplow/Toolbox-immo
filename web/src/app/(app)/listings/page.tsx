import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ListingsClient, type ListingRow, type CaptionJobRow, type TranscriptionJobRow, type DescriptionJobRow, type CoverPackRow } from "@/components/listings/ListingsClient";
import { getUserContext, parsePermissions } from "@/lib/userContext";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { toUserRole } from "@/lib/permissions/role";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { History, Info, ChevronLeft, X } from "lucide-react";

const LISTING_INCLUDE = {
  template: { select: { id: true, name: true, client: true, formats: true } },
  user: { select: { name: true, email: true } },
  renders: {
    orderBy: { createdAt: "asc" } as const,
    select: {
      id: true,
      status: true,
      pngUrl: true,
      videoUrl: true,
      errorMsg: true,
      createdAt: true,
      coverFramePack: { select: { id: true, status: true } },
      // Phase 1.8 : la cover auto est désormais portée par le pattern du slot,
      // pas par le template. On joint pattern.coverMode pour activer le bouton
      // "Générer Cover" sur les renders dont le slot a un pattern coverMode=auto.
      publicationSlot: {
        select: {
          id: true,
          pattern: { select: { coverMode: true } },
        },
      },
    },
  },
} as const;

interface PageProps {
  searchParams: Promise<{ slotId?: string }>;
}

export default async function ListingsPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  // L'impersonation s'applique : la vue est celle de effectiveUser.
  // Un admin qui impersonne un MONTEUR voit la vue exacte de ce MONTEUR :
  // ses propres listings + les listings dont les renders sont assignés à lui via slot.
  const userId = userContext!.effectiveUser.id;
  const isAdmin = userContext!.canAdminBypass;
  const effectiveRole = toUserRole(userContext!.effectiveUser.role);

  // Phase nav 2026-05-28 — filtre slotId optionnel : permet de voir tous les
  // jobs (renders, captions, transcriptions, descriptions) liés à une publi
  // précise. Le bouton "Voir tous les jobs de cette publi" sur la fiche
  // mène ici.
  const { slotId: filterSlotId } = await searchParams;
  let slotBannerContext: { id: string; title: string | null; handle: string } | null = null;
  if (filterSlotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: filterSlotId },
      select: {
        id: true,
        title: true,
        assigneeMonteurId: true,
        assigneeCmId: true,
        assigneeVideasteId: true,
        account: { select: { handle: true } },
      },
    });
    if (slot && canUserAccessSlot(slot, effectiveRole, userId)) {
      slotBannerContext = {
        id: slot.id,
        title: slot.title,
        handle: slot.account.handle,
      };
    }
  }

  const userPerms = parsePermissions(userContext!.effectiveUser.permissions);
  const hasCaptions = isAdmin || userPerms.includes("captions");
  const hasTranscription = isAdmin || userPerms.includes("transcription");
  const hasDescription = isAdmin || userPerms.includes("description");
  const hasCovers = isAdmin || userPerms.includes("covers");

  // ---------------------------------------------------------------------------
  // Listings : filtrage selon le rôle
  //
  // ADMIN → tous les listings.
  // Autres → uniquement les listings dont userId = userId (ce qu'ils ont
  // eux-mêmes généré). Règle "je ne vois que ce que je génère, sauf admin".
  //
  // (2026-06-01) MONTEUR/CM ne voient plus les listings assignés via slot —
  // pour ces cas, la fiche /publications/[id] est l'unique surface où ils
  // agissent sur les renders d'une mission. Évite aussi le 404 trompeur du
  // bouton "Régénérer" depuis /listings sur un Listing non-propre.
  // ---------------------------------------------------------------------------

  let listings = await prisma.listing.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    include: LISTING_INCLUDE,
  });

  // Filtres slotId : appliqués via Prisma quand slotBannerContext est set.
  // CaptionJob et DescriptionJob ont slotId direct. TranscriptionJob via render.
  const slotFilterCaption = slotBannerContext ? { slotId: slotBannerContext.id } : {};
  const slotFilterDescription = slotBannerContext ? { slotId: slotBannerContext.id } : {};
  const slotFilterTranscription = slotBannerContext
    ? { render: { publicationSlotId: slotBannerContext.id } }
    : {};

  const captionJobs = await prisma.captionJob.findMany({
    where: {
      ...(isAdmin ? {} : { userId }),
      ...slotFilterCaption,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const transcriptionJobs = await prisma.transcriptionJob.findMany({
    where: {
      ...(isAdmin ? {} : { userId }),
      ...slotFilterTranscription,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const descriptionJobs = await prisma.descriptionJob.findMany({
    where: {
      ...(isAdmin ? {} : { userId }),
      ...slotFilterDescription,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      prompt: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  // Cover packs : même règle de scope que les autres jobs.
  // Filtre slot : pack lié à un render dont le slot est ciblé, OU pack lié à
  // une PublicationVersion du slot (covers manuels sur version uploadée).
  const slotFilterCoverPack = slotBannerContext
    ? {
        OR: [
          { render: { publicationSlotId: slotBannerContext.id } },
          { publicationVersion: { slotId: slotBannerContext.id } },
        ],
      }
    : {};
  const coverPacks = await prisma.coverFramePack.findMany({
    where: {
      ...(isAdmin ? {} : { userId }),
      ...slotFilterCoverPack,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
      template: { select: { id: true, name: true } },
      render: {
        select: {
          publicationSlot: {
            select: {
              id: true,
              title: true,
              account: { select: { handle: true } },
            },
          },
        },
      },
      publicationVersion: {
        select: {
          slot: {
            select: {
              id: true,
              title: true,
              account: { select: { handle: true } },
            },
          },
        },
      },
    },
  });

  // Pour les listings : filtrer post-fetch pour ne garder que ceux dont au
  // moins un render est lié au slot ciblé.
  if (slotBannerContext) {
    listings = listings.filter((l) =>
      l.renders.some((r) => r.publicationSlot?.id === slotBannerContext!.id),
    );
  }

  // Serialize for the client component
  const rows: ListingRow[] = listings.map((l) => ({
    id: l.id,
    templateId: l.templateId,
    jsonData: l.jsonData,
    createdAt: l.createdAt.toISOString(),
    ownerName: isAdmin ? (l.user.name ?? l.user.email ?? "?") : null,
    template: l.template
      ? { id: l.template.id, name: l.template.name, client: l.template.client, formats: l.template.formats }
      : null,
    renders: l.renders.map((r) => ({
      id: r.id,
      status: r.status as string,
      pngUrl: r.pngUrl ?? null,
      videoUrl: r.videoUrl ?? null,
      errorMsg: r.errorMsg ?? null,
      createdAt: r.createdAt.toISOString(),
      coverPack: r.coverFramePack ? { id: r.coverFramePack.id, status: r.coverFramePack.status } : null,
      // Cover auto activée si le slot lié a un pattern coverMode=autoPack (Phase 2.5).
      coverAutoEnabled: r.publicationSlot?.pattern?.coverMode === "autoPack",
    })),
  }));

  const captionRows: CaptionJobRow[] = captionJobs.map((j) => {
    // Extract filename from inputUrl, strip extension
    let inputName: string | null = null;
    if (j.inputUrl) {
      const raw = j.inputUrl.split("/").pop()?.split("?")[0] ?? "";
      inputName = raw.replace(/\.[^.]+$/, "") || null;
    }
    return {
      id: j.id,
      status: j.status,
      outputUrl: j.outputUrl ?? null,
      inputName,
      createdAt: j.createdAt.toISOString(),
      ownerName: isAdmin ? (j.user.name ?? j.user.email ?? "?") : null,
      presetId: j.presetId ?? null,
      errorMsg: j.errorMsg ?? null,
    };
  });

  const transcriptionRows: TranscriptionJobRow[] = transcriptionJobs.map((j) => ({
    id: j.id,
    status: j.status,
    inputFilename: j.inputFilename ?? null,
    model: j.model,
    language: j.language ?? null,
    enableDiarization: j.enableDiarization,
    hasDiarization: j.hasDiarization,
    segmentCount: j.segmentCount ?? null,
    duration: j.duration ?? null,
    errorMsg: j.errorMsg ?? null,
    createdAt: j.createdAt.toISOString(),
    ownerName: isAdmin ? (j.user.name ?? j.user.email ?? "?") : null,
  }));

  const descriptionRows: DescriptionJobRow[] = descriptionJobs.map((j) => ({
    id: j.id,
    status: j.status,
    inputFilename: j.inputFilename ?? null,
    inputType: j.inputType,
    promptId: j.promptId ?? null,
    model: j.model,
    result: j.result ?? null,
    errorMsg: j.errorMsg ?? null,
    createdAt: j.createdAt.toISOString(),
    ownerName: isAdmin ? (j.user.name ?? j.user.email ?? "?") : null,
    prompt: j.prompt ?? null,
  }));

  const coverPackRows: CoverPackRow[] = coverPacks.map((p) => {
    const linkedSlot = p.render?.publicationSlot ?? p.publicationVersion?.slot ?? null;
    return {
      id: p.id,
      status: p.status,
      finalCoverUrl: p.finalCoverUrl ?? null,
      errorMsg: p.errorMsg ?? null,
      createdAt: p.createdAt.toISOString(),
      ownerName: isAdmin ? (p.user.name ?? p.user.email ?? "?") : null,
      templateName: p.template?.name ?? null,
      slotId: linkedSlot?.id ?? null,
      slotTitle: linkedSlot?.title ?? null,
      accountHandle: linkedSlot?.account.handle ?? null,
    };
  });

  const inProgressCount =
    rows.reduce((n, l) => n + l.renders.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").length, 0) +
    captionRows.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length +
    transcriptionRows.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length +
    coverPackRows.filter((p) => p.status === "PROCESSING" || p.status === "QUEUED").length;

  const totalItems =
    rows.length +
    captionRows.length +
    transcriptionRows.length +
    descriptionRows.length +
    coverPackRows.length;
  const subtitleParts = [`${totalItems} élément${totalItems !== 1 ? "s" : ""}`];
  if (inProgressCount > 0) subtitleParts.push(`${inProgressCount} en cours`);

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        {/* Header (icône + titre + subtitle + actions) */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="px-6 sm:px-8 pt-6 pb-2">
            <ToolPageHeader
              icon={History}
              iconColor="peach"
              title={
                slotBannerContext
                  ? "Jobs de cette publication"
                  : isAdmin
                    ? "Historique des générations"
                    : "Mon historique"
              }
              subtitle={subtitleParts.join(" · ")}
              actions={<RefreshButton title="Rafraîchir la liste" />}
            />
          </div>
        </div>

        {/* Banner filtre slot (glass v2 sky) */}
        {slotBannerContext && (
          <div className="px-6 sm:px-8 pb-3">
            <div className="rounded-2xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.32)] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 text-[12.5px]">
                <Info size={13} className="text-sky-600 shrink-0" />
                <span className="text-sky-900">
                  Jobs filtrés pour{" "}
                  <span className="font-semibold">
                    {slotBannerContext.title ?? `@${slotBannerContext.handle}`}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/publications/${slotBannerContext.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900 transition-colors"
                >
                  <ChevronLeft size={11} />
                  Retour à la publication
                </Link>
                <Link
                  href="/listings"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900 transition-colors"
                  title="Effacer le filtre"
                >
                  <X size={11} />
                  Tout voir
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Body : timeline */}
        <div className="px-4 sm:px-6 md:px-8 pt-2 pb-12">
          <ListingsClient
            initialListings={rows}
            initialCaptionJobs={captionRows}
            initialTranscriptionJobs={transcriptionRows}
            initialDescriptionJobs={descriptionRows}
            initialCoverPacks={coverPackRows}
            isAdmin={isAdmin}
            hasCaptions={hasCaptions}
            hasTranscription={hasTranscription}
            hasDescription={hasDescription}
            hasCovers={hasCovers}
          />
        </div>
      </div>
    </div>
  );
}

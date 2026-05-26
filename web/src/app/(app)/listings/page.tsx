import { prisma } from "@/lib/prisma";
import { ListingsClient, type ListingRow, type CaptionJobRow, type TranscriptionJobRow, type DescriptionJobRow } from "@/components/listings/ListingsClient";
import { getUserContext, parsePermissions } from "@/lib/userContext";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { toUserRole } from "@/lib/permissions/role";
import { List } from "lucide-react";

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
          pattern: { select: { coverMode: true } },
        },
      },
    },
  },
} as const;

export default async function ListingsPage() {
  const userContext = await getUserContext();
  // L'impersonation s'applique : la vue est celle de effectiveUser.
  // Un admin qui impersonne un MONTEUR voit la vue exacte de ce MONTEUR :
  // ses propres listings + les listings dont les renders sont assignés à lui via slot.
  const userId = userContext!.effectiveUser.id;
  const isAdmin = userContext!.canAdminBypass;
  const effectiveRole = toUserRole(userContext!.effectiveUser.role);

  const userPerms = parsePermissions(userContext!.effectiveUser.permissions);
  const hasCaptions = isAdmin || userPerms.includes("captions");
  const hasTranscription = isAdmin || userPerms.includes("transcription");
  const hasDescription = isAdmin || userPerms.includes("description");
  const hasCovers = isAdmin || userPerms.includes("covers");

  // ---------------------------------------------------------------------------
  // Listings : filtrage selon le rôle
  //
  // ADMIN   → tous les listings (comportement précédent inchangé)
  // USER    → uniquement les listings dont userId = userId
  // MONTEUR → listings dont userId = userId  OR  render.publicationSlot.assigneeMonteurId = actualUserId
  // CM      → listings dont userId = userId  OR  render.publicationSlot.assigneeCmId    = actualUserId
  //
  // Pour MONTEUR/CM : 2 requêtes séparées + merge JS afin d'éviter une jointure
  // imbriquée complexe (OR sur 2 niveaux de relation). Volumétrie : ~10 comptes,
  // ~30-40 publications/semaine → pas de contrainte de perf.
  // ---------------------------------------------------------------------------

  let listings: Awaited<ReturnType<typeof prisma.listing.findMany<{ include: typeof LISTING_INCLUDE }>>>;

  if (isAdmin) {
    listings = await prisma.listing.findMany({
      where: {},
      orderBy: { createdAt: "desc" },
      include: LISTING_INCLUDE,
    });
  } else if (effectiveRole === "MONTEUR" || effectiveRole === "CM") {
    // Requête 1 : listings dont l'utilisateur effectif est propriétaire
    const ownListings = await prisma.listing.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: LISTING_INCLUDE,
    });

    // Requête 2 : listings dont un render est associé à un slot assigné à l'utilisateur effectif
    const assigneeField = effectiveRole === "MONTEUR" ? "assigneeMonteurId" : "assigneeCmId";
    const assignedListings = await prisma.listing.findMany({
      where: {
        renders: {
          some: {
            publicationSlot: {
              [assigneeField]: userId,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      include: LISTING_INCLUDE,
    });

    // Merge et déduplication par id, tri global par createdAt desc
    const seen = new Set<string>();
    const merged = [...ownListings, ...assignedListings].filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    listings = merged;
  } else {
    // USER ou rôle inconnu : uniquement ses propres listings
    listings = await prisma.listing.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: LISTING_INCLUDE,
    });
  }

  const captionJobs = await prisma.captionJob.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const transcriptionJobs = await prisma.transcriptionJob.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const descriptionJobs = await prisma.descriptionJob.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      prompt: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

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
      // Cover auto activée si le slot lié a un pattern coverMode=auto (Phase 1.8).
      coverAutoEnabled: r.publicationSlot?.pattern?.coverMode === "auto",
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

  const inProgressCount =
    rows.reduce((n, l) => n + l.renders.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").length, 0) +
    captionRows.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length +
    transcriptionRows.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length;

  const totalItems = rows.length + captionRows.length + transcriptionRows.length + descriptionRows.length;
  const subtitleParts = [`${totalItems} élément${totalItems !== 1 ? "s" : ""}`];
  if (inProgressCount > 0) subtitleParts.push(`${inProgressCount} en cours`);

  return (
    <div className="p-8">
      <ToolPageHeader
        icon={List}
        iconColor="indigo"
        title={isAdmin ? "Historique des générations" : "Mon historique"}
        subtitle={subtitleParts.join(" · ")}
      />

      <ListingsClient
        initialListings={rows}
        initialCaptionJobs={captionRows}
        initialTranscriptionJobs={transcriptionRows}
        initialDescriptionJobs={descriptionRows}
        isAdmin={isAdmin}
        hasCaptions={hasCaptions}
        hasTranscription={hasTranscription}
        hasDescription={hasDescription}
        hasCovers={hasCovers}
      />
    </div>
  );
}

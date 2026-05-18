import { prisma } from "@/lib/prisma";
import { ListingsClient, type ListingRow, type CaptionJobRow, type TranscriptionJobRow, type DescriptionJobRow } from "@/components/listings/ListingsClient";
import { getUserContext, parsePermissions } from "@/lib/userContext";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { List } from "lucide-react";

export default async function ListingsPage() {
  const userContext = await getUserContext();
  const userId = userContext!.effectiveUser.id;
  const isAdmin = userContext!.canAdminBypass;

  const userPerms = parsePermissions(userContext!.effectiveUser.permissions);
  const hasCaptions = isAdmin || userPerms.includes("captions");
  const hasTranscription = isAdmin || userPerms.includes("transcription");
  const hasDescription = isAdmin || userPerms.includes("description");

  const listings = await prisma.listing.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { id: true, name: true, client: true, formats: true } },
      user: { select: { name: true, email: true } },
      renders: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          pngUrl: true,
          videoUrl: true,
          errorMsg: true,
          createdAt: true,
        },
      },
    },
  });

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

  const derushJobs = await prisma.derushJob.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true, email: true } },
      preset: { select: { name: true } },
      derushExports: { select: { id: true } },
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

  return (
    <div className="p-8">
      <ToolPageHeader
        icon={List}
        iconColor="indigo"
        title={isAdmin ? "Générations" : "Mes générations"}
        subtitle={`${rows.length} génération${rows.length !== 1 ? "s" : ""}${captionRows.length > 0 ? ` · ${captionRows.length} export${captionRows.length !== 1 ? "s" : ""} captions` : ""}${transcriptionRows.length > 0 ? ` · ${transcriptionRows.length} transcription${transcriptionRows.length !== 1 ? "s" : ""}` : ""}${descriptionRows.length > 0 ? ` · ${descriptionRows.length} description${descriptionRows.length !== 1 ? "s" : ""}` : ""}${inProgressCount > 0 ? ` · ${inProgressCount} en cours` : ""}`}
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
      />
    </div>
  );
}

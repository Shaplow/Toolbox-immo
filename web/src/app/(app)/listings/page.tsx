import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ListingsClient, type ListingRow, type CaptionJobRow } from "@/components/listings/ListingsClient";

export default async function ListingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isAdmin = (session!.user as { role?: string }).role === "ADMIN";

  const listings = await prisma.listing.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { id: true, name: true, client: true } },
      user: { select: { name: true, email: true } },
      renders: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          pngUrl: true,
          pdfUrl: true,
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

  // Serialize for the client component
  const rows: ListingRow[] = listings.map((l) => ({
    id: l.id,
    templateId: l.templateId,
    jsonData: l.jsonData,
    createdAt: l.createdAt.toISOString(),
    ownerName: isAdmin ? (l.user.name ?? l.user.email ?? "?") : null,
    template: l.template
      ? { id: l.template.id, name: l.template.name, client: l.template.client }
      : null,
    renders: l.renders.map((r) => ({
      id: r.id,
      status: r.status as string,
      pngUrl: r.pngUrl ?? null,
      pdfUrl: r.pdfUrl ?? null,
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
    };
  });

  const inProgressCount =
    rows.reduce((n, l) => n + l.renders.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").length, 0) +
    captionRows.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED").length;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {isAdmin ? "Productions" : "Mes listings"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {rows.length} listing{rows.length !== 1 ? "s" : ""}
            {captionRows.length > 0 && ` · ${captionRows.length} caption${captionRows.length !== 1 ? "s" : ""}`}
            {inProgressCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-indigo-700">
                <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse inline-block" />
                {inProgressCount} en cours
              </span>
            )}
          </p>
        </div>
      </div>

      <ListingsClient initialListings={rows} initialCaptionJobs={captionRows} isAdmin={isAdmin} />
    </div>
  );
}

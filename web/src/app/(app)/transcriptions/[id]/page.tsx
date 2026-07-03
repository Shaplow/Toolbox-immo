import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Video, Scissors, Sparkles } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { TranscriptionDetail } from "@/components/transcription/TranscriptionDetail";

export default async function TranscriptionJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    redirect("/home");
  }

  const { id } = await params;
  const job = await prisma.transcriptionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      inputFilename: true,
      model: true,
      language: true,
      languages: true,
      enableDiarization: true,
      hasDiarization: true,
      segmentCount: true,
      duration: true,
      createdAt: true,
      errorMsg: true,
      outputJsonKey: true,
      userId: true,
      render: {
        select: {
          id: true,
          publicationSlot: {
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

  if (!job) notFound();
  if (job.userId !== userContext.effectiveUser.id && !isAdmin) redirect("/home");

  const sourceRender = job.render;
  const sourceSlot = sourceRender?.publicationSlot ?? null;

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-3xl mx-auto">
      <Link
        href="/transcriptions"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground mb-6 transition-colors"
      >
        <ChevronLeft size={13} />
        Transcriptions
      </Link>

      {/* Bandeau source : render parent + publication si liée */}
      {sourceRender && (
        <div className="mb-6 flex items-center gap-3 bg-info-50 border border-info-200 rounded-xl px-5 py-3 text-sm">
          <Video size={16} className="text-info-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-info-700">
              Issue du{" "}
              <Link
                href={`/renders/${sourceRender.id}`}
                className="font-semibold text-info-700 hover:text-info-700 hover:underline"
              >
                render
              </Link>
              {sourceSlot && (
                <>
                  {" "}de la publication{" "}
                  <Link
                    href={`/publications/${sourceSlot.id}`}
                    className="font-semibold text-info-700 hover:text-info-700 hover:underline inline-flex items-center gap-1"
                  >
                    <FileText size={12} />
                    {sourceSlot.title ?? (sourceSlot.account ? `@${sourceSlot.account.handle}` : "Sans compte")}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <TranscriptionDetail
        job={{
          id: job.id,
          status: job.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
          inputFilename: job.inputFilename,
          model: job.model,
          language: job.language,
          languages: job.languages,
          enableDiarization: job.enableDiarization,
          hasDiarization: job.hasDiarization,
          segmentCount: job.segmentCount,
          duration: job.duration,
          createdAt: job.createdAt.toISOString(),
          errorMsg: job.errorMsg,
          hasOutput: !!job.outputJsonKey,
        }}
      />

      {/* Actions inline : "Utiliser dans..." pour fermer la boucle vers les
          outils captions/descriptions. Visible uniquement quand le job est
          complet (sinon ça pointerait vers une transcription vide). */}
      {job.status === "COMPLETED" && job.outputJsonKey && (
        <div className="mt-6 bg-white border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Utiliser cette transcription
          </h3>
          <div className="flex flex-wrap gap-2">
            <Link
              href={
                sourceSlot
                  ? `/captions?slotId=${sourceSlot.id}&transcriptionId=${job.id}&returnTo=/publications/${sourceSlot.id}`
                  : `/captions?transcriptionId=${job.id}`
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-danger-50 text-danger-700 border border-danger-200 hover:bg-danger-100 transition-colors text-sm font-medium"
            >
              <Scissors size={14} />
              Dans Sous-titres
            </Link>
            <Link
              href={
                sourceSlot
                  ? `/descriptions?slotId=${sourceSlot.id}`
                  : `/descriptions`
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-50 text-warning-700 border border-warning-200 hover:bg-warning-100 transition-colors text-sm font-medium"
            >
              <Sparkles size={14} />
              Dans Légende
            </Link>
          </div>
          {!sourceSlot && (
            <p className="text-xs text-muted-foreground mt-2">
              Cette transcription n&apos;est pas rattachée à une publication —
              le résultat sera créé en mode standalone.
            </p>
          )}
        </div>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}

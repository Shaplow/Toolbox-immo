import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { hasTool, TOOLS } from "@/lib/permissions";
import CaptionsGenerateForm from "@/components/captions/CaptionsGenerateForm";
import { getFromR2 } from "@/lib/r2";
import type { Segment } from "@/lib/transcriptionProcess";

type Props = {
  params: Promise<{ presetId: string }>;
  searchParams: Promise<{ captionJobId?: string; transcriptionId?: string }>;
};

export default async function CaptionsGeneratePage({ params, searchParams }: Props) {
  const { presetId } = await params;
  const { captionJobId, transcriptionId } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && !(await hasTool(session.user.id, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  let preset;
  if (isAdmin) {
    preset = await prisma.captionPreset.findUnique({ where: { id: presetId } });
  } else {
    const access = await prisma.captionPresetAccess.findFirst({
      where: { userId: session.user.id, presetId },
      include: { preset: true },
    });
    preset = access?.preset ?? null;
  }

  if (!preset) notFound();

  // Pre-load SRT from a previous job if captionJobId is provided
  let initialSrt: string | null = null;
  if (captionJobId) {
    const prevJob = await prisma.captionJob.findFirst({
      where: isAdmin
        ? { id: captionJobId }
        : { id: captionJobId, userId: session.user.id },
      select: { srtContent: true },
    });
    initialSrt = prevJob?.srtContent ?? null;
  }

  // Pre-load segments from a transcription job if transcriptionId is provided
  let initialSegments: Segment[] | null = null;
  if (transcriptionId) {
    const txJob = await prisma.transcriptionJob.findFirst({
      where: isAdmin
        ? { id: transcriptionId }
        : { id: transcriptionId, userId: session.user.id },
      select: { status: true, outputJsonKey: true },
    });
    if (txJob?.status === "COMPLETED" && txJob.outputJsonKey) {
      try {
        const buf = await getFromR2(txJob.outputJsonKey);
        initialSegments = JSON.parse(buf.toString("utf-8")) as Segment[];
      } catch {
        // Silently ignore — fallback to no preloaded segments
      }
    }
  }

  return (
    <CaptionsGenerateForm
      preset={{
        id: preset.id,
        name: preset.name,
        isBuiltin: preset.isBuiltin,
        config: JSON.parse(preset.config) as Record<string, unknown>,
      }}
      initialSrt={initialSrt}
      initialSegments={initialSegments}
      aiConfig={{
        hasClaude: !!process.env.ANTHROPIC_API_KEY,
        hasGpt: !!process.env.OPENAI_API_KEY,
      }}
    />
  );
}


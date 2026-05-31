import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { hasTool, TOOLS } from "@/lib/permissions";
import CaptionsGenerateForm from "@/components/captions/CaptionsGenerateForm";
import { getFromR2 } from "@/lib/r2";
import { readFile } from "fs/promises";
import path from "path";
import type { Segment } from "@/lib/transcriptionProcess";
import { getUserContext } from "@/lib/userContext";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import {
  CaptionPromptStorageUnavailableError,
  getCaptionPromptStorageMessage,
  listCaptionPromptRows,
} from "@/lib/captionPromptStore";
import "@/components/captions/captions.css";

type Props = {
  params: Promise<{ presetId: string }>;
  searchParams: Promise<{ captionJobId?: string; transcriptionId?: string; slotId?: string; returnTo?: string }>;
};

export default async function CaptionsGeneratePage({ params, searchParams }: Props) {
  const { presetId } = await params;
  const { captionJobId, transcriptionId, slotId, returnTo } = await searchParams;
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  const effectiveUserId = userContext.effectiveUser.id;
  if (!isAdmin && !(await hasTool(effectiveUserId, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  let preset;
  if (isAdmin) {
    preset = await prisma.captionPreset.findUnique({ where: { id: presetId } });
  } else {
    const access = await prisma.captionPresetAccess.findFirst({
      where: { userId: effectiveUserId, presetId },
      include: { preset: true },
    });
    preset = access?.preset ?? null;
  }

  if (!preset) notFound();

  // Validation perms slotId : si l'user invoque ?slotId=X, il doit pouvoir
  // accéder au slot (ADMIN, ou MONTEUR/CM assigné). Sinon 404 anti-énumération
  // (cohérent avec /api/calendar/slots/[id] qui retourne 404 si pas accès).
  if (slotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (!slot || !canUserAccessSlot(slot, role, effectiveUserId)) {
      notFound();
    }
  }

  // Pre-load SRT from a previous job if captionJobId is provided
  let initialSrt: string | null = null;
  let initialSubsJson: string | null = null;
  if (captionJobId) {
    const prevJob = await prisma.captionJob.findFirst({
      where: isAdmin
        ? { id: captionJobId }
        : { id: captionJobId, userId: effectiveUserId },
      select: { srtContent: true, srtFilename: true },
    });
    if (prevJob?.srtContent) {
      if (prevJob.srtFilename?.endsWith(".json")) {
        initialSubsJson = prevJob.srtContent;
      } else {
        initialSrt = prevJob.srtContent;
      }
    }
  }

  // Pre-load segments from a transcription job if transcriptionId is provided
  let initialSegments: Segment[] | null = null;
  if (transcriptionId) {
    const txJob = await prisma.transcriptionJob.findFirst({
      where: isAdmin
        ? { id: transcriptionId }
        : { id: transcriptionId, userId: effectiveUserId },
      select: { status: true, outputJsonKey: true },
    });
    if (txJob?.status === "COMPLETED" && txJob.outputJsonKey) {
      try {
        let buf: Buffer;
        if (txJob.outputJsonKey.startsWith("local/")) {
          const localPath = path.join(process.cwd(), "public", txJob.outputJsonKey.replace(/^local\//, ""));
          buf = await readFile(localPath);
        } else {
          buf = await getFromR2(txJob.outputJsonKey);
        }
        initialSegments = JSON.parse(buf.toString("utf-8")) as Segment[];
      } catch (err) {
        console.error("[captions/generate] Erreur chargement segments transcription:", err);
      }
    }
  }

  let promptStorageAvailable = true;
  let promptStorageMessage: string | null = null;
  let prompts = [] as Awaited<ReturnType<typeof listCaptionPromptRows>>;

  try {
    prompts = await listCaptionPromptRows();
  } catch (error) {
    if (error instanceof CaptionPromptStorageUnavailableError) {
      promptStorageAvailable = false;
      promptStorageMessage = getCaptionPromptStorageMessage(error);
      console.warn("[captions/generate] caption prompts unavailable", {
        reason: error.reason,
        message: error.message,
      });
    } else {
      throw error;
    }
  }

  // Anti-open-redirect : returnTo doit être une URL relative /
  const safeReturnTo =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : undefined;

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-4xl mx-auto">
            <CaptionsGenerateForm
              preset={{
                id: preset.id,
                name: preset.name,
                isBuiltin: preset.isBuiltin,
                config: JSON.parse(preset.config) as Record<string, unknown>,
              }}
              initialSrt={initialSrt}
              initialSubsJson={initialSubsJson}
              initialSegments={initialSegments}
              initialPrompts={prompts}
              promptStorageAvailable={promptStorageAvailable}
              promptStorageMessage={promptStorageMessage}
              aiConfig={{
                hasClaude: !!process.env.ANTHROPIC_API_KEY,
                hasGpt: !!process.env.OPENAI_API_KEY,
              }}
              slotId={slotId ?? null}
              returnTo={safeReturnTo ?? null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


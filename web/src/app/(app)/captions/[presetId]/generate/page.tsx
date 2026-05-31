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
import { resolveActiveTranscription } from "@/lib/publications/jobLifecycle";
import { triggerAutoTranscriptionForVersion } from "@/lib/triggerAutoTranscriptionForVersion";
import { triggerAutoTranscriptionForRender } from "@/lib/triggerAutoTranscription";

/**
 * Extrait la clé R2 depuis une URL publique R2 (convention `<publicUrl>/<key>`).
 * Retourne null si l'URL n'est pas parseable. Utilisé pour le fallback
 * auto_template (le slot n'a pas de currentVersion, juste un Render).
 */
function extractR2KeyFromVideoUrl(videoUrl: string): string | null {
  try {
    const u = new URL(videoUrl);
    return u.pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}
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
  //
  // V8.3 — Auto-résolution + auto-launch transcription quand on arrive depuis
  // la fiche avec ?slotId=X sans ?transcriptionId=Y :
  //   - Charge slot + version courante + active/latest transcription
  //   - Si transcription COMPLETED → pre-fill segments JSON (équivalent
  //     transcriptionId fourni par l'admin manuellement)
  //   - Si pending (QUEUED/PROCESSING) → passe jobId au form pour SSE listen
  //   - Si absente / FAILED → triggerAutoTranscriptionForVersion() puis idem
  //   - Si pas de version source → banner explicite, l'admin doit promote
  //     une version avant
  let resolvedTranscriptionId: string | null = transcriptionId ?? null;
  let pendingTranscription:
    | { jobId: string; status: string }
    | null = null;
  let transcriptionBlocker: string | null = null;
  if (slotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        assigneeMonteurId: true,
        assigneeCmId: true,
        assigneeVideasteId: true,
        currentVersionId: true,
        currentVersion: { select: { id: true, fileUrl: true, r2Key: true } },
        // Pour le fallback auto_template (pas de version, juste un render).
        render: {
          select: { id: true, templateId: true, videoUrl: true },
        },
        activeTranscriptionJob: {
          select: { id: true, status: true, staleSince: true },
        },
        transcriptionJobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, status: true, staleSince: true },
        },
      },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (!slot || !canUserAccessSlot(slot, role, effectiveUserId)) {
      notFound();
    }

    // Seulement auto-lookup/launch si l'admin n'a pas déjà fourni un
    // ?transcriptionId=Y (cas où il choisit manuellement une transcription
    // depuis /transcriptions).
    if (!resolvedTranscriptionId) {
      const active = resolveActiveTranscription({
        activeTranscriptionJob: slot.activeTranscriptionJob,
        transcriptionJobs: slot.transcriptionJobs,
      });

      if (active?.status === "COMPLETED") {
        resolvedTranscriptionId = active.id;
      } else if (active && (active.status === "QUEUED" || active.status === "PROCESSING")) {
        pendingTranscription = { jobId: active.id, status: active.status };
      } else if (slot.currentVersion?.fileUrl && slot.currentVersion?.r2Key) {
        // Cas manual_rushes / external_upload — il y a une version uploadée.
        try {
          await triggerAutoTranscriptionForVersion(slot.currentVersion.id);
          const justCreated = await prisma.transcriptionJob.findFirst({
            where: { publicationVersionId: slot.currentVersion.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true },
          });
          if (justCreated) {
            pendingTranscription = { jobId: justCreated.id, status: justCreated.status };
          } else {
            transcriptionBlocker =
              "Impossible de lancer la transcription automatiquement (configuration RunPod/R2 manquante ou pattern qui ne consomme pas la transcription).";
          }
        } catch (err) {
          console.error(`[captions/generate] auto-trigger transcription échoué pour slot=${slotId}:`, err);
          transcriptionBlocker =
            "Échec du déclenchement de la transcription. Réessaie depuis /transcriptions.";
        }
      } else if (slot.render?.id && slot.render.videoUrl) {
        // Fallback auto_template — pas de version mais un Render généré par le
        // pipeline. La clé R2 est dérivée de l'URL publique du render.
        const renderOutputKey = extractR2KeyFromVideoUrl(slot.render.videoUrl);
        if (!renderOutputKey) {
          transcriptionBlocker =
            "URL vidéo du render invalide — impossible d'en dériver la clé R2 pour la transcription.";
        } else {
          try {
            await triggerAutoTranscriptionForRender(
              slot.render.id,
              slot.render.templateId,
              renderOutputKey,
              effectiveUserId,
            );
            const justCreated = await prisma.transcriptionJob.findFirst({
              where: { renderId: slot.render.id },
              orderBy: { createdAt: "desc" },
              select: { id: true, status: true },
            });
            if (justCreated) {
              pendingTranscription = { jobId: justCreated.id, status: justCreated.status };
            } else {
              transcriptionBlocker =
                "Le pipeline auto a refusé la transcription pour ce render (template sans captionAutoConfig.enabled, RunPod off, ou autre garde). Vérifie la config du template.";
            }
          } catch (err) {
            console.error(`[captions/generate] auto-trigger render transcription échoué pour slot=${slotId}:`, err);
            transcriptionBlocker =
              "Échec du déclenchement de la transcription depuis le render. Réessaie depuis /transcriptions.";
          }
        }
      } else {
        transcriptionBlocker =
          "Aucune vidéo source disponible pour ce slot — promote une version ou lance un render avant.";
      }
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

  // Pre-load segments from a transcription job — soit l'ID fourni manuellement
  // (?transcriptionId=Y), soit celui résolu depuis slot.activeTranscriptionJob
  // ci-dessus (V8.3).
  let initialSegments: Segment[] | null = null;
  if (resolvedTranscriptionId) {
    const txJob = await prisma.transcriptionJob.findFirst({
      where: isAdmin
        ? { id: resolvedTranscriptionId }
        : { id: resolvedTranscriptionId, userId: effectiveUserId },
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
              pendingTranscription={pendingTranscription}
              transcriptionBlocker={transcriptionBlocker}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * POST /api/captions/correct
 *
 * Corrige automatiquement des sous-titres via IA à partir d'un prompt stocké en base.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { hasTool, TOOLS } from "@/lib/permissions";
import { parseHighlightedCaptions, type Caption } from "@/lib/srt";
import { normalizeCaptionAutoHighlight } from "@/lib/captionPrompt";
import {
  CaptionPromptStorageUnavailableError,
  findCaptionPromptForCorrection,
  getCaptionPromptStorageMessage,
} from "@/lib/captionPromptStore";
import {
  AUTO_HIGHLIGHT_GROUPS,
  correctWithClaude,
  correctWithGPT,
  isCaption,
  validateCorrectedCaptions,
} from "@/lib/captionCorrector";

type RequestBody = {
  captions: Caption[];
  promptId: string;
  model: "claude" | "gpt";
};

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  if (
    !userContext.canAdminBypass &&
    !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))
  ) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { captions, promptId, model } = body;

  if (!captions || !Array.isArray(captions) || captions.length === 0) {
    return NextResponse.json({ error: "Aucune caption fournie" }, { status: 400 });
  }
  if (captions.some((caption) => !isCaption(caption))) {
    return NextResponse.json({ error: "Format de captions invalide" }, { status: 400 });
  }
  if (!promptId || typeof promptId !== "string") {
    return NextResponse.json({ error: "Prompt manquant" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide (claude | gpt)" }, { status: 400 });
  }

  let storedPrompt;
  try {
    storedPrompt = await findCaptionPromptForCorrection(promptId);
  } catch (error) {
    if (error instanceof CaptionPromptStorageUnavailableError) {
      return NextResponse.json(
        { error: getCaptionPromptStorageMessage(error) },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!storedPrompt) {
    return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
  }

  const autoHighlight = normalizeCaptionAutoHighlight({
    enabled: storedPrompt.autoHighlightEnabled,
    mode: storedPrompt.autoHighlightMode,
    placement: storedPrompt.autoHighlightPlacement,
    prompt: storedPrompt.autoHighlightPrompt ?? "",
  });

  try {
    const sourceCaptions = captions.map((caption) => ({
      index: caption.index,
      start: caption.start,
      end: caption.end,
      text: caption.text,
    }));
    const existingHighlights = new Set<number>(
      Array.from(parseHighlightedCaptions(sourceCaptions).highlighted.values()),
    );
    const allowedHighlightGroups = new Set(existingHighlights);
    if (autoHighlight.enabled) {
      for (const group of AUTO_HIGHLIGHT_GROUPS[autoHighlight.mode]) {
        allowedHighlightGroups.add(group);
      }
    }

    const corrected =
      model === "claude"
        ? await correctWithClaude(sourceCaptions, storedPrompt.prompt, autoHighlight)
        : await correctWithGPT(sourceCaptions, storedPrompt.prompt, autoHighlight);

    return NextResponse.json(
      validateCorrectedCaptions(sourceCaptions, corrected, allowedHighlightGroups),
    );
  } catch (err) {
    console.error("[captions/correct]", err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 502 }
    );
  }
}

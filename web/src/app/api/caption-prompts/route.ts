import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/api/requireAuth";
import { hasTool, TOOLS } from "@/lib/permissions";
import {
  normalizeCaptionAutoHighlight,
} from "@/lib/captionPrompt";
import {
  CaptionPromptStorageUnavailableError,
  createCaptionPromptRow,
  getCaptionPromptStorageMessage,
  listCaptionPromptRows,
} from "@/lib/captionPromptStore";

type RequestBody = {
  name?: string;
  prompt?: string;
  autoHighlight?: unknown;
};

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  if (
    !userContext.canAdminBypass &&
    !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))
  ) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    return NextResponse.json(await listCaptionPromptRows());
  } catch (error) {
    if (error instanceof CaptionPromptStorageUnavailableError) {
      return NextResponse.json(
        { error: getCaptionPromptStorageMessage(error) },
        { status: 503 }
      );
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const prompt = body.prompt?.trim() ?? "";
  const autoHighlight = normalizeCaptionAutoHighlight(body.autoHighlight);

  if (!name || !prompt) {
    return NextResponse.json({ error: "Nom et prompt requis" }, { status: 400 });
  }

  try {
    const created = await createCaptionPromptRow({
      name,
      prompt,
      autoHighlightEnabled: autoHighlight.enabled,
      autoHighlightMode: autoHighlight.mode,
      autoHighlightPlacement: autoHighlight.placement,
      autoHighlightPrompt: autoHighlight.prompt || null,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof CaptionPromptStorageUnavailableError) {
      return NextResponse.json(
        { error: getCaptionPromptStorageMessage(error) },
        { status: 503 }
      );
    }
    throw error;
  }
}
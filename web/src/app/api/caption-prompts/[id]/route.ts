import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import {
  normalizeCaptionAutoHighlight,
} from "@/lib/captionPrompt";
import {
  CaptionPromptStorageUnavailableError,
  deleteCaptionPromptRow,
  getCaptionPromptStorageMessage,
  updateCaptionPromptRow,
} from "@/lib/captionPromptStore";

type RequestBody = {
  name?: string;
  prompt?: string;
  autoHighlight?: unknown;
};

async function requireAdmin() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id) {
    return { error: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  }
  if (!userContext.canAdminBypass) {
    return { error: NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 }) };
  }
  return { userContext };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { id } = await params;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const data: {
    name?: string;
    prompt?: string;
    autoHighlightEnabled?: boolean;
    autoHighlightMode?: string;
    autoHighlightPlacement?: string;
    autoHighlightPrompt?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
    }
    data.name = name;
  }

  if (body.prompt !== undefined) {
    const prompt = body.prompt.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Le prompt est requis" }, { status: 400 });
    }
    data.prompt = prompt;
  }

  if (body.autoHighlight !== undefined) {
    const autoHighlight = normalizeCaptionAutoHighlight(body.autoHighlight);
    data.autoHighlightEnabled = autoHighlight.enabled;
    data.autoHighlightMode = autoHighlight.mode;
    data.autoHighlightPlacement = autoHighlight.placement;
    data.autoHighlightPrompt = autoHighlight.prompt || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 });
  }

  try {
    const updated = await updateCaptionPromptRow(id, data);
    if (!updated) {
      return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
    }

    return NextResponse.json(updated);
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin();
  if (authResult.error) return authResult.error;

  const { id } = await params;

  try {
    const deleted = await deleteCaptionPromptRow(id);
    if (!deleted) {
      return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
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
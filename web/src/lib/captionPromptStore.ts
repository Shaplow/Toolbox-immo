import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeCaptionPrompt, type CaptionPromptRow } from "@/lib/captionPrompt";

type CaptionPromptModel = typeof prisma.captionPrompt;

export class CaptionPromptStorageUnavailableError extends Error {
  constructor(
    public readonly reason: "client-missing" | "table-missing",
    message?: string
  ) {
    super(message ?? "Caption prompt storage unavailable");
    this.name = "CaptionPromptStorageUnavailableError";
  }
}

function getCaptionPromptModel(): CaptionPromptModel | null {
  const model = (prisma as typeof prisma & { captionPrompt?: CaptionPromptModel }).captionPrompt;
  return model ?? null;
}

function isCaptionPromptTableMissing(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

function ensureCaptionPromptModel(): CaptionPromptModel {
  const model = getCaptionPromptModel();
  if (!model) {
    throw new CaptionPromptStorageUnavailableError(
      "client-missing",
      "Le client Prisma chargé ne connaît pas encore CaptionPrompt. Relance prisma generate puis redémarre Next.js."
    );
  }
  return model;
}

function rethrowIfCaptionPromptUnavailable(error: unknown): never {
  if (isCaptionPromptTableMissing(error)) {
    throw new CaptionPromptStorageUnavailableError(
      "table-missing",
      "La table CaptionPrompt n'existe pas encore en base. Applique la migration puis redémarre le serveur."
    );
  }
  throw error;
}

export function getCaptionPromptStorageMessage(error: CaptionPromptStorageUnavailableError): string {
  return error.message;
}

export async function listCaptionPromptRows(): Promise<CaptionPromptRow[]> {
  const model = ensureCaptionPromptModel();

  try {
    const prompts = await model.findMany({ orderBy: { createdAt: "asc" } });
    return prompts.map(serializeCaptionPrompt);
  } catch (error) {
    rethrowIfCaptionPromptUnavailable(error);
  }
}

export async function createCaptionPromptRow(input: {
  name: string;
  prompt: string;
  autoHighlightEnabled: boolean;
  autoHighlightMode: string;
  autoHighlightPlacement: string;
  autoHighlightPrompt: string | null;
}): Promise<CaptionPromptRow> {
  const model = ensureCaptionPromptModel();

  try {
    const created = await model.create({ data: input });
    return serializeCaptionPrompt(created);
  } catch (error) {
    rethrowIfCaptionPromptUnavailable(error);
  }
}

export async function updateCaptionPromptRow(
  id: string,
  data: {
    name?: string;
    prompt?: string;
    autoHighlightEnabled?: boolean;
    autoHighlightMode?: string;
    autoHighlightPlacement?: string;
    autoHighlightPrompt?: string | null;
  }
): Promise<CaptionPromptRow | null> {
  const model = ensureCaptionPromptModel();

  try {
    const updated = await model.update({ where: { id }, data });
    return serializeCaptionPrompt(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return null;
    }
    rethrowIfCaptionPromptUnavailable(error);
  }
}

export async function deleteCaptionPromptRow(id: string): Promise<boolean> {
  const model = ensureCaptionPromptModel();

  try {
    await model.delete({ where: { id } });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return false;
    }
    rethrowIfCaptionPromptUnavailable(error);
  }
}

export async function findCaptionPromptForCorrection(id: string): Promise<{
  prompt: string;
  autoHighlightEnabled: boolean;
  autoHighlightMode: string;
  autoHighlightPlacement: string;
  autoHighlightPrompt: string | null;
} | null> {
  const model = ensureCaptionPromptModel();

  try {
    return await model.findUnique({
      where: { id },
      select: {
        prompt: true,
        autoHighlightEnabled: true,
        autoHighlightMode: true,
        autoHighlightPlacement: true,
        autoHighlightPrompt: true,
      },
    });
  } catch (error) {
    rethrowIfCaptionPromptUnavailable(error);
  }
}
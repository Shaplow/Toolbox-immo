import { mergeCaptionConfig, type CaptionConfigState } from "@/lib/captionPresetConfig";

export const CAPTION_PRESET_TRANSFER_VERSION = 1;

export type CaptionPresetTransferPayload = {
  version: number;
  exportedAt: string;
  preset: {
    name: string;
    config: CaptionConfigState;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildCaptionPresetTransferPayload(input: {
  name: string;
  config: Partial<CaptionConfigState> | CaptionConfigState;
}): CaptionPresetTransferPayload {
  return {
    version: CAPTION_PRESET_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    preset: {
      name: input.name.trim() || "Preset captions importe",
      config: mergeCaptionConfig(input.config),
    },
  };
}

export function parseCaptionPresetTransferPayload(payload: unknown): {
  name: string;
  config: CaptionConfigState;
} {
  if (!isRecord(payload)) {
    throw new Error("Format d'import invalide");
  }

  const wrappedPreset = isRecord(payload.preset) ? payload.preset : payload;
  const name = typeof wrappedPreset.name === "string" ? wrappedPreset.name.trim() : "";
  const rawConfig = wrappedPreset.config;

  if (!name) {
    throw new Error("Le nom du preset est manquant dans le fichier");
  }

  if (!isRecord(rawConfig)) {
    throw new Error("La config du preset est invalide");
  }

  return {
    name,
    config: mergeCaptionConfig(rawConfig as Partial<CaptionConfigState>),
  };
}

export function buildCaptionPresetExportFilename(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preset-captions";

  return `${slug}.caption-preset.json`;
}
export type AutoHighlightMode = "highlight1" | "highlight2" | "both";
export type AutoHighlightPlacement = "before" | "after";

export type CaptionPromptAutoHighlight = {
  enabled: boolean;
  mode: AutoHighlightMode;
  placement: AutoHighlightPlacement;
  prompt: string;
};

export type CaptionPromptRow = {
  id: string;
  name: string;
  prompt: string;
  autoHighlight: CaptionPromptAutoHighlight;
  createdAt: string;
};

export const DEFAULT_CAPTION_AUTO_HIGHLIGHT: CaptionPromptAutoHighlight = {
  enabled: false,
  mode: "highlight1",
  placement: "after",
  prompt: "",
};

export function isAutoHighlightMode(value: unknown): value is AutoHighlightMode {
  return value === "highlight1" || value === "highlight2" || value === "both";
}

export function isAutoHighlightPlacement(value: unknown): value is AutoHighlightPlacement {
  return value === "before" || value === "after";
}

export function normalizeCaptionAutoHighlight(value: unknown): CaptionPromptAutoHighlight {
  if (!value || typeof value !== "object") return DEFAULT_CAPTION_AUTO_HIGHLIGHT;

  const candidate = value as Partial<CaptionPromptAutoHighlight>;
  return {
    enabled: candidate.enabled === true,
    mode: isAutoHighlightMode(candidate.mode)
      ? candidate.mode
      : DEFAULT_CAPTION_AUTO_HIGHLIGHT.mode,
    placement: isAutoHighlightPlacement(candidate.placement)
      ? candidate.placement
      : DEFAULT_CAPTION_AUTO_HIGHLIGHT.placement,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt.trim() : "",
  };
}

type CaptionPromptRecord = {
  id: string;
  name: string;
  prompt: string;
  autoHighlightEnabled: boolean;
  autoHighlightMode: string;
  autoHighlightPlacement: string;
  autoHighlightPrompt: string | null;
  createdAt: Date;
};

export function serializeCaptionPrompt(record: CaptionPromptRecord): CaptionPromptRow {
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    autoHighlight: normalizeCaptionAutoHighlight({
      enabled: record.autoHighlightEnabled,
      mode: record.autoHighlightMode,
      placement: record.autoHighlightPlacement,
      prompt: record.autoHighlightPrompt ?? "",
    }),
    createdAt: record.createdAt.toISOString(),
  };
}
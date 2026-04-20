export function normalizeCaptionConfig(configData: Record<string, unknown>): Record<string, unknown> {
  if (configData.engine === "ass") return configData;
  return { ...configData, engine: "ass" };
}
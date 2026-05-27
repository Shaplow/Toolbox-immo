/**
 * Helpers de formatage partagés du panel MediaAssets.
 * Voir mediaAssets/types.ts pour le contexte du split C1-v2.
 */

export function formatDuration(s: number | null): string {
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function formatDate(d: string | null): string {
  if (!d) return "Jamais";
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

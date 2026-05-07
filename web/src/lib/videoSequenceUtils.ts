import type { VideoSequenceSlot } from "@/types/template";

/** Résume la source vidéo d'un slot en une chaîne lisible. */
export function getSlotSourceSummary(
  slot: VideoSequenceSlot,
  schema: { key: string; label?: string }[],
  videoLibraries: { id: string; name: string }[],
): string {
  if (slot.binding) return schema.find((f) => f.key === slot.binding)?.label ?? slot.binding;
  if (slot.libraryId) return videoLibraries.find((l) => l.id === slot.libraryId)?.name ?? "Bibliothèque";
  return "Non configuré";
}

export type OverlayMode = "raw" | "data" | "groups";

/** Détermine le mode d'overlay d'un slot à partir de ses overlayGroupIds. */
export function getOverlayMode(slot: VideoSequenceSlot): OverlayMode {
  if (slot.overlayGroupIds === undefined) return "data";
  if (slot.overlayGroupIds.length === 0) return "raw";
  return "groups";
}

/** Résume le mode d'overlay en une courte étiquette. */
export function getOverlaySummary(slot: VideoSequenceSlot): string {
  const mode = getOverlayMode(slot);
  if (mode === "raw") return "clip seul";
  if (mode === "groups") return "groupes";
  return "avec infos";
}

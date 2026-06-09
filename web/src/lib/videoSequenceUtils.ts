import type { AnyBlock, TemplateJSON, VideoBlock, VideoSequenceSlot } from "@/types/template";

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

/**
 * Construit un slot par défaut depuis un VideoBlock du canvas. Utilisé par
 * la migration et par l'éditeur quand on ajoute le premier clip.
 *
 * Copie les références source (libraryId, binding, selectionRule) du
 * VideoBlock pour que le clip pointe au même contenu que le mode legacy
 * "single video". `videoBlockId` pointe sur le block lui-même pour le
 * positionnement (x/y/w/h/fit) lors du composite FFmpeg.
 */
export function buildDefaultSlotFromVideoBlock(
  videoBlock: VideoBlock,
  options: { id: string; label?: string } = { id: "" },
): VideoSequenceSlot {
  return {
    id: options.id,
    label: options.label ?? "Vidéo",
    videoBlockId: videoBlock.id,
    binding: videoBlock.binding,
    libraryId: videoBlock.libraryId,
    selectionRule: videoBlock.selectionRule,
  };
}

/**
 * Garantit qu'un template a au moins un slot dans videoSequence si un
 * VideoBlock existe. Utilisé pour migrer doucement les templates legacy
 * vers le mode séquence unifié sans casser le rendu en attendant la
 * migration DB.
 *
 * Retourne `template` inchangé si :
 * - videoSequence est déjà non-vide, OU
 * - aucun VideoBlock n'existe dans le template.
 *
 * Sinon, retourne une copie avec videoSequence = [slot par défaut].
 *
 * Pure : ne mute pas l'input. Idempotent.
 */
export function ensureVideoSequence(
  template: TemplateJSON,
  generateId: () => string = () => Math.random().toString(36).slice(2, 8),
): TemplateJSON {
  const slots = template.videoSequence ?? [];
  if (slots.length > 0) return template;
  const videoBlock = template.blocks.find(
    (b): b is VideoBlock => b.type === "video",
  );
  if (!videoBlock) return template;
  return {
    ...template,
    videoSequence: [buildDefaultSlotFromVideoBlock(videoBlock, { id: generateId() })],
  };
}

/**
 * Indique si un bloc apparaît dans un slot donné en se basant sur le mode
 * d'overlay du slot (overlayGroupIds).
 *
 * - `overlayGroupIds === undefined` (mode "data") : tous les blocs visibles.
 * - `overlayGroupIds === []` (mode "raw") : aucun bloc.
 * - `overlayGroupIds = [...]` (mode "groups") : seulement les blocs dont
 *   `groupId` est listé.
 */
export function isBlockVisibleInSlot(block: AnyBlock, slot: VideoSequenceSlot): boolean {
  if (slot.overlayGroupIds === undefined) return true;
  if (slot.overlayGroupIds.length === 0) return false;
  return block.groupId != null && slot.overlayGroupIds.includes(block.groupId);
}

/**
 * Timing effectif d'un bloc dans un slot donné. Priorité :
 *   slotTimings[slot.id] > appearAt/hideAt globaux > défauts (0 / fin du slot)
 */
export function resolveBlockTimingInSlot(
  block: AnyBlock,
  slotId: string,
  slotDuration: number,
): { appearAt: number; hideAt: number } {
  const ov = block.slotTimings?.[slotId];
  return {
    appearAt: ov?.appearAt ?? block.appearAt ?? 0,
    hideAt: ov?.hideAt ?? block.hideAt ?? slotDuration,
  };
}


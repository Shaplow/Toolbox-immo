import type { AnyBlock, TemplateJSON, VideoBlock, VideoSequenceSlot } from "@/types/template";

/**
 * Durée par défaut d'un slot quand `maxDuration` est indéfini (auto).
 * Référence : `SequenceTimeline.tsx` + render-engine (slot picker).
 */
export const SLOT_AUTO_DURATION = 10;

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

/**
 * Retourne la liste ordonnée des slots où le bloc est visible (ordre de
 * `template.videoSequence`). Vide si le bloc n'est nulle part visible.
 */
export function getVisibleSlotsForBlock(
  block: AnyBlock,
  videoSequence: VideoSequenceSlot[] | undefined,
): VideoSequenceSlot[] {
  if (!videoSequence) return [];
  return videoSequence.filter((slot) => isBlockVisibleInSlot(block, slot));
}

/**
 * Distribue une durée d'affichage cumulée (`displayDuration`, secondes) sur
 * les slots où le bloc est visible. Le bloc commence à `appearAt` dans le
 * premier slot visible et s'éteint après `displayDuration` cumulées.
 *
 * Sémantique :
 * - Slot consommé entièrement → pas de `slotTimings[slotId]` (le bloc est
 *   pleinement visible dans ce slot).
 * - Slot où la durée s'éteint → `slotTimings[slotId] = { appearAt: 0, hideAt: rest }`
 *   (ou `appearAt = block.appearAt` si c'est le premier slot).
 * - Slot après l'extinction → `slotTimings[slotId] = { hideAt: 0 }` pour
 *   forcer l'invisibilité (on garde le bloc dans `overlayGroupIds` mais on
 *   le rend invisible pendant ce slot — sémantique préservée par
 *   `computeOverlayPlan`).
 *
 * Retourne `slotTimings` (object diff, à merger avec l'existant), la durée
 * réellement consommée (`consumed`), et si la durée demandée dépassait la
 * zone visible (`capped`).
 *
 * Pure : ne mute pas `block`. Si `visibleSlots` est vide, retourne `slotTimings = {}`.
 */
export function distributeDisplayDuration(
  block: AnyBlock,
  displayDuration: number,
  visibleSlots: VideoSequenceSlot[],
): {
  slotTimings: Record<string, { appearAt?: number; hideAt?: number }>;
  consumed: number;
  capped: boolean;
} {
  const slotTimings: Record<string, { appearAt?: number; hideAt?: number }> = {};
  if (visibleSlots.length === 0 || displayDuration <= 0) {
    return { slotTimings, consumed: 0, capped: displayDuration > 0 };
  }

  const blockAppearAt = block.appearAt ?? 0;
  let remaining = displayDuration;
  let consumed = 0;
  let extinguished = false;

  for (let i = 0; i < visibleSlots.length; i++) {
    const slot = visibleSlots[i];
    const slotMax = slot.maxDuration ?? SLOT_AUTO_DURATION;
    const slotStart = i === 0 ? blockAppearAt : 0;
    const slotAvailable = Math.max(0, slotMax - slotStart);

    if (extinguished) {
      // Slots après l'extinction → invisibles
      slotTimings[slot.id] = { hideAt: 0 };
      continue;
    }

    if (remaining >= slotAvailable) {
      // Consomme tout le slot. Si c'est le premier slot et qu'il y a un
      // appearAt non-nul, on doit l'écrire pour préserver la sémantique.
      if (i === 0 && blockAppearAt > 0) {
        slotTimings[slot.id] = { appearAt: blockAppearAt, hideAt: slotMax };
      }
      // sinon : pas d'override (le slot complet est visible par défaut)
      remaining -= slotAvailable;
      consumed += slotAvailable;
    } else {
      // La durée s'éteint dans ce slot.
      slotTimings[slot.id] = { appearAt: slotStart, hideAt: slotStart + remaining };
      consumed += remaining;
      remaining = 0;
      extinguished = true;
    }
  }

  return { slotTimings, consumed, capped: remaining > 0 };
}

/**
 * Recompose la durée d'affichage cumulée d'un bloc à partir de ses
 * `slotTimings` actuels + les slots où il est visible. Utilisé pour
 * pré-remplir le champ "Durée d'affichage" dans l'UI.
 *
 * Retourne `undefined` si le bloc n'a ni `slotTimings` ni `hideAt` global
 * → sémantique "jusqu'à la fin de la zone visible".
 */
export function computeEffectiveDisplayDuration(
  block: AnyBlock,
  visibleSlots: VideoSequenceSlot[],
): number | undefined {
  if (visibleSlots.length === 0) return undefined;

  const hasAnyOverride =
    block.appearAt !== undefined ||
    block.hideAt !== undefined ||
    (block.slotTimings && Object.keys(block.slotTimings).length > 0);
  if (!hasAnyOverride) return undefined;

  let total = 0;
  for (let i = 0; i < visibleSlots.length; i++) {
    const slot = visibleSlots[i];
    const slotMax = slot.maxDuration ?? SLOT_AUTO_DURATION;
    const { appearAt, hideAt } = resolveBlockTimingInSlot(block, slot.id, slotMax);
    const effectiveStart = i === 0 ? appearAt : 0;
    const effectiveEnd = Math.min(hideAt, slotMax);
    const span = Math.max(0, effectiveEnd - effectiveStart);
    total += span;
    // Si ce slot impose un hideAt < slotMax, le bloc s'éteint là — stop.
    const ovHide = block.slotTimings?.[slot.id]?.hideAt;
    if (ovHide !== undefined && ovHide < slotMax) break;
  }
  return total;
}

/**
 * Re-export shim — le code source vit dans `@/lib/services/slot/transitions`.
 *
 * Ce shim sera retiré en S1.9 (point of no-return). En attendant, il préserve
 * les 10 imports existants de `@/lib/publications/transitions`.
 */
export {
  LEGACY_STATUSES,
  STATUS_TRANSITIONS,
  canTransition,
  computeAutoTransition,
  applyAutoTransition,
  computeAutoTransitionTargetPure,
  computeAutoTransitionTarget,
  syncSlotsPipelineStatuses,
  applyAutoTransitionFromPipeline,
} from "@/lib/services/slot/transitions";

export type {
  AutoTransitionTrigger,
  PipelineTrigger,
} from "@/lib/services/slot/transitions";

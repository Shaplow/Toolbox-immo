/**
 * Re-export shim — le code source vit dans `@/lib/services/slot/activity`.
 *
 * Ce shim sera retiré en S1.9 (point of no-return). En attendant, il préserve
 * les 20+ imports existants de `@/lib/publications/activity`.
 */
export { logActivity } from "@/lib/services/slot/activity";
export type { ActivityType, LogActivityInput } from "@/lib/services/slot/activity";

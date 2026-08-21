// Source unique : types/roles.ts (dédup V1 — la copie locale divergeait
// silencieusement à chaque évolution de la matrice de statuts).
import type { SlotStatus } from "@/types/roles";
export type { SlotStatus };

export interface PublicationSlot {
  id: string;
  /** null = mission sans compte Instagram (production stock). */
  accountId: string | null;
  /** null = mission sans compte Instagram. */
  account: { id: string; name: string; handle: string } | null;
  /**
   * Fiche (Entity) rattachée — clé API historique `propertyId`, valeur = id
   * d'Entity mappé serveur depuis la colonne `entityId` (la colonne DB
   * `propertyId` est morte depuis la Phase 5).
   */
  propertyId: string | null;
  scheduledAt: string | null; // ISO ; null = slot stocké en banque
  status: SlotStatus;
  title: string | null;
  /** Légende Instagram (Phase 2.1 : ancien caption fusionné dans description). */
  description: string | null;
  notes: string | null;
  fields: Record<string, string>;
  fieldSchema: string[];
  templateId: string | null;
  template: { id: string; name: string } | null;
  render: {
    id: string;
    status: string;
    pngUrl: string | null;
    videoUrl: string | null;
    /** CoverFramePack lié au render (auto_template). */
    coverFramePack?: { status: string } | null;
  } | null;
  /** CoverFramePack lié à la version courante (manual_rushes / external_upload). */
  currentVersion?: {
    id: string;
    coverFramePack?: { status: string } | null;
  } | null;
  /** Dernier CaptionJob du slot (status uniquement, pour PipelineDots). */
  captionJobs?: Array<{ status: string }>;
  /** Dernier DescriptionJob du slot (status + result pour fallback completion). */
  descriptionJobs?: Array<{ status: string; result: string | null }>;
  isAuto: boolean;
  /**
   * Lien Instagram du post publié. Null sur un slot PUBLISHED = publication
   * marquée sans lien (admin) : le calendrier la signale, le lien reste
   * ajoutable depuis la fiche.
   */
  publishedUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  // ── Assignation et pattern (Phase 1.6) ───────────────────────────────────
  // Champs nullables. Absents des réponses API calendar qui
  // ne font pas d'include explicite — d'où le `| undefined`.
  assigneeMonteurId?: string | null;
  assigneeCmId?: string | null;
  patternBindingId?: string | null;
  patternTemplateId?: string | null;
  /** Bon de commande d'origine (badge « Commande » en banque). */
  orderId?: string | null;
  currentVersionId?: string | null;
  pattern?: {
    label: string;
    /** Phase 2.x — source du pattern (auto_template | manual_rushes | external_upload) */
    source?: string;
    // W2 — config validation client héritée du pattern (peut être null si pas chargé)
    needsClientValidation?: boolean;
    allowsClientRevision?: boolean;
    /** Phase 2.3 — validation admin du montage héritée. */
    needsAdminValidation?: boolean;
    // Cohérence Workflows Phase 4 — autres needs* hérités du pattern
    needsCaptions?: boolean;
    /** "none" | "auto" | "manual". */
    needsCaptionsMode?: string;
    needsDescription?: string;
    needsRushes?: boolean;
    needsBrief?: boolean;
    // Phase 5 — coverMode hérité du pattern (pour comparaison à coverModeOverride)
    coverMode?: string;
    /** Type de fiche exigé par la recette (null = aucun). */
    requiresEntityTypeId?: string | null;
    /**
     * Legacy — true sans requiresEntityTypeId ⇒ type « Bien ». Champs bruts
     * conservés tels quels (miroir de SlotEffectivePattern renvoyé par l'API
     * calendrier) plutôt que pré-résolus en un champ dérivé unique — les
     * lecteurs passent par `requiredEntityTypeId()` (lib/publications/
     * entityRequirement.ts), source unique du fallback.
     */
    requiresProperty?: boolean;
  } | null;
  assigneeVideasteId?: string | null;
  assigneeMonteur?: { id: string; name: string | null } | null;
  assigneeCm?: { id: string; name: string | null } | null;
  assigneeVideaste?: { id: string; name: string | null } | null;
  // W2 + Cohérence Workflows Phase 4 — overrides per-slot (null = hérite du pattern)
  /** Phase 2.3 — override admin validation du montage. */
  needsAdminValidationOverride?: boolean | null;
  needsClientValidationOverride?: boolean | null;
  allowsClientRevisionOverride?: boolean | null;
  /** "none" | "auto" | "manual". null = hérite de la recette. */
  needsCaptionsModeOverride?: string | null;
  needsDescriptionOverride?: string | null;
  needsRushesOverride?: boolean | null;
  needsBriefOverride?: boolean | null;
  // Phase 5 slots one-off — overrides des ressources (preset/prompt)
  coverModeOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
}

// Re-exported from the centralized source of truth — do not duplicate here.
export {
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_DOT,
  STATUS_GROUP,
  STATUS_OWNER,
  OWNER_LABEL,
  OWNER_BADGE_CLS,
  NEXT_ACTION,
  type SlotOwnerRole,
} from "@/lib/slots/statusLabels";

export const OFFRES = ["ESSENTIEL", "CONFIRME", "CEO", "COMPTE_AGENCE"] as const;
export type Offre = (typeof OFFRES)[number];
export const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

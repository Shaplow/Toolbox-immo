/**
 * Mapping centralisé status → visual pour les différents domaines de jobs.
 *
 * Source de vérité unique pour render / caption / description / cover /
 * slot / transcription. Les composants StatusBadge et molécules dérivées
 * (JobQueueItem, etc.) consomment ce mapping plutôt que de redupliquer
 * leurs propres switch statements.
 *
 * Convention :
 * - `variant` : palette Badge (default / success / danger / info / peach /
 *   sage / sky / rose).
 * - `label` : texte FR humain affiché.
 * - `icon` : Lucide icon.
 * - `spin?` : si true, l'icône doit tourner (Loader2).
 *
 * Note : `PHASE_COLORS` (web/src/lib/slots/phase.ts) et `STATUS_COLORS`
 * (web/src/lib/slots/statusLabels.ts) restent les sources légitimes pour
 * les couleurs de phases / statuts dans les contextes slots historiques.
 * Ce mapping est complémentaire et orienté job/operation.
 */

import type { LucideIcon } from "lucide-react";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  CircleDot,
  Pause,
  Send,
  Eye,
} from "lucide-react";

export type StatusDomain =
  | "render"
  | "caption"
  | "description"
  | "cover"
  | "slot"
  | "transcription";

type Variant = "default" | "success" | "danger" | "info" | "peach" | "sage" | "sky" | "rose";

export interface StatusVisual {
  variant: Variant;
  label: string;
  icon: LucideIcon;
  /** Indique que l'icône doit tourner (`animate-spin`). */
  spin?: boolean;
}

const FALLBACK: StatusVisual = { variant: "default", label: "Inconnu", icon: CircleDot };

// ─── Render jobs ────────────────────────────────────────────────────────────

const RENDER_MAP: Record<string, StatusVisual> = {
  QUEUED:      { variant: "default", label: "En file",   icon: Clock },
  PENDING:     { variant: "default", label: "En attente", icon: Clock },
  IN_PROGRESS: { variant: "sky",     label: "En cours",  icon: Loader2, spin: true },
  RENDERING:   { variant: "sky",     label: "Rendu en cours", icon: Loader2, spin: true },
  UPLOADING:   { variant: "sky",     label: "Upload",    icon: Loader2, spin: true },
  COMPLETED:   { variant: "success", label: "Terminé",   icon: CheckCircle2 },
  DONE:        { variant: "success", label: "Terminé",   icon: CheckCircle2 },
  FAILED:      { variant: "danger",  label: "Échec",     icon: XCircle },
  ERROR:       { variant: "danger",  label: "Erreur",    icon: XCircle },
  CANCELLED:   { variant: "default", label: "Annulé",    icon: Pause },
};

// ─── Caption jobs ───────────────────────────────────────────────────────────

const CAPTION_MAP: Record<string, StatusVisual> = {
  PENDING:    { variant: "default", label: "En attente",  icon: Clock },
  GENERATING: { variant: "sky",     label: "Génération",  icon: Loader2, spin: true },
  READY:      { variant: "success", label: "Prêt",        icon: CheckCircle2 },
  COMPLETED:  { variant: "success", label: "Terminé",     icon: CheckCircle2 },
  FAILED:     { variant: "danger",  label: "Échec",       icon: XCircle },
  CANCELLED:  { variant: "default", label: "Annulé",      icon: Pause },
};

// ─── Description jobs ───────────────────────────────────────────────────────

const DESCRIPTION_MAP: Record<string, StatusVisual> = {
  QUEUED:    { variant: "default", label: "En file",    icon: Clock },
  RUNNING:   { variant: "sky",     label: "Génération", icon: Loader2, spin: true },
  COMPLETED: { variant: "success", label: "Terminé",    icon: CheckCircle2 },
  FAILED:    { variant: "danger",  label: "Échec",      icon: XCircle },
};

// ─── Cover jobs ─────────────────────────────────────────────────────────────

const COVER_MAP: Record<string, StatusVisual> = {
  // Statuts canoniques du modèle CoverFramePack (prisma/schema.prisma) :
  // QUEUED → PROCESSING → READY → SELECTED, ou FAILED en cas de crash.
  QUEUED:     { variant: "default", label: "En file",        icon: Clock },
  PROCESSING: { variant: "peach",   label: "Génération",     icon: Loader2, spin: true },
  READY:      { variant: "sky",     label: "Frames prêtes",  icon: Sparkles },
  SELECTED:   { variant: "success", label: "Sélectionnée",   icon: Sparkles },
  FAILED:     { variant: "danger",  label: "Échec",          icon: XCircle },
  // Alias playground / legacy (avant Phase V3).
  PENDING:    { variant: "default", label: "En attente",     icon: Clock },
  GENERATING: { variant: "peach",   label: "Génération",     icon: Loader2, spin: true },
};

// ─── Transcription jobs ────────────────────────────────────────────────────

const TRANSCRIPTION_MAP: Record<string, StatusVisual> = {
  QUEUED:    { variant: "default", label: "En file",       icon: Clock },
  RUNNING:   { variant: "sky",     label: "Transcription", icon: Loader2, spin: true },
  COMPLETED: { variant: "success", label: "Terminée",      icon: CheckCircle2 },
  FAILED:    { variant: "danger",  label: "Échec",         icon: XCircle },
};

// ─── Slot statuses (raccourcis — voir lib/slots/statusLabels.ts) ───────────

const SLOT_MAP: Record<string, StatusVisual> = {
  DRAFT:            { variant: "default", label: "Brouillon",          icon: CircleDot },
  PLANNED:          { variant: "default", label: "Planifié",           icon: Clock },
  RUSHES_EXPECTED:  { variant: "default", label: "Rushes attendus",    icon: Clock },
  RUSHES_RECEIVED:  { variant: "default", label: "Rushes reçus",       icon: CheckCircle2 },
  IN_EDIT:          { variant: "default", label: "Montage en cours",   icon: Loader2, spin: true },
  EDIT_REVIEW:      { variant: "default", label: "Revue montage",      icon: Eye },
  EDIT_APPROVED:    { variant: "default", label: "Montage validé",     icon: CheckCircle2 },
  CAPTIONS_PENDING: { variant: "default", label: "Captions à faire",   icon: Clock },
  READY_FOR_CM:     { variant: "default", label: "Prêt pour CM",       icon: CheckCircle2 },
  AWAITING_CLIENT:  { variant: "peach",   label: "Attente client",     icon: AlertCircle },
  CLIENT_REVISION:  { variant: "peach",   label: "Révision client",    icon: AlertCircle },
  SCHEDULED:        { variant: "info",    label: "Programmé",          icon: Send },
  PUBLISHED:        { variant: "success", label: "Publié",             icon: CheckCircle2 },
  REJECTED:         { variant: "danger",  label: "Refusé",             icon: XCircle },
  CANCELLED:        { variant: "default", label: "Annulé",             icon: Pause },
  BLOCKED:          { variant: "danger",  label: "Bloqué",             icon: AlertCircle },
  ARCHIVED:         { variant: "default", label: "Archivé",            icon: CircleDot },
};

const DOMAIN_MAPS: Record<StatusDomain, Record<string, StatusVisual>> = {
  render:        RENDER_MAP,
  caption:       CAPTION_MAP,
  description:   DESCRIPTION_MAP,
  cover:         COVER_MAP,
  slot:          SLOT_MAP,
  transcription: TRANSCRIPTION_MAP,
};

/**
 * Résout le visual pour un (domain, status). Si inconnu, retourne FALLBACK
 * "default · Inconnu · CircleDot" — préférable au crash silencieux.
 */
export function getStatusVisual(domain: StatusDomain, status: string): StatusVisual {
  const map = DOMAIN_MAPS[domain];
  return map[status] ?? { ...FALLBACK, label: status || FALLBACK.label };
}

/** Retourne tous les statuts définis pour un domaine (utile pour les selects de filtre). */
export function getKnownStatuses(domain: StatusDomain): string[] {
  return Object.keys(DOMAIN_MAPS[domain]);
}

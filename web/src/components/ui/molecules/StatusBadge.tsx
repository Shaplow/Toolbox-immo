"use client";

/**
 * StatusBadge — Badge avec mapping centralisé status → visual.
 *
 * Wrapper de <Badge> qui prend un (domain, status) et résout
 * automatiquement le variant, label, icon via getStatusVisual.
 *
 * Use cases : RenderSection, CaptionsSection, CoverSection, DescriptionSection,
 * ProductionChain, TranscriptionDetail, JobQueueItem — tous les endroits où
 * on affiche un statut de job/slot.
 *
 * Options :
 * - `domain` : "render" | "caption" | "description" | "cover" | "slot" |
 *   "transcription"
 * - `status` : string (les valeurs connues mappent, les inconnues affichent
 *   le label brut avec variant "default")
 * - `size`, `dot`, `glass`, `capitalize` — passés au Badge sous-jacent
 * - `hideIcon` : si true, n'affiche pas l'icône (juste label + variant)
 * - `customLabel` : override le label (utile pour i18n ou raccourci)
 */

import { Badge } from "../Badge";
import { getStatusVisual, type StatusDomain } from "@/lib/ui/statusMapping";

interface StatusBadgeProps {
  domain: StatusDomain;
  status: string;
  size?: "sm" | "md";
  /** Affiche un dot leading au lieu de l'icône. */
  dot?: boolean;
  /** Variant glass (transparent + blur). */
  glass?: boolean;
  /** Cache l'icône (utile en grids denses). */
  hideIcon?: boolean;
  /** Override le label résolu par le mapping. */
  customLabel?: string;
  /** First-letter uppercase (default true). */
  capitalize?: boolean;
  className?: string;
}

export function StatusBadge({
  domain,
  status,
  size = "sm",
  dot = false,
  glass = false,
  hideIcon = false,
  customLabel,
  capitalize = true,
  className,
}: StatusBadgeProps) {
  const visual = getStatusVisual(domain, status);
  const Icon = visual.icon;
  const showIcon = !hideIcon && !dot;
  const iconSize = size === "sm" ? 10 : 12;

  // Si l'icône doit spin (Loader2), on passe le label + icône via children
  // pour pouvoir ajouter `animate-spin` (la prop `icon` du Badge ne supporte
  // pas de className additional).
  if (visual.spin && showIcon) {
    return (
      <Badge
        variant={visual.variant}
        size={size}
        dot={dot}
        glass={glass}
        capitalize={capitalize}
        className={className}
      >
        <span className="inline-flex items-center gap-1">
          <Icon size={iconSize} className="shrink-0 animate-spin" aria-hidden />
          {customLabel ?? visual.label}
        </span>
      </Badge>
    );
  }

  return (
    <Badge
      variant={visual.variant}
      size={size}
      icon={showIcon ? Icon : undefined}
      dot={dot}
      glass={glass}
      capitalize={capitalize}
      className={className}
    >
      {customLabel ?? visual.label}
    </Badge>
  );
}

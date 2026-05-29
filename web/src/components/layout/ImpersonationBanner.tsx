"use client";

/**
 * ImpersonationBanner — bannière sticky top pour signaler une impersonation
 * ou un mode "vue-rôle admin".
 *
 * Single source of truth pour quitter l'impersonation (Phase 6.1 — avant,
 * un bouton interne dans AppNav dupliquait cette action avec un comportement
 * légèrement différent).
 *
 * Doctrine Liquid Glass v2 :
 * - S'appuie sur la primitive Banner (variants Coastal Studio).
 * - "impersonation" → variant warning (peach) — équivalent symbolique de
 *   l'ancien amber, désormais dans la palette.
 * - "roleOverride" → variant info (sky) — au lieu de fuchsia (hors palette).
 *
 * Action centralisée via useImpersonation() — error handling toast inclus.
 */

import { UserCog, Eye } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { useImpersonation } from "@/hooks/useImpersonation";

interface ImpersonationBannerProps {
  effectiveUserLabel: string;
  /** "impersonation" (warning peach) | "roleOverride" (info sky). */
  variant?: "impersonation" | "roleOverride";
}

export function ImpersonationBanner({
  effectiveUserLabel,
  variant = "impersonation",
}: ImpersonationBannerProps) {
  const { stopImpersonation, setViewAsRole } = useImpersonation();
  const isRoleOverride = variant === "roleOverride";

  const stopActiveMode = isRoleOverride
    ? () => void setViewAsRole(null)
    : () => void stopImpersonation();

  return (
    <Banner
      variant={isRoleOverride ? "info" : "warning"}
      icon={isRoleOverride ? Eye : UserCog}
      action={{
        label: isRoleOverride ? "Revenir en admin" : "Quitter l'impersonation",
        onClick: stopActiveMode,
      }}
    >
      {isRoleOverride ? "Vue en mode " : "Vous êtes connecté en tant que "}
      <span className="font-semibold">{effectiveUserLabel}</span>
      {isRoleOverride && " — vos actions admin sont désactivées."}
    </Banner>
  );
}

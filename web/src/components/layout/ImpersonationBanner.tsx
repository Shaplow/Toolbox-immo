"use client";

import { UserCog, Eye } from "lucide-react";
import { useImpersonation } from "@/hooks/useImpersonation";

interface ImpersonationBannerProps {
  effectiveUserLabel: string;
  /** "impersonation" (par défaut, amber) | "roleOverride" (vue admin → autre rôle, fuchsia) */
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

  const wrapperClass = isRoleOverride
    ? "bg-fuchsia-50 border-b border-fuchsia-200"
    : "bg-amber-50 border-b border-amber-200";
  const textClass = isRoleOverride ? "text-fuchsia-900" : "text-amber-900";
  const iconClass = isRoleOverride ? "text-fuchsia-600" : "text-amber-600";
  const btnClass = isRoleOverride
    ? "text-xs font-medium text-fuchsia-800 hover:text-fuchsia-950 transition-colors shrink-0"
    : "text-xs font-medium text-amber-800 hover:text-amber-950 transition-colors shrink-0";

  return (
    <div className={`${wrapperClass} px-4 py-2 flex items-center justify-between gap-4 text-sm`}>
      <div className={`flex items-center gap-2 min-w-0 ${textClass}`}>
        {isRoleOverride ? (
          <Eye size={14} className={`${iconClass} shrink-0`} />
        ) : (
          <UserCog size={14} className={`${iconClass} shrink-0`} />
        )}
        <span className="truncate">
          {isRoleOverride ? "Vue en mode " : "Vous êtes connecté en tant que "}
          <span className="font-semibold">{effectiveUserLabel}</span>
          {isRoleOverride && " — vos actions admin sont désactivées."}
        </span>
      </div>
      <button
        type="button"
        onClick={stopActiveMode}
        className={btnClass}
      >
        {isRoleOverride ? "Revenir en admin" : "Quitter l'impersonation"}
      </button>
    </div>
  );
}

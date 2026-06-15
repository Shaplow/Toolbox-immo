/**
 * KPIPill — pill glass affichant un indicateur chiffré (icône + label + valeur
 * + tendance optionnelle). À utiliser dans les headers de page admin et les
 * dashboards Home.
 *
 * Use cases :
 * 1. Top de HomeAdmin → "3 publications cette semaine", "8 versions à valider".
 * 2. Header /admin/users → "12 utilisateurs · 4 actifs cette semaine".
 * 3. Header /admin/clients → "32 clients · 47 comptes IG".
 *
 * Avant V2 : ce pattern était copié inline ~8 fois dans HomeAdmin/Cm/Monteur/
 * Videaste/ExternalClient + AdminUsersPage, avec à chaque fois la même
 * formule glass + tabular-nums. KPIPill consolide.
 */

import type { LucideIcon } from "lucide-react";

export type KPIPillTint = "peach" | "sage" | "sky" | "rose" | "neutral";

interface KPIPillProps {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  /** Sous-texte : tendance courte ("+12 ce mois", "↗ 5%", etc.). */
  trend?: string;
  tint?: KPIPillTint;
  className?: string;
}

const TINT_ACCENT: Record<KPIPillTint, string> = {
  peach: "text-peach-700",
  sage: "text-sage-700",
  sky: "text-sky-700",
  rose: "text-rose-700",
  neutral: "text-gray-700",
};

export function KPIPill({
  icon: Icon,
  label,
  value,
  trend,
  tint = "neutral",
  className,
}: KPIPillProps) {
  return (
    <div
      className={[
        "inline-flex items-center gap-2 px-3 py-2 rounded-full",
        "bg-white/55 backdrop-blur-[12px]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon && <Icon size={13} className={`${TINT_ACCENT[tint]} shrink-0`} />}
      <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <span className={`text-[13px] font-semibold tabular-nums ${TINT_ACCENT[tint]}`}>
        {value}
      </span>
      {trend && (
        <span className="text-[10px] text-gray-400 tabular-nums">{trend}</span>
      )}
    </div>
  );
}

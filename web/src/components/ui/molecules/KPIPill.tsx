/**
 * KPIPill — carte KPI flat shadcn (label + valeur + tendance).
 *
 * Use cases : top de HomeAdmin, header /admin/users, header /admin/clients.
 *
 * Style Vercel dashboard : bg-card border-border, label muted uppercase,
 * value foreground gros tabular-nums, trend muted petit. La prop `tint`
 * legacy est ignorée — accent unique primary.
 */

import type { LucideIcon } from "lucide-react";

export type KPIPillTint = "peach" | "sage" | "sky" | "rose" | "neutral";

interface KPIPillProps {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  /** Sous-texte : tendance courte ("+12 ce mois", "↗ 5%"). */
  trend?: string;
  tint?: KPIPillTint;
  className?: string;
}

export function KPIPill({
  icon: Icon,
  label,
  value,
  trend,
  tint: _tint = "neutral",
  className,
}: KPIPillProps) {
  void _tint;
  return (
    <div
      className={[
        "inline-flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon && <Icon size={13} className="text-muted-foreground shrink-0" />}
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[13px] font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {trend && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{trend}</span>
      )}
    </div>
  );
}

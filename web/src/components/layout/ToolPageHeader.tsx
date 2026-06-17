import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * ToolPageHeader — header standard partagé par les pages d'outils et d'admin.
 *
 * Flat shadcn DA v3 : icône dans wrapper carré bg-muted + border, titre,
 * actions optionnelles, KPIs row, tabs.
 *
 * Backward compat : props `iconTint` et `iconColor` legacy conservées mais
 * ignorées (mappées vers un wrapper neutre).
 */

type IconTint = "peach" | "sage" | "sky" | "rose" | "neutral";

export interface ToolPageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** @deprecated DA v3 — wrapper neutre unique. */
  iconTint?: IconTint;
  /** @deprecated DA v3 — wrapper neutre unique. */
  iconColor?: string;
  breadcrumb?: ReactNode;
  kpis?: ReactNode;
  tabs?: ReactNode;
}

export function ToolPageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  iconTint: _iconTint,
  iconColor: _iconColor,
  breadcrumb,
  kpis,
  tabs,
}: ToolPageHeaderProps) {
  void _iconTint;
  void _iconColor;

  return (
    <div className="mb-8">
      {breadcrumb && (
        <nav className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {breadcrumb}
        </nav>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0 bg-muted border border-border text-foreground">
            <Icon size={20} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {kpis && <div className="mt-4 inline-flex flex-wrap items-center gap-2">{kpis}</div>}
      {tabs && <div className="mt-4 border-t border-border pt-3">{tabs}</div>}
    </div>
  );
}

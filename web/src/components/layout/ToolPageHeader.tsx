import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * ToolPageHeader — header standard partagé par les pages d'outils et d'admin.
 *
 * Doctrine Liquid Glass v2 (refactor Phase 6.1) :
 * - Icône dans wrapper carré glass-tinted Coastal Studio (peach / sage / sky
 *   / rose / neutral) + ring inset spéculaire signature.
 * - Plus de couleurs Tailwind hardcodées (indigo / violet / teal / emerald /
 *   amber / rose-600) qui étaient hors palette.
 *
 * Backward compat : la prop `iconColor` (string libre) est conservée pour
 * que les ~15 call sites existants continuent de compiler. Elle est mappée
 * vers `iconTint` en interne et marquée @deprecated. Les nouveaux call sites
 * doivent utiliser `iconTint`.
 *
 * Fonctionne en server components ET client components (pas de "use client").
 */

type IconTint = "peach" | "sage" | "sky" | "rose" | "neutral";

/** Mapping iconColor legacy → iconTint Liquid Glass. */
const LEGACY_COLOR_MAP: Record<string, IconTint> = {
  indigo:  "sky",
  violet:  "rose",
  teal:    "sage",
  emerald: "sage",
  amber:   "peach",
  rose:    "rose",
};

const TINT_WRAPPER: Record<IconTint, string> = {
  peach:   "bg-peach-100/70 text-peach-700",
  sage:    "bg-sage-100/70 text-sage-700",
  sky:     "bg-sky-100/70 text-sky-700",
  rose:    "bg-rose-100/70 text-rose-700",
  neutral: "bg-white/70 text-gray-700",
};

export interface ToolPageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * Teinte Coastal Studio de l'icône. Default "neutral".
   * Préférer ce prop à `iconColor` (legacy) sur tout nouveau call site.
   */
  iconTint?: IconTint;
  /**
   * @deprecated Utiliser `iconTint` (peach / sage / sky / rose / neutral).
   * Mappage automatique : indigo/violet→sky/rose · teal/emerald→sage ·
   * amber→peach · rose→rose. Toute autre valeur tombe sur "neutral".
   */
  iconColor?: string;
  /** V2 (15/06) — Breadcrumb au-dessus du titre (ReactNode pour souplesse :
   *  on peut y mettre des <Link> Next + ChevronRight au choix). */
  breadcrumb?: ReactNode;
  /** V2 (15/06) — Row de KPIPills sous le titre (rendu inline-flex gap-2). */
  kpis?: ReactNode;
  /** V2 (15/06) — Tabs (ou autre nav contextuelle) sous header, hors padding. */
  tabs?: ReactNode;
}

export function ToolPageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  iconTint,
  iconColor,
  breadcrumb,
  kpis,
  tabs,
}: ToolPageHeaderProps) {
  // Résolution : iconTint explicite > iconColor legacy mappé > "neutral".
  const tint: IconTint =
    iconTint ?? (iconColor ? LEGACY_COLOR_MAP[iconColor] ?? "neutral" : "neutral");

  return (
    <div className="mb-8">
      {breadcrumb && (
        <nav className="mb-3 flex items-center gap-1.5 text-[11px] text-gray-500">
          {breadcrumb}
        </nav>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={[
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 backdrop-blur-[10px]",
              "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.06)]",
              TINT_WRAPPER[tint],
            ].join(" ")}
          >
            <Icon size={20} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-gray-950 truncate">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {kpis && <div className="mt-4 inline-flex flex-wrap items-center gap-2">{kpis}</div>}
      {tabs && <div className="mt-4 border-t border-white/40 pt-3">{tabs}</div>}
    </div>
  );
}

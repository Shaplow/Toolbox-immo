/**
 * Hub — pattern page d'accueil avec cards d'entrée (modules / outils).
 *
 * Utilisé pour `/outils`, `/admin/libraries`, et toute page qui sert de
 * point de dispatch vers des sous-modules.
 *
 * Pattern MID Liquid Glass :
 * - Wrapper outer flottant : my-11 ml-[60px] mr-[100px] rounded-3xl pastel.
 * - Header Control Center : eyebrow + h1 BIG + description + pill optionnelle.
 * - Grid de cards blanches opaque avec icône tinted + hover lift.
 *
 * API :
 *
 *   <Hub
 *     eyebrow="Production"
 *     title="Outils"
 *     description="Outils standalone, sans contexte de slot."
 *     items={[
 *       { href, label, description, icon, tint, meta },
 *       ...
 *     ]}
 *   />
 */

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tint = "peach" | "sage" | "sky" | "rose" | "gray";

export interface HubItem {
  href: string;
  label: string;
  /** Description optionnelle sous le label. Omettre pour un hub épuré. */
  description?: string;
  icon: LucideIcon;
  tint?: Tint;
  /** Métadonnée libre (ex: "12 médias · 4 bibliothèques"). */
  meta?: string;
}

interface HubPageProps {
  eyebrow: string;
  title: string;
  description?: string;
  items: HubItem[];
  /** Pill ou bouton à droite du header (optionnel). */
  rightPill?: ReactNode;
  /** Nombre max de colonnes en xl. Default 3. */
  cols?: 2 | 3 | 4;
}

const TINT_BG: Record<Tint, string> = {
  peach: "bg-peach-100/70 text-peach-700",
  sage: "bg-sage-100/70 text-sage-700",
  sky: "bg-sky-100/70 text-sky-700",
  rose: "bg-rose-100/70 text-rose-700",
  gray: "bg-gray-100/70 text-gray-700",
};

const COLS_CLS: Record<NonNullable<HubPageProps["cols"]>, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

export function Hub({
  eyebrow,
  title,
  description,
  items,
  rightPill,
  cols = 3,
}: HubPageProps) {
  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  {eyebrow}
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  {title}
                </h1>
                {description && (
                  <p className="mt-2 text-[13px] text-gray-500 max-w-xl">
                    {description}
                  </p>
                )}
              </div>
              {rightPill}
            </div>
          </div>
        </div>

        {/* Grid de cards */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-5xl mx-auto">
            <div className={`grid ${COLS_CLS[cols]} gap-4`}>
              {items.map((item) => (
                <HubCard key={item.href} item={item} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HubCardProps {
  item: HubItem;
}

/**
 * HubCard — card glass centrée d'un Hub.
 *
 * Doctrine MID Liquid Glass : matière verre franche (gradient blanc translucent
 * + backdrop-blur + ring inset spéculaire) + contenu centré (icône top, label,
 * description, meta). Halo extérieur diffus au hover pour signature flottante.
 */
export function HubCard({ item }: HubCardProps) {
  const Icon = item.icon;
  const tint = item.tint ?? "gray";

  return (
    <Link
      href={item.href}
      className={[
        "group flex flex-col items-center text-center gap-4 px-5 py-7 rounded-2xl transition-all",
        // Glass franc : gradient blanc translucent + blur + ring inset
        // spéculaire signature. Pas de bg-white opaque (manquait de matière
        // verre — feedback Mathis 2026-05-29).
        "bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[14px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
        "hover:from-white/95 hover:to-white/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.08),0_16px_36px_-12px_rgba(15,23,42,0.18)]",
        "hover:-translate-y-0.5",
      ].join(" ")}
    >
      {/* Icône colorée en pastille glass centrée */}
      <div
        className={[
          "h-14 w-14 rounded-2xl inline-flex items-center justify-center shrink-0 backdrop-blur-[8px]",
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(15,23,42,0.04)]",
          "group-hover:scale-105 transition-transform",
          TINT_BG[tint],
        ].join(" ")}
      >
        <Icon size={22} strokeWidth={1.8} />
      </div>

      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-gray-950 leading-tight">
          {item.label}
        </p>
        {item.description && (
          <p className="text-[12.5px] text-gray-500 mt-1.5 leading-relaxed max-w-[220px] mx-auto">
            {item.description}
          </p>
        )}
        {item.meta && (
          <p className="text-[10px] uppercase tracking-widest font-medium text-gray-400 mt-3 tabular-nums">
            {item.meta}
          </p>
        )}
      </div>
    </Link>
  );
}

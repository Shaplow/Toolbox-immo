/**
 * Hub — page d'accueil avec cards d'entrée (modules / outils).
 *
 * Utilisé pour `/outils`, `/admin/libraries`, et toute page point de dispatch.
 *
 * Flat shadcn — header simple + grid de cards bg-card border-border.
 * La prop `tint` legacy sur les icônes est ignorée en DA v3.
 */

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tint = "peach" | "sage" | "sky" | "rose" | "gray";

export interface HubItem {
  href: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  tint?: Tint;
  meta?: string;
}

interface HubPageProps {
  eyebrow: string;
  title: string;
  description?: string;
  items: HubItem[];
  rightPill?: ReactNode;
  cols?: 2 | 3 | 4;
}

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
      <div className="max-w-5xl mx-auto px-6 sm:px-8 py-10">
        <div className="flex items-start justify-between gap-4 flex-wrap pb-8">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-foreground leading-[1.05]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-[13px] text-muted-foreground max-w-xl">
                {description}
              </p>
            )}
          </div>
          {rightPill}
        </div>

        <div className={`grid ${COLS_CLS[cols]} gap-4`}>
          {items.map((item) => (
            <HubCard key={item.href} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface HubCardProps {
  item: HubItem;
}

export function HubCard({ item }: HubCardProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className="group flex flex-col items-center text-center gap-4 px-5 py-7 rounded-lg bg-card border border-border transition-colors hover:bg-muted hover:border-zinc-300"
    >
      <div className="h-14 w-14 rounded-md inline-flex items-center justify-center shrink-0 bg-muted text-foreground border border-border group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/30 transition-colors">
        <Icon size={22} strokeWidth={1.8} />
      </div>

      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-foreground leading-tight">
          {item.label}
        </p>
        {item.description && (
          <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed max-w-[220px] mx-auto">
            {item.description}
          </p>
        )}
        {item.meta && (
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mt-3 tabular-nums">
            {item.meta}
          </p>
        )}
      </div>
    </Link>
  );
}

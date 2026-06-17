"use client";

/**
 * MediaAssetsKpiRow — row de KPI cards en haut du MediaAssetsPanel.
 *
 * Phase A médiathèque (2026-05-30). Donne du contexte d'un coup d'œil :
 * combien d'assets, catégories, packs, utilisés ce mois, total générations.
 * Lit `assets` (déjà chargé) → aucun fetch supplémentaire.
 *
 * Les cards sont en Liquid Glass v2 signature canonique. Couleurs sémantiques
 * (sky pour les counts neutres, sage pour activité, peach pour orphelins).
 */

import { useMemo } from "react";
import { FolderOpen, Layers, Video, Music2, TrendingUp, Calendar } from "lucide-react";
import type { MediaAsset } from "./types";

interface Props {
  assets: MediaAsset[];
  libType: "video" | "audio";
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function MediaAssetsKpiRow({ assets, libType }: Props) {
  const stats = useMemo(() => {
    const totalAssets = assets.length;
    const categories = new Set<string>();
    const packs = new Set<string>();
    let usedThisMonth = 0;
    let totalUsage = 0;
    let orphans = 0;
    const monthStart = startOfMonth();

    for (const a of assets) {
      if (a.category) categories.add(a.category);
      else orphans++;
      if (a.setTag && !a.setTag.startsWith("pack_")) packs.add(a.setTag);
      totalUsage += a.usageCount;
      if (a.lastUsedAt) {
        const used = new Date(a.lastUsedAt);
        if (used >= monthStart) usedThisMonth++;
      }
    }
    return {
      totalAssets,
      totalCategories: categories.size,
      totalPacks: packs.size,
      usedThisMonth,
      totalUsage,
      orphans,
    };
  }, [assets]);

  const TypeIcon = libType === "video" ? Video : Music2;
  const typeColor = libType === "video" ? "sky" : "sage";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
      <KpiCard
        label={libType === "video" ? "Vidéos" : "Pistes"}
        value={stats.totalAssets}
        icon={TypeIcon}
        tint={typeColor}
      />
      <KpiCard
        label="Catégories"
        value={stats.totalCategories}
        icon={FolderOpen}
        tint="sky"
      />
      <KpiCard
        label="Groupes"
        value={stats.totalPacks}
        icon={Layers}
        tint="sky"
      />
      <KpiCard
        label="Utilisés ce mois"
        value={stats.usedThisMonth}
        icon={Calendar}
        tint="sage"
      />
      <KpiCard
        label="Total générations"
        value={stats.totalUsage}
        icon={TrendingUp}
        tint="sage"
      />
      {/* KPI "À ranger" retiré : trop bruyant et redondant avec le filtre sidebar "Sans catégorie". */}
    </div>
  );
}

type Tint = "sky" | "sage" | "peach";

const TINT_CONFIG: Record<Tint, { icon: string; label: string; rgb: string }> = {
  sky: {
    icon: "bg-gradient-to-b from-info-100 to-info-200/80 text-info-700",
    label: "text-muted-foreground",
    rgb: "77,150,191",
  },
  sage: {
    icon: "bg-gradient-to-b from-success-100 to-success-200/80 text-success-700",
    label: "text-muted-foreground",
    rgb: "111,162,128",
  },
  peach: {
    icon: "bg-gradient-to-b from-warning-100 to-warning-200/80 text-warning-700",
    label: "text-warning-700",
    rgb: "221,140,90",
  },
};

function KpiCard({
  label,
  value,
  icon: Icon,
  tint,
  className,
}: {
  label: string;
  value: number;
  icon: typeof Video;
  tint: Tint;
  className?: string;
}) {
  const cfg = TINT_CONFIG[tint];
  return (
    <div
      className={[
        "rounded-2xl p-3.5 bg-card border border-border ",
        "",
        "hover:",
        "transition-shadow",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={[
            "shrink-0 h-8 w-8 rounded-xl inline-flex items-center justify-center",
            cfg.icon,
            "",
          ].join(" ")}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[9.5px] uppercase tracking-widest font-medium ${cfg.label} truncate`}>
            {label}
          </p>
          <p className="text-[18px] font-semibold text-foreground tabular-nums leading-tight">
            {value.toLocaleString("fr-FR")}
          </p>
        </div>
      </div>
    </div>
  );
}

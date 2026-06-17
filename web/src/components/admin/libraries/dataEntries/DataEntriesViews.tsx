"use client";

/**
 * CycleBadge — pastille d'état d'une fiche selon la usagePolicy de la campagne.
 *
 * Phase 1.x design — fichier nettoyé : il ne contenait que des vues legacy
 * (FlatTable + GroupedView) qui ont été remplacées par DataEntriesTable et
 * DataEntriesGroupedView. Seul ce helper reste, utilisé par les deux vues v2.
 */

import type { DataEntry } from "@/components/admin/libraries/DataEntriesPanel";

export function CycleBadge({
  entry,
  usagePolicy,
  accountFilter,
}: {
  entry: DataEntry;
  usagePolicy: string;
  accountFilter: string | null;
}) {
  if (usagePolicy === "unlimited") {
    return <span className="text-[11px] text-muted-foreground/60">—</span>;
  }
  if (usagePolicy === "cycle_per_account" || usagePolicy === "once_per_account") {
    if (!accountFilter) {
      return (
        <span className="text-[10.5px] text-muted-foreground bg-card border border-border border border-border/60 rounded-full px-2 py-0.5">
          Par compte
        </span>
      );
    }
    return entry.usageCount > 0 ? (
      <span className="text-[10.5px] text-warning-700 bg-warning-50/70 shadow-[inset_0_0_0_1px_rgba(221,140,90,0.22)] rounded-full px-2 py-0.5">
        Utilisée
      </span>
    ) : (
      <span className="text-[10.5px] text-success-700 bg-success-50/70 shadow-[inset_0_0_0_1px_rgba(111,162,128,0.22)] rounded-full px-2 py-0.5">
        Disponible
      </span>
    );
  }
  // "cycle" | "once_global" → global usedInCycle flag
  return entry.usedInCycle ? (
    <span className="text-[10.5px] text-warning-700 bg-warning-50/70 shadow-[inset_0_0_0_1px_rgba(221,140,90,0.22)] rounded-full px-2 py-0.5">
      Utilisée
    </span>
  ) : (
    <span className="text-[10.5px] text-success-700 bg-success-50/70 shadow-[inset_0_0_0_1px_rgba(111,162,128,0.22)] rounded-full px-2 py-0.5">
      Disponible
    </span>
  );
}

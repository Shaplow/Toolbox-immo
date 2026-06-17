"use client";

/**
 * AdminInbox — liste unifiée triée par priorité avec tabs filtres.
 *
 * Remplace les 4 KPI cards + section "Versions à valider" de HomeAdmin V1.
 * Toutes les publications qui attendent une action de l'admin sont là, dans
 * UNE liste, triées par score (urgence × impact).
 *
 * Tabs filtres :
 *  - Tout (default)
 *  - À valider (version_review)
 *  - Production (no_monteur + no_videaste + no_pattern + rushes_overdue)
 *  - Banque (bank_ready)
 *  - Retards (overdue)
 */

import { useState, useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Inbox } from "lucide-react";
import { InboxItem } from "./InboxItem";
import type {
  InboxItem as InboxItemData,
  InboxTypology,
} from "@/lib/services/inbox/getInboxItems";

type TabKey = "all" | "review" | "production" | "bank" | "overdue";

interface Tab {
  key: TabKey;
  label: string;
  typologies?: InboxTypology[];
}

const TABS: Tab[] = [
  { key: "all", label: "Tout" },
  { key: "review", label: "À valider", typologies: ["version_review"] },
  {
    key: "production",
    label: "Production",
    typologies: ["no_monteur", "no_videaste", "no_pattern", "rushes_overdue"],
  },
  { key: "overdue", label: "Retards", typologies: ["overdue"] },
  { key: "bank", label: "Banque", typologies: ["bank_ready"] },
];

const PAGE_SIZE = 12;

interface Props {
  items: InboxItemData[];
}

export function AdminInbox({ items }: Props) {
  const [tab, setTab] = useState<TabKey>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const tabConfig = TABS.find((t) => t.key === tab);
    if (!tabConfig?.typologies) return items;
    return items.filter((it) => tabConfig.typologies!.includes(it.typology));
  }, [items, tab]);

  const visible = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  // Compteurs par tab pour les badges.
  const counts = useMemo(() => {
    const out: Record<TabKey, number> = {
      all: items.length,
      review: 0,
      production: 0,
      overdue: 0,
      bank: 0,
    };
    for (const it of items) {
      if (it.typology === "version_review") out.review += 1;
      if (
        it.typology === "no_monteur" ||
        it.typology === "no_videaste" ||
        it.typology === "no_pattern" ||
        it.typology === "rushes_overdue"
      )
        out.production += 1;
      if (it.typology === "overdue") out.overdue += 1;
      if (it.typology === "bank_ready") out.bank += 1;
    }
    return out;
  }, [items]);

  return (
    <section className="rounded-lg bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          À traiter
          <span className="ml-2 text-[11px] font-normal text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(0);
              }}
              className={[
                "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] transition-colors focus-ring",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              ].join(" ")}
            >
              <span>{t.label}</span>
              {count > 0 && (
                <span
                  className={[
                    "inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded text-[10px] font-medium tabular-nums",
                    active
                      ? "bg-card text-foreground border border-border"
                      : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Tout est traité"
        />
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((item) => (
              <InboxItem key={item.id} item={item} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 px-3 h-7 rounded-md text-[12px] text-primary hover:bg-muted transition-colors focus-ring"
              >
                Voir {Math.min(PAGE_SIZE, filtered.length - visible.length)} de plus
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

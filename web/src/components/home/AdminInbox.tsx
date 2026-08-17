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
  /** Checklist « Démarrer » (V3.3) — affichée si l'un des deux est 0. */
  accountsCount?: number;
  recipesCount?: number;
}

const START_STEPS: { label: string; href: string; done: (a: number, r: number) => boolean }[] = [
  { label: "Créer un client et son compte Instagram", href: "/admin/clients", done: (a) => a > 0 },
  { label: "Construire un template vidéo dans le Studio", href: "/templates", done: () => false },
  { label: "Créer une recette (contenu + planning)", href: "/admin/patterns", done: (_a, r) => r > 0 },
  { label: "Générer la semaine depuis le calendrier", href: "/calendar", done: () => false },
];

export function AdminInbox({ items, accountsCount, recipesCount }: Props) {
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

      {accountsCount !== undefined &&
        recipesCount !== undefined &&
        (accountsCount === 0 || recipesCount === 0) && (
          <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-[13px] font-semibold text-foreground">Démarrer</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-2">
              La chaîne de publication a besoin d&apos;un socle — dans l&apos;ordre :
            </p>
            <ol className="space-y-1">
              {START_STEPS.map((step, i) => {
                const done = step.done(accountsCount, recipesCount);
                return (
                  <li key={i} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className={[
                        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] shrink-0",
                        done
                          ? "bg-success-50 border-success-200 text-success-700"
                          : "bg-muted border-border text-muted-foreground",
                      ].join(" ")}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <a href={step.href} className={done ? "text-muted-foreground line-through" : "text-foreground hover:underline"}>
                      {step.label}
                    </a>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

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

"use client";

/**
 * AccountsListAdmin — vue grid des comptes Instagram (refonte MID Liquid Glass).
 *
 * Cards style "profil IG" : aspect square, avatar circulaire au centre, handle,
 * nom client, stats compactes, et CTA central "Voir les patterns" pour accès
 * direct au workspace pattern (action principale).
 */

import { useState } from "react";
import Link from "next/link";
import { Instagram, Layers, Calendar, Eye } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { AccountPeekDrawer } from "./AccountPeekDrawer";

interface AccountItem {
  id: string;
  handle: string;
  name: string;
  activePatternCount: number;
  lastPublishedAt: string | null;
  client: { id: string; name: string } | null;
}


interface Props {
  accounts: AccountItem[];
}

function formatLastPublished(iso: string | null): string {
  if (!iso) return "Jamais publié";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Initiales du handle pour l'avatar (max 2 caractères). */
function handleInitials(handle: string): string {
  const cleaned = handle.replace(/^@/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

/** Gradient pastel déterministe par handle pour l'avatar. */
function avatarGradient(handle: string): string {
  const gradients = [
    "from-peach-200 to-rose-200",
    "from-sage-200 to-sky-200",
    "from-sky-200 to-peach-200",
    "from-rose-200 to-peach-200",
    "from-sage-200 to-peach-200",
    "from-sky-200 to-rose-200",
  ];
  let h = 0;
  for (let i = 0; i < handle.length; i++) {
    h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return gradients[h % gradients.length];
}

export function AccountsListAdmin({ accounts }: Props) {
  // Phase polish 2026-05-30 — filtre/recherche retiré temporairement (à
  // réintégrer si besoin de recherche transverse multi-clients). On affiche
  // la liste brute des comptes triés par leur ordre serveur.
  const filtered = accounts;
  const [peekAccountId, setPeekAccountId] = useState<string | null>(null);

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
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Planification
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Comptes Instagram
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {accounts.length} compte{accounts.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  {filtered.length} affiché{filtered.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Inner content */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Filter bar (search + clients + patterns) temporairement retirée.
                À réintégrer quand le besoin de recherche transverse multi-clients
                redevient pertinent. */}

            {/* Grid de cards */}
            {filtered.length === 0 ? (
              <EmptyState
                icon={Instagram}
                title="Aucun compte configuré"
                description="Aucun compte Instagram configuré pour le moment."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filtered.map((a) => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    onPeek={() => setPeekAccountId(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AccountPeekDrawer
        open={peekAccountId !== null}
        accountId={peekAccountId}
        onClose={() => setPeekAccountId(null)}
      />
    </div>
  );
}

// ─── AccountCard ────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: AccountItem;
  onPeek: () => void;
}

function AccountCard({ account, onPeek }: AccountCardProps) {
  const isInactive = account.activePatternCount === 0;
  const lastPublished = formatLastPublished(account.lastPublishedAt);
  const gradient = avatarGradient(account.handle);

  return (
    <div
      className={[
        "group relative flex flex-col items-center text-center gap-4 p-6 rounded-3xl transition-all aspect-square",
        // Glass franc — gradient blanc translucent + ring inset spéculaire.
        "bg-gradient-to-b from-white/90 to-white/60 backdrop-blur-[14px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.08),0_16px_36px_-12px_rgba(15,23,42,0.18)]",
        "hover:-translate-y-0.5",
      ].join(" ")}
    >
      {/* Bouton Aperçu — top-right, opacity hover-only */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ButtonIcon
          icon={Eye}
          label="Aperçu rapide"
          variant="ghost"
          size="sm"
          onClick={onPeek}
        />
      </div>

      {/* Avatar profil — gradient pastel + initiales */}
      <div
        className={[
          "relative h-20 w-20 rounded-full inline-flex items-center justify-center shrink-0",
          "bg-gradient-to-br",
          gradient,
          "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),0_2px_4px_rgba(15,23,42,0.06),0_8px_24px_-8px_rgba(15,23,42,0.16)]",
          "group-hover:scale-105 transition-transform",
        ].join(" ")}
      >
        <span className="text-[24px] font-semibold text-gray-800 tracking-tight">
          {handleInitials(account.handle)}
        </span>
        {/* Icône Instagram en pastille bottom-right */}
        <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white inline-flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.08)]">
          <Instagram size={12} className="text-rose-500" />
        </span>
      </div>

      {/* Identité */}
      <div className="min-w-0 w-full">
        <p className="text-[15px] font-semibold text-gray-950 truncate leading-tight">
          @{account.handle}
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5 truncate">{account.name}</p>
        {account.client ? (
          <Link
            href={`/admin/clients/${account.client.id}?tab=accounts`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-[10.5px] uppercase tracking-widest font-medium text-gray-400 hover:text-gray-700 mt-2 transition-colors"
          >
            {account.client.name}
          </Link>
        ) : (
          <p className="text-[10.5px] uppercase tracking-widest font-medium text-gray-400 mt-2 italic">
            Sans client
          </p>
        )}
      </div>

      {/* Stats — stack vertical pour éviter wrap dans les cards étroites (xl:grid-cols-4) */}
      <div className="flex flex-col gap-1.5 mt-auto items-start">
        {isInactive ? (
          <Chip variant="peach" icon={Layers} className="whitespace-nowrap">
            Sans pattern
          </Chip>
        ) : (
          <Chip variant="sage" icon={Layers} className="whitespace-nowrap">
            {account.activePatternCount} pattern
            {account.activePatternCount > 1 ? "s" : ""}
          </Chip>
        )}
        <span className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 font-mono tabular-nums whitespace-nowrap">
          <Calendar size={10} />
          {lastPublished}
        </span>
      </div>

      {/* CTA principal — accès direct aux patterns */}
      <Link
        href={`/admin/accounts/${account.id}`}
        className={[
          "w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-medium transition-all",
          "bg-gradient-to-b from-gray-700 to-gray-900 text-white",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(15,23,42,0.12),0_4px_12px_-4px_rgba(15,23,42,0.22)]",
          "hover:from-gray-600 hover:to-gray-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.2),0_2px_4px_rgba(15,23,42,0.16),0_8px_20px_-4px_rgba(15,23,42,0.28)]",
          "focus-ring",
        ].join(" ")}
      >
        <Layers size={13} />
        Voir les patterns
      </Link>
    </div>
  );
}

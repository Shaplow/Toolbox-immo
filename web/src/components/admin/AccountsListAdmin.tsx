"use client";

/**
 * AccountsListAdmin — vue grid des comptes Instagram (refonte MID Liquid Glass).
 *
 * Cards style "profil IG" : aspect square, avatar circulaire au centre, handle,
 * nom client, stats compactes, et CTA central "Voir les patterns" pour accès
 * direct au workspace pattern (action principale).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
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
    "from-warning-200 to-danger-200",
    "from-success-200 to-info-200",
    "from-info-200 to-warning-200",
    "from-danger-200 to-warning-200",
    "from-success-200 to-warning-200",
    "from-info-200 to-danger-200",
  ];
  let h = 0;
  for (let i = 0; i < handle.length; i++) {
    h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return gradients[h % gradients.length];
}

export function AccountsListAdmin({ accounts }: Props) {
  const router = useRouter();
  // Phase polish 2026-05-30 — filtre/recherche retiré temporairement (à
  // réintégrer si besoin de recherche transverse multi-clients). On affiche
  // la liste brute des comptes triés par leur ordre serveur.
  const filtered = accounts;
  const [peekAccountId, setPeekAccountId] = useState<string | null>(null);

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-[1400px] px-6 py-8"
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  Planification
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-foreground leading-[1.05]">
                  Comptes Instagram
                </h1>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {accounts.length} compte{accounts.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
                <span className="text-[11px] font-mono text-foreground tabular-nums">
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
                description="Les comptes Instagram se créent depuis la fiche d'un client — commence par en ouvrir (ou créer) un."
                cta={{ label: "Aller aux clients", onClick: () => router.push("/admin/clients") }}
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
        "bg-card border border-border ",
        "",
        "hover:",
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
          "",
          "group-hover:scale-105 transition-transform",
        ].join(" ")}
      >
        <span className="text-[24px] font-semibold text-gray-800 tracking-tight">
          {handleInitials(account.handle)}
        </span>
        {/* Icône Instagram en pastille bottom-right */}
        <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white inline-flex items-center justify-center ">
          <Instagram size={12} className="text-danger-600" />
        </span>
      </div>

      {/* Identité */}
      <div className="min-w-0 w-full">
        <p className="text-[15px] font-semibold text-foreground truncate leading-tight">
          @{account.handle}
        </p>
        <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{account.name}</p>
        {account.client ? (
          <Link
            href={`/admin/clients/${account.client.id}?tab=accounts`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-[10.5px] uppercase tracking-widest font-medium text-muted-foreground hover:text-foreground mt-2 transition-colors"
          >
            {account.client.name}
          </Link>
        ) : (
          <p className="text-[10.5px] uppercase tracking-widest font-medium text-muted-foreground mt-2 italic">
            Sans client
          </p>
        )}
      </div>

      {/* Stats — stack vertical pour éviter wrap dans les cards étroites (xl:grid-cols-4) */}
      <div className="flex flex-col gap-1.5 mt-auto items-start">
        {isInactive ? (
          <Chip variant="peach" icon={Layers} className="whitespace-nowrap">
            Sans recette
          </Chip>
        ) : (
          <Chip variant="sage" icon={Layers} className="whitespace-nowrap">
            {account.activePatternCount} recette
            {account.activePatternCount > 1 ? "s" : ""}
          </Chip>
        )}
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground font-mono tabular-nums whitespace-nowrap">
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
          "",
          "hover:from-gray-600 hover:to-gray-800 hover:",
          "focus-ring",
        ].join(" ")}
      >
        <Layers size={13} />
        Voir les patterns
      </Link>
    </div>
  );
}

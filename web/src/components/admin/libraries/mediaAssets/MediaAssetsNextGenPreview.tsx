"use client";

/**
 * MediaAssetsNextGenPreview — encart collapsible au top de la vue Catégories
 * qui prévisualise les 3 prochains packs qui sortiront en rotation auto.
 *
 * Phase 5 médiathèque (2026-05-30). Lit `groupedBySetTag` (déjà calculé dans
 * MediaAssetsPanel via `useMemo`) et filtre/trie sur `autoRank`. Pas de fetch
 * supplémentaire — l'info est déjà disponible côté client.
 *
 * Caché si aucun groupe n'a autoRank (lib non configurée pour rotation auto
 * ou tous les groupes désactivés).
 */

import { useState } from "react";
import { ChevronDown, FolderOpen, Info, Layers, RotateCw } from "lucide-react";
import type { SetGroup } from "./types";

interface Props {
  groupedBySetTag: SetGroup[];
  /** "per_account" (defaut) : cursor par compte → preview valable uniquement pour un compte donné.
      "shared" : cursor global → preview valable pour tous les comptes. */
  rotationScope?: string;
  /** Compte IG actif dans le filtre (utile uniquement en per_account). */
  accountFilter?: string | null;
}

export function MediaAssetsNextGenPreview({ groupedBySetTag, rotationScope, accountFilter }: Props) {
  const [open, setOpen] = useState(true);

  const next = groupedBySetTag
    .filter((g) => g.autoRank !== null && g.autoRank > 0 && g.isAccessible)
    .sort((a, b) => (a.autoRank ?? Infinity) - (b.autoRank ?? Infinity))
    .slice(0, 3);

  if (next.length === 0) return null;

  // Per-account scope sans compte sélectionné : la rotation est par compte, pas globale.
  // Afficher un état d'attente plutôt qu'un ordre trompeur.
  const isPerAccountWithoutFilter = rotationScope === "per_account" && !accountFilter;
  if (isPerAccountWithoutFilter) {
    return (
      <div className="mb-4 rounded-2xl bg-gradient-to-b from-info-50/70 via-info-50/45 to-white/55  px-3.5 py-2.5 flex items-center gap-2.5">
        <span className="shrink-0 h-7 w-7 rounded-full bg-gradient-to-b from-info-100 to-info-200/80 inline-flex items-center justify-center text-info-700 ">
          <Info size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-info-700 leading-tight">
            Rotation indépendante par compte
          </p>
          <p className="text-[10.5px] text-info-700/80 leading-tight">
            Sélectionne un compte IG ci-dessus pour voir l&apos;ordre de rotation qui le concerne.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-gradient-to-b from-success-50/85 via-success-50/55 to-white/55  overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-white/40 transition-colors text-left"
      >
        <span className="h-8 w-8 rounded-full bg-gradient-to-b from-success-100 to-success-200/80 inline-flex items-center justify-center text-success-700 ">
          <RotateCw size={12} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-success-700 leading-tight">
            Prochaines générations
          </p>
          <p className="text-[10.5px] text-success-700/80 leading-tight">
            {next.length} pack{next.length > 1 ? "s" : ""} à sortir en rotation auto
          </p>
        </div>
        <ChevronDown
          size={14}
          className={`text-success-700/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ol className="px-3 pb-3 space-y-1.5">
          {next.map((g) => (
            <li
              key={g.key}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-card border border-border "
            >
              <span className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-b from-success-100 to-success-200/80 text-success-700 text-[10px] font-bold inline-flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                {g.autoRank}
              </span>
              {g.category && (
                <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-danger-50/80 text-danger-700  shrink-0">
                  <FolderOpen size={9} />
                  {g.category}
                </span>
              )}
              <span className="text-muted-foreground/60 text-[10px]">›</span>
              {g.setTag ? (
                <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-danger-50/80 text-danger-700  truncate">
                  <Layers size={9} />
                  {g.setTag.startsWith("pack_") ? "pack auto" : g.setTag}
                </span>
              ) : (
                <span className="text-[10.5px] italic text-muted-foreground">pool</span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {g.accessibleCount} rush{g.accessibleCount !== 1 ? "es" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

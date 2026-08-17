"use client";

/**
 * CaptionsHeader — header de la page de génération de captions.
 *
 * Phase F3-step7 du split de CaptionsGenerateForm (plan F3). Header
 * compact avec back link "Captions" + icône violet + titre du preset
 * + subtitle contextuel (regen vs nouvelle gen).
 *
 * Composant pur, pas de state.
 */

import Link from "next/link";
import { ChevronLeft, Film } from "lucide-react";

interface Props {
  presetName: string;
  /** True si on est dans un flow de regen (SRT pré-chargé depuis un
   *  job précédent) → subtitle adapté. */
  isRegen: boolean;
}

export function CaptionsHeader({ presetName, isRegen }: Props) {
  return (
    <div className="mb-8">
      <Link
        href="/captions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-muted-foreground transition-colors mb-5"
      >
        <ChevronLeft size={14} />
        Captions
      </Link>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-danger-100 rounded-xl flex items-center justify-center shrink-0">
          <Film size={18} className="text-danger-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{presetName}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isRegen
              ? "Sous-titres pré-chargés depuis la génération précédente"
              : "Générez une vidéo avec des sous-titres brûlés"}
          </p>
        </div>
      </div>
    </div>
  );
}

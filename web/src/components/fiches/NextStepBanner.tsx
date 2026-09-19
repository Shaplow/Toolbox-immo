"use client";

/**
 * NextStepBanner — « à toi : … », déduit de la chaîne d'étapes.
 *
 * Pendant générique de `publications/NextActionBanner`, qui lit la machine à
 * états du slot et ne vaut donc que pour une publication. Ici, la prochaine
 * action est simplement l'étape que le moteur a marquée `nextAction` : rien à
 * redéfinir, rien à garder synchronisé.
 *
 * Le clic déplie la section correspondante et y amène. Sans cible connue, le
 * bandeau reste affiché mais n'est pas cliquable — mieux vaut dire quoi faire
 * sans lien que de promettre un saut qui ne se produit pas.
 */

import { ArrowRight, Sparkles } from "lucide-react";
import { emitOpenSection } from "@/components/fiches/openSectionEvent";
import type { ChainStep } from "@/lib/steps/engine";

export interface NextStepBannerProps {
  steps: ChainStep<string>[];
  /** Étape → id de section à ouvrir. Une clé absente rend le bandeau inerte. */
  stepToSection?: Record<string, string>;
}

export function NextStepBanner({ steps, stepToSection = {} }: NextStepBannerProps) {
  const next = steps.find((s) => s.nextAction);
  if (!next) return null;

  const sectionId = stepToSection[next.key];
  // Le nom de l'étape est un état (« Tournage ») ; le bandeau veut un verbe.
  const label = next.action ?? next.label;

  const content = (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-50 border border-success-200">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success-100 text-success-700">
        <Sparkles size={9} />
      </span>
      <span className="text-[10.5px] uppercase tracking-widest font-semibold text-success-700">
        À toi
      </span>
      <span className="text-[12px] text-success-700 max-w-[320px] truncate" title={label}>
        {label}
      </span>
      {sectionId && (
        <ArrowRight
          size={11}
          className="text-success-700/70 group-hover:translate-x-0.5 transition-transform"
          aria-hidden="true"
        />
      )}
    </span>
  );

  return (
    <div className="flex justify-end">
      {sectionId ? (
        <button
          type="button"
          onClick={() => emitOpenSection(sectionId)}
          className="group focus-ring rounded-lg"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

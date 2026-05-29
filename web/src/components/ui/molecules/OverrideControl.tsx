"use client";

/**
 * OverrideControl — pattern "hériter du parent" vs "override custom".
 *
 * Factorise les 3 variantes dupliquées dans SlotDetailPanel :
 * - OverrideSelect (boolean override)
 * - OverrideEnumSelect (enum override)
 * - PresetSelect (preset ref override)
 *
 * Doctrine Liquid Glass v2 :
 * - Container : surface-glass-soft avec ring inset.
 * - Header : label + description + switch d'override.
 * - Body : valeur héritée affichée en text gris (quand non override) ou
 *   l'éditeur custom (quand override).
 * - Transition fluide entre les 2 états.
 *
 * Generic typing : accepte n'importe quelle valeur via children (Switch,
 * Combobox, Input, etc.) — le composant gère juste le toggle.
 *
 * API :
 *
 *   <OverrideControl
 *     label="Notifier le client"
 *     description="Envoyer un email à la publication"
 *     inheritedValue="Hérité du pattern : non"
 *     isOverriden={isOverriden}
 *     onToggleOverride={setIsOverriden}
 *   >
 *     <Switch checked={value} onChange={setValue} />
 *   </OverrideControl>
 */

import type { ReactNode } from "react";
import { Switch } from "../Switch";

interface OverrideControlProps {
  /** Label principal du contrôle. */
  label: ReactNode;
  /** Description optionnelle sous le label. */
  description?: ReactNode;
  /** Valeur héritée affichée quand non override (string ou ReactNode). */
  inheritedValue: ReactNode;
  /** État du toggle override. */
  isOverriden: boolean;
  /** Callback toggle override. */
  onToggleOverride: (value: boolean) => void;
  /** Éditeur custom à afficher quand override actif. */
  children: ReactNode;
  /** Désactive l'override (lecture seule). */
  disabled?: boolean;
  className?: string;
}

export function OverrideControl({
  label,
  description,
  inheritedValue,
  isOverriden,
  onToggleOverride,
  children,
  disabled = false,
  className,
}: OverrideControlProps) {
  return (
    <div
      className={[
        "rounded-xl px-4 py-3.5 transition-all",
        isOverriden
          ? "bg-rose-50/40 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.22)]"
          : "bg-white/40 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Header : label + description + switch */}
      <div className="flex items-start justify-between gap-4 mb-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-950 leading-tight">{label}</p>
          {description && (
            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        <Switch
          checked={isOverriden}
          onChange={onToggleOverride}
          disabled={disabled}
          accent="default"
          size="sm"
        />
      </div>

      {/* Body : valeur héritée ou éditeur override */}
      {isOverriden ? (
        <div className="pt-2 border-t border-rose-200/40">
          <p className="text-[10px] uppercase tracking-widest font-medium text-rose-700/80 mb-2">
            Override actif
          </p>
          {children}
        </div>
      ) : (
        <div className="pt-2 border-t border-white/40">
          <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1">
            Hérité
          </p>
          <p className="text-[13px] text-gray-700 leading-relaxed">{inheritedValue}</p>
        </div>
      )}
    </div>
  );
}

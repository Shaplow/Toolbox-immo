"use client";

/**
 * RotationSettingsSection — onglet « Tirage » commun aux drawers de réglages
 * MediaLibrary / DataLibrary (mode auto/aucun + portée per_account/shared +
 * consommation max).
 *
 * Extrait de MediaLibrarySettingsDrawer / DataLibrarySettingsDrawer où ce
 * bloc était dupliqué à l'identique (chips + Input + validation côté caller).
 * Les textes d'aide varient selon le vocabulaire métier (asset/plan vs
 * fiche, accord ils/elles) — ils restent donc portés par le caller plutôt
 * que reconstruits ici depuis un simple mot substitué.
 */

import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { RotateCw } from "lucide-react";
import { rotationScopeLabel } from "@/lib/i18n/glossary";
import { SettingsSectionCard } from "./SettingsSectionCard";

export type RotationMode = "auto" | "none";
export type RotationScope = "per_account" | "shared";

interface RotationSettingsSectionProps {
  mode: RotationMode;
  onModeChange: (mode: RotationMode) => void;
  scope: RotationScope;
  onScopeChange: (scope: RotationScope) => void;
  maxUsageCount: string;
  onMaxUsageCountChange: (value: string) => void;
  /** Aide sous les chips de mode, selon le mode actif. */
  modeHelp: { auto: string; none: string };
  /** Libellé du FormField portée — accord grammatical différent selon l'unité (ex: ils/elles). */
  turnoverLabel: string;
  /** Unité métier au singulier — pilote le libellé « Consommation max par … ». */
  unit: { singular: string };
  /** Aide du champ consommation max, selon la portée active. */
  maxUsageHelp: { per_account: string; shared: string };
}

export function RotationSettingsSection({
  mode,
  onModeChange,
  scope,
  onScopeChange,
  maxUsageCount,
  onMaxUsageCountChange,
  modeHelp,
  turnoverLabel,
  unit,
  maxUsageHelp,
}: RotationSettingsSectionProps) {
  return (
    <SettingsSectionCard title="Tirage" icon={RotateCw}>
      <FormField label="Tirage automatique">
        <div className="flex gap-1.5 flex-wrap">
          {(["auto", "none"] as const).map((m) => (
            <Chip
              key={m}
              variant={mode === m ? "sky" : "default"}
              selected={mode === m}
              onClick={() => onModeChange(m)}
              size="sm"
            >
              {m === "auto" ? "Auto · par dossier" : "Aucun"}
            </Chip>
          ))}
        </div>
        <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-relaxed">
          {mode === "auto" ? modeHelp.auto : modeHelp.none}
        </p>
      </FormField>
      <FormField
        label={turnoverLabel}
        help="Indépendant : chaque compte avance dans son propre cycle. Partagé : tous les comptes consomment le même."
      >
        <div className="flex gap-1.5">
          {(["per_account", "shared"] as const).map((s) => (
            <Chip
              key={s}
              variant={scope === s ? "sky" : "default"}
              selected={scope === s}
              onClick={() => onScopeChange(s)}
              size="sm"
            >
              {rotationScopeLabel(s)}
            </Chip>
          ))}
        </div>
      </FormField>
      <FormField
        label={`Consommation max par ${unit.singular}`}
        help={scope === "per_account" ? maxUsageHelp.per_account : maxUsageHelp.shared}
      >
        <Input
          value={maxUsageCount}
          onChange={onMaxUsageCountChange}
          placeholder="Vide = infini"
          type="number"
        />
      </FormField>
    </SettingsSectionCard>
  );
}

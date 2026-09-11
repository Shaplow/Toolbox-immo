"use client";

/**
 * Champ de saisie d'un modèle `{{clé}}` : textarea + chips d'insertion des clés
 * disponibles + aperçu + avertissements.
 *
 * Le pattern visuel vient du formulaire recette (« Modèle de légende »), où il
 * est inliné et couplé à ses propres champs. Ici il est autonome : l'appelant
 * fournit les clés et décide contre quoi rendre l'aperçu — le composant ne
 * connaît ni les fiches, ni les bibliothèques.
 */

import type { ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";

export interface TemplateKey {
  key: string;
  label: string;
}

export interface TemplateTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Clés insérables, affichées en chips sous le champ. */
  keys: TemplateKey[];
  /** Titre du groupe de chips. */
  keysTitle?: string;
  /** Message affiché à la place des chips quand il n'y a aucune clé. */
  emptyKeysHint?: ReactNode;
  rows?: number;
  placeholder?: string;
  /** Rendu de l'aperçu — l'appelant sait contre quelles valeurs résoudre. */
  preview?: ReactNode;
  /** Clés `{{…}}` du modèle absentes de `keys` : signalées en avertissement. */
  unknownKeys?: string[];
  /** Groupes de chips supplémentaires (autres sources de clés). */
  children?: ReactNode;
}

export function TemplateTextField({
  value,
  onChange,
  keys,
  keysTitle = "Champs de la fiche",
  emptyKeysHint,
  rows = 2,
  placeholder,
  preview,
  unknownKeys = [],
  children,
}: TemplateTextFieldProps) {
  // Insertion à la fin, séparée d'un espace — même geste que le formulaire
  // recette : on complète un modèle, on ne le remplace pas.
  const insert = (key: string) => onChange(value ? `${value} {{${key}}}` : `{{${key}}}`);

  return (
    <>
      <Textarea value={value} onChange={onChange} rows={rows} placeholder={placeholder} />
      <div className="space-y-3 mt-2">
        {keys.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">
              {keysTitle}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keys.map((f) => (
                <Chip key={f.key} size="sm" onClick={() => insert(f.key)}>
                  {f.label === f.key ? f.key : `${f.label} · ${f.key}`}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          emptyKeysHint && <p className="text-[11px] text-muted-foreground">{emptyKeysHint}</p>
        )}

        {children}

        {unknownKeys.length > 0 && (
          <p className="text-[11px] text-danger-700">
            {unknownKeys.length === 1 ? "Champ inconnu" : "Champs inconnus"}{" "}
            {unknownKeys.map((k) => `« ${k} »`).join(", ")} — {unknownKeys.length === 1 ? "il" : "ils"}{" "}
            {unknownKeys.length === 1 ? "sera remplacé" : "seront remplacés"} par du vide.
          </p>
        )}

        {preview}
      </div>
    </>
  );
}

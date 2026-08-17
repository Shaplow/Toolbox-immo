"use client";

/**
 * DataTabPanel — onglet "Data" du rail gauche du builder.
 *
 * Extrait de SettingsPanel (Phase A polish 2026-05-30). Auparavant la config
 * de la bibliothèque de données était dans le panel Paramètres aux côtés des
 * marges et du format — pas naturel.
 *
 * Aligné sur le pattern Cover/CaptionsTabPanel : panel autonome avec sa
 * propre logique de fetch.
 *
 * Plan simplification Phase 4 : le wrapper DataCampaign est décommissionné —
 * seul `dataLibraryId` compte désormais (le serveur résout les anciens
 * templates qui portent encore un `dataCampaignId` legacy). Plus d'auto-link
 * de campagne ici.
 */

import { useEffect, useState } from "react";
import { Database, Download } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { SchemaField } from "@/types/template";

function downloadCSVTemplate(schema: SchemaField[], templateName: string) {
  // Only data-like fields (exclude video/image/audio — they aren't stored in DataEntry)
  const dataFields = schema.filter((f) => !["image", "video", "audio"].includes(f.type));
  const headers = ["set_tag", "category", ...dataFields.map((f) => f.key)];
  const csv = headers.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modele-${templateName.toLowerCase().replace(/\s+/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DataTabPanel() {
  const { template, updateContentLibrary } = useBuilderStore();
  const cl = template.contentLibrary;

  const [dataLibraries, setDataLibraries] = useState<{ id: string; name: string; templateType: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/libraries/data")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string; templateType: string }[]>) : []))
      .then(setDataLibraries)
      .catch(() => {});
  }, []);

  const hasLib = !!cl?.dataLibraryId;
  const hasSchema = template.schema.length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-success-100/70 text-success-700 ">
          <Database size={13} />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-foreground leading-tight">Bibliothèque de données</p>
          <p className="text-[10.5px] text-muted-foreground leading-tight">
            Champs auto-remplis depuis une lib data (CSV / Excel).
          </p>
        </div>
      </div>

      {/* Bibliothèque */}
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Source</p>
        {dataLibraries.length === 0 ? (
          <p className="text-[10.5px] text-muted-foreground italic">
            Aucune bibliothèque configurée. Crée-en une depuis Médiathèque → Données.
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Bibliothèque</span>
            <select
              value={cl?.dataLibraryId ?? ""}
              onChange={(e) =>
                updateContentLibrary({
                  dataLibraryId: e.target.value || undefined,
                })
              }
              className="border border-border rounded px-2 py-1 text-xs bg-white"
            >
              <option value="">— Aucune —</option>
              {dataLibraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name} ({lib.templateType})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Sélection / Mode de génération — visible uniquement si une lib est choisie */}
      {hasLib && (
        <div className="px-3 py-3 border-b border-border space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Comportement à la génération
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Sélection à la génération</span>
            <select
              value={cl?.dataSelectionRule === "manual" ? "manual" : "auto"}
              onChange={(e) =>
                updateContentLibrary({
                  dataSelectionRule: e.target.value === "manual" ? "manual" : "not_used_in_cycle",
                })
              }
              className="border border-border rounded px-2 py-1 text-xs bg-white"
            >
              <option value="auto">Tirage par dossier</option>
              <option value="manual">Manuelle</option>
            </select>
            {(!cl.dataSelectionRule || cl.dataSelectionRule !== "manual") && (
              <span className="text-[9px] text-muted-foreground leading-relaxed">
                La règle d&apos;utilisation est définie sur la bibliothèque (Médiathèque → Données → réglages).
              </span>
            )}
          </label>

          {(!cl.dataSelectionRule || cl.dataSelectionRule !== "manual") && (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Mode de génération</span>
              <select
                value={template.generationMode ?? "manual"}
                onChange={(e) =>
                  useBuilderStore.getState().setGenerationMode(
                    e.target.value === "manual" ? undefined : (e.target.value as "auto" | "both"),
                  )
                }
                className="border border-border rounded px-2 py-1 text-xs bg-white"
              >
                <option value="manual">Manuel — formulaire pré-rempli</option>
                <option value="auto">Auto — pas de formulaire</option>
                <option value="both">Les deux — l&apos;utilisateur choisit</option>
              </select>
              <span className="text-[9px] text-muted-foreground leading-relaxed">
                {!template.generationMode || template.generationMode === "manual"
                  ? "Le formulaire s'affiche avec les données pré-remplies."
                  : template.generationMode === "auto"
                    ? "Pas de formulaire — tout est résolu depuis les bibliothèques."
                    : "L'utilisateur choisit le mode au moment de générer."}
              </span>
            </label>
          )}
        </div>
      )}

      {/* Modèle CSV — accessible dès qu'on a un schéma, même sans lib choisie */}
      {hasSchema && (
        <div className="px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Modèle</p>
          <button
            type="button"
            onClick={() => downloadCSVTemplate(template.schema, "données")}
            className="inline-flex items-center gap-1.5 text-[11px] text-info-700 hover:text-info-700 font-medium transition-colors"
          >
            <Download size={11} />
            Télécharger le modèle CSV
          </button>
          <p className="mt-1 text-[9.5px] text-muted-foreground leading-relaxed">
            Colonnes <code className="font-mono">set_tag</code>, <code className="font-mono">category</code> + un en-tête
            par champ du schéma du template.
          </p>
        </div>
      )}
    </div>
  );
}

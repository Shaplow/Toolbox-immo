"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { CANVAS_FORMATS } from "@/types/template";
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

export function SettingsPanel() {
  const { template, updateContentLibrary, updateCanvas } = useBuilderStore();
  const cl = template.contentLibrary;

  const [dataLibraries, setDataLibraries] = useState<{ id: string; name: string; templateType: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  useEffect(() => {
    fetch("/api/admin/libraries/data")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string; templateType: string }[]>) : []))
      .then(setDataLibraries)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!cl?.dataLibraryId) {
      setCampaigns([]);
      setLoadingCampaigns(false);
      return;
    }
    let active = true;
    void (async () => {
      setLoadingCampaigns(true);
      try {
        const r = await fetch(`/api/admin/libraries/data/${cl.dataLibraryId}/campaigns`);
        const data: { id: string; name: string; isActive: boolean }[] = r.ok ? await (r.json() as Promise<{ id: string; name: string; isActive: boolean }[]>) : [];
        if (active) setCampaigns(data);
      } catch {
        // ignore
      } finally {
        if (active) setLoadingCampaigns(false);
      }
    })();
    return () => {
      active = false;
      setCampaigns([]);
    };
  }, [cl?.dataLibraryId]);

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      {/* Format */}
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Format</p>
        <div className="space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500">Format du canvas</span>
            <select
              value={template.canvas.format}
              onChange={(e) => useBuilderStore.getState().setFormat(e.target.value as never)}
              className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none"
            >
              {Object.entries(CANVAS_FORMATS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </label>
          {template.canvas.format === "CUSTOM" && (
            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-0.5 flex-1">
                <span className="text-gray-400 text-[10px]">Largeur (px)</span>
                <input
                  type="number"
                  min={1}
                  value={template.canvas.width}
                  onChange={(e) => updateCanvas({ width: Math.max(1, Number(e.target.value) || 1), format: "CUSTOM" })}
                  className="border border-gray-200 rounded px-2 py-1 text-xs"
                />
              </label>
              <span className="text-gray-300 mt-4">×</span>
              <label className="flex flex-col gap-0.5 flex-1">
                <span className="text-gray-400 text-[10px]">Hauteur (px)</span>
                <input
                  type="number"
                  min={1}
                  value={template.canvas.height}
                  onChange={(e) => updateCanvas({ height: Math.max(1, Number(e.target.value) || 1), format: "CUSTOM" })}
                  className="border border-gray-200 rounded px-2 py-1 text-xs"
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Canvas</p>
        <div className="space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500">Couleur de fond</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={template.canvas.backgroundColor}
                onChange={(e) => updateCanvas({ backgroundColor: e.target.value })}
                className="h-8 w-12 border border-gray-200 rounded"
              />
              <input
                type="text"
                value={template.canvas.backgroundColor}
                onChange={(e) => updateCanvas({ backgroundColor: e.target.value })}
                className="flex-1 border border-gray-200 rounded px-2 py-1 font-mono text-xs"
                placeholder="#FFFFFF"
              />
            </div>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500">Fond perdu (bleed, px)</span>
            <input
              type="number"
              min={0}
              value={template.canvas.bleed}
              onChange={(e) => updateCanvas({ bleed: Math.max(0, Number(e.target.value) || 0) })}
              className="border border-gray-200 rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500">DPI</span>
            <input
              type="number"
              min={72}
              step={1}
              value={template.canvas.dpi}
              onChange={(e) => updateCanvas({ dpi: Math.max(72, Number(e.target.value) || 72) })}
              className="border border-gray-200 rounded px-2 py-1 text-xs"
            />
          </label>
        </div>
      </div>

      {/* Data Library */}
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Données automatiques</p>
        {dataLibraries.length === 0 ? (
          <p className="text-[10px] text-gray-400">Aucune bibliothèque configurée.</p>
        ) : (
          <div className="space-y-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-500">Bibliothèque</span>
              <select
                value={cl?.dataLibraryId ?? ""}
                onChange={(e) =>
                  updateContentLibrary({ dataLibraryId: e.target.value || undefined, dataCampaignId: undefined })
                }
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">— Aucune —</option>
                {dataLibraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
            </label>

            {cl?.dataLibraryId && (
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Campagne</span>
                {loadingCampaigns ? (
                  <span className="text-[10px] text-gray-400 italic">Chargement…</span>
                ) : campaigns.length === 0 ? (
                  <span className="text-[10px] text-gray-400 italic">Aucune campagne dans cette bibliothèque.</span>
                ) : (
                  <select
                    value={cl?.dataCampaignId ?? ""}
                    onChange={(e) => updateContentLibrary({ dataCampaignId: e.target.value || undefined })}
                    className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                  >
                    <option value="">— Sélectionner —</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}

            {cl?.dataCampaignId && (
              <>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-500">Sélection à la génération</span>
                  <select
                    value={cl?.dataSelectionRule === "manual" ? "manual" : "auto"}
                    onChange={(e) =>
                      updateContentLibrary({
                        dataSelectionRule: e.target.value === "manual" ? "manual" : "not_used_in_cycle",
                      })
                    }
                    className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                  >
                    <option value="auto">Automatique (selon la campagne)</option>
                    <option value="manual">Manuelle — choix à la génération</option>
                  </select>
                  {(!cl.dataSelectionRule || cl.dataSelectionRule !== "manual") && (
                    <span className="text-[9px] text-gray-400 leading-relaxed">
                      La règle d&apos;utilisation est définie sur la campagne.
                    </span>
                  )}
                </label>

                {(!cl.dataSelectionRule || cl.dataSelectionRule !== "manual") && (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Mode de génération</span>
                    <select
                      value={template.generationMode ?? "manual"}
                      onChange={(e) =>
                        useBuilderStore.getState().setGenerationMode(
                          e.target.value === "manual" ? undefined : (e.target.value as "auto" | "both")
                        )
                      }
                      className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="manual">Manuel — formulaire pré-rempli</option>
                      <option value="auto">Auto — pas de formulaire</option>
                      <option value="both">Les deux — l&apos;utilisateur choisit</option>
                    </select>
                    <span className="text-[9px] text-gray-400 leading-relaxed">
                      {!template.generationMode || template.generationMode === "manual"
                        ? "Le formulaire s'affiche avec les données pré-remplies."
                        : template.generationMode === "auto"
                        ? "Pas de formulaire — tout est résolu depuis les bibliothèques."
                        : "L'utilisateur choisit le mode au moment de générer."}
                    </span>
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => downloadCSVTemplate(template.schema, "données")}
                  className="flex items-center gap-1.5 text-[10px] text-indigo-600 hover:text-indigo-700 mt-1"
                >
                  <Download size={11} />
                  Télécharger le modèle CSV
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Margins */}
      <div className="px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Marges (px)</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "marginTop", label: "Haut" },
              { key: "marginRight", label: "Droite" },
              { key: "marginBottom", label: "Bas" },
              { key: "marginLeft", label: "Gauche" },
            ] as const
          ).map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="text-gray-400 text-[10px]">{label}</span>
              <input
                type="number"
                min={0}
                value={template.canvas[key]}
                onChange={(e) => updateCanvas({ [key]: Math.max(0, Number(e.target.value) || 0) })}
                className="border border-gray-200 rounded px-2 py-1 text-xs"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

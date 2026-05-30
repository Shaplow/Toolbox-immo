"use client";

import { useBuilderStore } from "@/lib/store/builderStore";
import { CANVAS_FORMATS } from "@/types/template";

export function SettingsPanel() {
  const { template, updateCanvas } = useBuilderStore();

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
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500">Durée fixe (s)</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={template.canvas.maxDuration ?? ""}
              placeholder="auto"
              onChange={(e) => {
                const raw = e.target.value;
                updateCanvas({ maxDuration: raw === "" ? undefined : Math.max(0.5, Number(raw) || 0.5) });
              }}
              className="border border-gray-200 rounded px-2 py-1 text-xs"
            />
            <span className="text-[10px] text-gray-400">Trim/pad la vidéo finale à cette durée. Vide = somme des slots.</span>
          </label>
        </div>
      </div>

      {/* Note de redirection vers les onglets dédiés du rail gauche */}
      <div className="px-3 py-3 border-b border-gray-100 bg-sky-50/40">
        <p className="text-[11px] text-sky-800 leading-relaxed">
          Les configurations <span className="font-medium">Données</span>,{" "}
          <span className="font-medium">Cover auto</span> et{" "}
          <span className="font-medium">Sous-titres auto</span> ont chacune leur
          onglet dédié dans le rail à gauche.
        </p>
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

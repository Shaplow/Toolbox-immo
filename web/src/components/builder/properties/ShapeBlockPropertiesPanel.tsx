import type { ShapeBlock, ShapeKind } from "@/types/template";
import { Section } from "./Section";

export function ShapeBlockPropertiesPanel({
  block,
  onChange,
}: {
  block: ShapeBlock;
  onChange: (c: Partial<ShapeBlock>) => void;
}) {
  return (
    <>
      <Section label="Forme">
        <select
          value={block.shape}
          onChange={(e) => onChange({ shape: e.target.value as ShapeKind })}
          className="w-full border border-gray-200 rounded px-2 py-1"
        >
          <option value="rectangle">▬ Rectangle</option>
          <option value="circle">● Cercle / Ovale</option>
          <option value="triangle">▲ Triangle</option>
          <option value="diamond">◆ Diamant</option>
        </select>
      </Section>
      <Section label="Couleurs">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-gray-400">Remplissage</label>
            <input
              type="color"
              value={block.fillColor}
              onChange={(e) => onChange({ fillColor: e.target.value })}
              className="w-8 h-6 cursor-pointer rounded border border-gray-200"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-gray-400">Contour</label>
            <input
              type="color"
              value={block.borderColor ?? "#000000"}
              onChange={(e) => onChange({ borderColor: e.target.value })}
              className="w-8 h-6 cursor-pointer rounded border border-gray-200"
            />
          </div>
        </div>
      </Section>
      <Section label="Options">
        <div className="space-y-2">
          {block.shape === "rectangle" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400">Arrondi (px)</span>
              <input
                type="number" min={0} max={500}
                value={block.borderRadius ?? 0}
                onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
                className="border border-gray-200 rounded px-2 py-1"
              />
            </label>
          )}
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Épaisseur contour (px)</span>
            <input
              type="number" min={0} max={50}
              value={block.borderWidth ?? 0}
              onChange={(e) => onChange({ borderWidth: Number(e.target.value) || undefined })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Opacité (0–1)</span>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={1} step={0.05}
                value={block.opacity ?? 1}
                onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-gray-500 w-8 text-right">{((block.opacity ?? 1) * 100).toFixed(0)}%</span>
            </div>
          </label>
        </div>
      </Section>
    </>
  );
}

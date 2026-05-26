import type { ShapeBlock, ShapeKind } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
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
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
        >
          <option value="rectangle">▬ Rectangle</option>
          <option value="circle">● Cercle / Ovale</option>
          <option value="triangle">▲ Triangle</option>
          <option value="diamond">◆ Diamant</option>
        </select>
      </Section>

      <Section label="Couleurs">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Remplissage</span>
            <input
              type="color"
              value={block.fillColor}
              onChange={(e) => onChange({ fillColor: e.target.value })}
              className="h-8 w-full cursor-pointer rounded-lg border border-gray-200"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Contour</span>
            <input
              type="color"
              value={block.borderColor ?? "#000000"}
              onChange={(e) => onChange({ borderColor: e.target.value })}
              className="h-8 w-full cursor-pointer rounded-lg border border-gray-200"
            />
          </label>
        </div>
      </Section>

      <Section label="Options">
        <div className="space-y-3">
          {block.shape === "rectangle" && (
            <Slider
              label="Arrondi"
              value={block.borderRadius ?? 0}
              onChange={(v) => onChange({ borderRadius: v })}
              min={0}
              max={100}
              unit="px"
            />
          )}
          <Slider
            label="Épaisseur contour"
            value={block.borderWidth ?? 0}
            onChange={(v) => onChange({ borderWidth: v || undefined })}
            min={0}
            max={20}
            unit="px"
          />
          <Slider
            label="Opacité"
            value={Math.round((block.opacity ?? 1) * 100)}
            onChange={(v) => onChange({ opacity: v / 100 })}
            min={0}
            max={100}
            unit="%"
          />
        </div>
      </Section>
    </>
  );
}

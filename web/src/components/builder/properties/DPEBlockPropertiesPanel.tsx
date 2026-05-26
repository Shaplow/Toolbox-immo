import type { DPEBlock } from "@/types/template";
import { Section } from "./Section";

export function DPEBlockPropertiesPanel({
  block,
  onChange,
}: {
  block: DPEBlock;
  onChange: (c: Partial<DPEBlock>) => void;
}) {
  return (
    <Section label="Diagramme">
      <div className="flex gap-1">
        {(["energy", "climate"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange({ variant: v, w: 430, h: 400 })}
            className={`flex-1 text-xs py-1 rounded border transition-colors ${
              block.variant === v
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
            }`}
          >
            {v === "energy" ? "⚡ Énergie" : "🌡 Climat CO₂"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={block.showFrame ?? true}
            onChange={(e) => onChange({ showFrame: e.target.checked })}
          />
          Afficher le cadre
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={block.showBackground ?? true}
            onChange={(e) => onChange({ showBackground: e.target.checked })}
          />
          Afficher le fond
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400 text-[11px]">Couleur du cadre</span>
          <input
            type="color"
            value={block.frameColor ?? "#9a9a9a"}
            onChange={(e) => onChange({ frameColor: e.target.value })}
            className="h-8 w-full border border-gray-200 rounded"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400 text-[11px]">Couleur du fond</span>
          <input
            type="color"
            value={block.backgroundColor ?? "#ffffff"}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="h-8 w-full border border-gray-200 rounded"
          />
        </label>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        Les valeurs sont saisies lors de la génération.<br/>
        Clés fixes : <span className="font-mono">dpe_note</span>, <span className="font-mono">dpe_valeur</span>, <span className="font-mono">ges_note</span>, <span className="font-mono">ges_valeur</span>.
      </p>
    </Section>
  );
}

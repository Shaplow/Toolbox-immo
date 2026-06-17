import type { DPEBlock } from "@/types/template";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
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
      <div className="space-y-3">
        {/* Variant selector */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Type de diagramme</span>
          <div className="flex gap-1">
            {(["energy", "climate"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ variant: v, w: 430, h: 400 })}
                className={[
                  "flex-1 text-xs py-1.5 rounded-lg border transition-colors font-medium",
                  block.variant === v
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-muted-foreground border-border hover:border-indigo-300 hover:text-indigo-600",
                ].join(" ")}
              >
                {v === "energy" ? "Énergie" : "Climat CO₂"}
              </button>
            ))}
          </div>
        </div>

        {/* Toggle switches */}
        <div className="space-y-2">
          <ToggleSwitch
            checked={block.showFrame ?? true}
            onChange={(v) => onChange({ showFrame: v })}
            label="Afficher le cadre"
          />
          <ToggleSwitch
            checked={block.showBackground ?? true}
            onChange={(v) => onChange({ showBackground: v })}
            label="Afficher le fond"
          />
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Couleur du cadre</span>
            <input
              type="color"
              value={block.frameColor ?? "#9a9a9a"}
              onChange={(e) => onChange({ frameColor: e.target.value })}
              className="h-8 w-full border border-border rounded-lg cursor-pointer"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Couleur du fond</span>
            <input
              type="color"
              value={block.backgroundColor ?? "#ffffff"}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-8 w-full border border-border rounded-lg cursor-pointer"
            />
          </label>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Les valeurs sont saisies lors de la génération.<br/>
          Clés fixes : <span className="font-mono">dpe_note</span>, <span className="font-mono">dpe_valeur</span>, <span className="font-mono">ges_note</span>, <span className="font-mono">ges_valeur</span>.
        </p>
      </div>
    </Section>
  );
}

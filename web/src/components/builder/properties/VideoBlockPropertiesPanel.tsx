import type { VideoBlock } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
import { Section } from "./Section";

export function VideoBlockPropertiesPanel({
  block,
  onChange,
}: {
  block: VideoBlock;
  onChange: (c: Partial<VideoBlock>) => void;
}) {
  return (
    <Section label="Options vidéo">
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">Redimensionnement</span>
          <select
            value={block.fit ?? "cover"}
            onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
          >
            <option value="cover">Cover (remplir + recadrer)</option>
            <option value="contain">Contain (letterbox)</option>
          </select>
        </label>

        <Slider
          label="Border radius"
          value={block.borderRadius ?? 0}
          onChange={(v) => onChange({ borderRadius: v })}
          min={0}
          max={100}
          unit="px"
        />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">Couleur placeholder (builder)</span>
          <input
            type="color"
            value={block.placeholderColor ?? "#111827"}
            onChange={(e) => onChange({ placeholderColor: e.target.value })}
            className="h-8 w-full border border-gray-200 rounded-lg cursor-pointer"
          />
        </label>

        <ToggleSwitch
          checked={block.mute ?? false}
          onChange={(v) => onChange({ mute: v })}
          label="Couper l'audio de cette vidéo"
        />

        {!block.mute && (
          <Slider
            label="Volume audio"
            value={Math.round((block.audioVolume ?? 1) * 100)}
            onChange={(v) => onChange({ audioVolume: v / 100 })}
            min={0}
            max={100}
            unit="%"
          />
        )}

        <p className="text-[10px] text-gray-400 leading-relaxed">
          Ce bloc est le fond vidéo du template.<br />
          La source et la bibliothèque se configurent dans l&apos;onglet <strong>Séquence</strong>.
        </p>
      </div>
    </Section>
  );
}

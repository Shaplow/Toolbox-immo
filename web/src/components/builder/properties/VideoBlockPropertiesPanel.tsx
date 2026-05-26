import type { VideoBlock } from "@/types/template";
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
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Redimensionnement</span>
        <select
          value={block.fit ?? "cover"}
          onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
          className="border border-gray-200 rounded px-2 py-1 text-sm"
        >
          <option value="cover">Cover (remplir + recadrer)</option>
          <option value="contain">Contain (letterbox)</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Border radius</span>
        <input type="number" value={block.borderRadius ?? 0}
          onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Couleur placeholder (builder)</span>
        <input type="color" value={block.placeholderColor ?? "#111827"}
          onChange={(e) => onChange({ placeholderColor: e.target.value })}
          className="h-8 w-full border border-gray-200 rounded"
        />
      </label>
      <label className="flex items-center gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={block.mute ?? false}
          onChange={(e) => onChange({ mute: e.target.checked })}
          className="rounded"
        />
        <span className="text-gray-600 text-[11px]">Couper l&apos;audio de cette vidéo</span>
      </label>
      {!block.mute && (
        <label className="flex flex-col gap-1 mt-3">
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-400">Volume audio</span>
            <span className="text-gray-600">{Math.round((block.audioVolume ?? 1) * 100)}%</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={block.audioVolume ?? 1}
            onChange={(e) => onChange({ audioVolume: Number(e.target.value) })}
            className="w-full"
          />
        </label>
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        🎬 Ce bloc est le fond vidéo du template.<br />
        La source et la bibliothèque se configurent dans l&apos;onglet <strong>Séquence</strong>.
      </p>
    </Section>
  );
}

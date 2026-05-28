import { Film, ArrowRight } from "lucide-react";
import type { VideoBlock } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
import { useBuilderStore } from "@/lib/store/builderStore";
import { Section } from "./Section";

export function VideoBlockPropertiesPanel({
  block,
  onChange,
}: {
  block: VideoBlock;
  onChange: (c: Partial<VideoBlock>) => void;
}) {
  const selectSlot = useBuilderStore((s) => s.selectSlot);
  const slots = useBuilderStore((s) => s.template.videoSequence ?? []);

  // Recherche du slot associé à ce VideoBlock : soit par videoBlockId
  // explicite, soit par binding partagé (slot.binding === block.binding).
  const blockBinding = (block as { binding?: string }).binding;
  const linkedSlot = slots.find(
    (s) => s.videoBlockId === block.id || (blockBinding && s.binding === blockBinding),
  );

  function openSequence() {
    if (linkedSlot) selectSlot(linkedSlot.id);
    // BuilderClient écoute cet event pour basculer activePanel → "sequence"
    // (évite un prop drilling de setActivePanel sur 3 niveaux).
    window.dispatchEvent(new CustomEvent("builder:open-sequence-panel"));
  }

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

        {/* Bridge vers le panneau Séquence — remplace l'ancienne phrase
            "la source se configure dans l'onglet Séquence" par une action
            directe qui ouvre le panneau et scrolle au bon slot. */}
        <button
          type="button"
          onClick={openSequence}
          className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 mt-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Film size={13} className="text-indigo-600 shrink-0" />
            <span className="text-xs font-medium text-indigo-900 truncate">
              {linkedSlot
                ? `Source : ${linkedSlot.label || "Clip sans nom"}`
                : "Configurer la source vidéo"}
            </span>
          </span>
          <ArrowRight size={12} className="text-indigo-600 shrink-0" />
        </button>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          La source (fichier / bibliothèque / clip de séquence) se configure
          dans le panneau Séquence.
        </p>
      </div>
    </Section>
  );
}

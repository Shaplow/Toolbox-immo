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
  // Zustand v5 : useStore n'applique pas d'égalité shallow, donc un selector
  // ne doit JAMAIS retourner une référence fraîche. Le `?? []` fabriquerait un
  // tableau neuf à chaque snapshot quand videoSequence est undefined (cas
  // template neuve non normalisée) → boucle de re-render infinie = React #185.
  // On sélectionne la valeur brute (réf stable) et on applique le default ici.
  const videoSequence = useBuilderStore((s) => s.template.videoSequence);
  const slots = videoSequence ?? [];

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
          <span className="text-xs font-medium text-muted-foreground">Redimensionnement</span>
          <select
            value={block.fit ?? "cover"}
            onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
            className="border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
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
          <span className="text-xs font-medium text-muted-foreground">Couleur placeholder (builder)</span>
          <input
            type="color"
            value={block.placeholderColor ?? "#111827"}
            onChange={(e) => onChange({ placeholderColor: e.target.value })}
            className="h-8 w-full border border-border rounded-lg cursor-pointer"
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Durée minimale (s)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={block.minDuration ?? ""}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
              onChange({ minDuration: v });
            }}
            className="border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500 w-full"
          />
          <span className="text-[10px] text-muted-foreground leading-relaxed">
            Si défini, seuls les assets d&apos;au moins cette durée sont sélectionnés (auto et manuel).
          </span>
        </label>

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
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          La source (fichier / bibliothèque / clip de séquence) se configure
          dans le panneau Séquence.
        </p>
      </div>
    </Section>
  );
}

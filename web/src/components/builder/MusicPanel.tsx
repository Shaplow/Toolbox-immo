"use client";

import { useEffect, useState } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { MusicBlock, AnyBlock } from "@/types/template";
import { SelectionRuleEditor } from "@/components/builder/shared/SelectionRuleEditor";

/**
 * Panneau "Musique" du builder.
 *
 * Extrait depuis VideoSequencePanel pour donner à l'audio sa propre surface,
 * cohérente avec Cover et Captions (un onglet par chaîne de production).
 *
 * Source : MusicBlock unique dans template.blocks (le builder n'en autorise
 * qu'un). Si absent, état vide explicite — pas d'ajout depuis ce panneau
 * (le MusicBlock est créé via le canvas/layers comme tout autre block).
 */
export function MusicPanel() {
  const { template, updateBlock } = useBuilderStore();
  const musicBlock = template.blocks.find((b): b is MusicBlock => b.type === "music");
  const schema = template.schema ?? [];

  const [audioLibraries, setAudioLibraries] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/libraries/media?type=audio")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then(setAudioLibraries)
      .catch(() => {});
  }, []);

  if (!musicBlock) {
    return (
      <div className="flex flex-col h-full overflow-y-auto text-xs">
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-[11px] font-semibold text-gray-700">Musique</p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
            Source audio appliquée au rendu vidéo final.
          </p>
        </div>
        <div className="px-3 py-6 text-[11px] text-gray-400 italic text-center">
          Aucun bloc musique dans ce template.
          <br />
          Ajoute un bloc &laquo; Musique &raquo; depuis le panneau Calques.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[11px] font-semibold text-gray-700">Musique</p>
        <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
          Source audio, volume et fades appliqués au rendu vidéo final.
        </p>
      </div>

      <div className="px-3 py-3 flex flex-col gap-3">
        {/* Library */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">Bibliothèque audio</span>
          <select
            value={musicBlock.libraryId ?? ""}
            onChange={(e) =>
              updateBlock(musicBlock.id, { libraryId: e.target.value || undefined } as Partial<AnyBlock>)
            }
            className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] bg-white"
          >
            <option value="">— Formulaire (upload à la génération) —</option>
            {audioLibraries.map((lib) => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>
        </div>

        {/* Selection rule */}
        {musicBlock.libraryId && (
          <div>
            <span className="text-[9px] text-gray-400 uppercase tracking-wide block mb-1">À la génération</span>
            <SelectionRuleEditor
              rule={musicBlock.audioSelectionRule}
              onChange={(r) =>
                updateBlock(musicBlock.id, { audioSelectionRule: r } as Partial<AnyBlock>)
              }
              strategies={[
                { value: "oldest_used", label: "La plus ancienne" },
                { value: "least_used", label: "Moins utilisée" },
                { value: "random", label: "Aléatoire" },
                { value: "manual", label: "Manuelle" },
              ]}
              schema={schema}
            />
          </div>
        )}

        {/* Volume + loop */}
        <div className="flex items-center gap-3">
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="flex justify-between text-[9px] text-gray-400">
              <span>Volume</span>
              <span>{Math.round((musicBlock.volume ?? 0.3) * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05}
              value={musicBlock.volume ?? 0.3}
              onChange={(e) =>
                updateBlock(musicBlock.id, { volume: Number(e.target.value) } as Partial<AnyBlock>)
              }
              className="w-full"
            />
          </div>
          <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={musicBlock.loop ?? false}
              onChange={(e) =>
                updateBlock(musicBlock.id, { loop: e.target.checked } as Partial<AnyBlock>)
              }
              className="rounded"
            />
            <span className="text-[10px] text-gray-500">Loop</span>
          </label>
        </div>

        {/* Fade in / out */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-gray-400 uppercase">Fade in (s)</span>
            <input
              type="number" min={0} step={0.5}
              value={musicBlock.fadeIn ?? 0}
              onChange={(e) =>
                updateBlock(musicBlock.id, { fadeIn: Number(e.target.value) } as Partial<AnyBlock>)
              }
              className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-gray-400 uppercase">Fade out (s)</span>
            <input
              type="number" min={0} step={0.5}
              value={musicBlock.fadeOut ?? 0}
              onChange={(e) =>
                updateBlock(musicBlock.id, { fadeOut: Number(e.target.value) } as Partial<AnyBlock>)
              }
              className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
            />
          </label>
        </div>

        {/* Durée minimale */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">Durée minimale (s)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={musicBlock.minDuration ?? ""}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
              updateBlock(musicBlock.id, { minDuration: v } as Partial<AnyBlock>);
            }}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
          />
          <span className="text-[9px] text-gray-400 leading-snug">
            Si défini, seuls les assets d&apos;au moins cette durée sont sélectionnés.
          </span>
        </div>
      </div>
    </div>
  );
}

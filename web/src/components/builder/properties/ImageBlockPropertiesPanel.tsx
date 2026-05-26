"use client";

import { useRef, useState } from "react";
import type { ImageBlock } from "@/types/template";
import { Slider } from "@/components/ui/Slider";
import { Section } from "./Section";

export function ImageBlockPropertiesPanel({
  block,
  onChange,
}: {
  block: ImageBlock;
  onChange: (c: Partial<ImageBlock>) => void;
}) {
  const staticInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleStaticUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) onChange({ staticSrc: data.url });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Section label="Options image">
      {/* Image statique (logo, fond fixe) */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600">Image statique (logo, fond…)</p>
        <input
          ref={staticInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleStaticUpload(f);
            e.target.value = "";
          }}
        />
        {block.staticSrc ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.staticSrc} alt="" className="h-10 w-10 object-contain rounded border border-gray-200 bg-white shrink-0" />
            <span className="text-[10px] text-gray-500 flex-1 truncate">{block.staticSrc.split("/").pop()}</span>
            <button
              type="button"
              onClick={() => onChange({ staticSrc: undefined })}
              className="text-[10px] text-red-400 hover:text-red-600 shrink-0"
              title="Retirer l'image statique"
            >✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-xs py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Upload…" : "+ Télécharger une image"}
          </button>
        )}
        {block.staticSrc && (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Remplacer
          </button>
        )}
        <p className="text-[9px] text-gray-400 leading-relaxed">
          Si renseigné, cette image est toujours affichée (ignore le binding).
        </p>
      </div>

      <div className="space-y-3 mt-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">Ajustement</span>
          <select
            value={block.fit}
            onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
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
      </div>
    </Section>
  );
}

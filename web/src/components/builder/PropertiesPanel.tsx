"use client";

import { useRef, useState } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type {
  AnyBlock, TextBlock, ImageBlock, VideoBlock, DPEBlock,
  ShapeBlock, ShapeKind, BlockStyle, TextRules, SchemaField,
} from "@/types/template";

export function PropertiesPanel() {
  const { template, selectedBlockId, updateBlock, updateTheme, setSchema } = useBuilderStore();
  const block = template.blocks.find((b) => b.id === selectedBlockId) ?? null;

  // Font manager state
  const [uploadingFont, setUploadingFont] = useState(false);
  const [newFontName, setNewFontName] = useState("");
  const fontFileRef = useRef<HTMLInputElement>(null);
  const prevBindingRef = useRef<string>("");
  // Track old content on focus for schema cleanup on blur
  const prevContentRef = useRef<string>("");

  /** Extract {{variable}} keys from a content string */
  function extractVars(s: string): string[] {
    return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  }

  /** Extract condition fields from {{#if field == value}} blocks */
  function extractConditionFields(s: string): { field: string; values: string[] }[] {
    const map = new Map<string, Set<string>>();
    for (const [, field, value] of s.matchAll(/\{\{#if\s+(\w+)\s*==\s*"?([^"\}\s]+)"?\s*\}\}/g)) {
      if (!map.has(field)) map.set(field, new Set());
      map.get(field)!.add(value);
    }
    return [...map.entries()].map(([field, vals]) => ({ field, values: [...vals] }));
  }

  /** Upload a font file and add it to customFonts */
  async function handleFontFileUpload(file: File) {
    setUploadingFont(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/font", { method: "POST", body: fd });
      const data = await res.json() as { url?: string };
      if (data.url) {
        const family = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
        const existing = template.theme.customFonts ?? [];
        if (!existing.some((f) => f.family === family)) {
          updateTheme({ customFonts: [...existing, { family, url: data.url }] } as never);
        }
      }
    } finally {
      setUploadingFont(false);
    }
  }

  /** Add a Google Font by name */
  function handleAddGoogleFont() {
    const family = newFontName.trim();
    if (!family) return;
    const existing = template.theme.customFonts ?? [];
    if (!existing.some((f) => f.family === family)) {
      updateTheme({ customFonts: [...existing, { family }] } as never);
    }
    setNewFontName("");
  }

  function handleRemoveFont(family: string) {
    const next = (template.theme.customFonts ?? []).filter((f) => f.family !== family);
    updateTheme({ customFonts: next } as never);
  }

  if (!block) {
    const fonts = template.theme.customFonts ?? [];
    return (
      <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 text-center">
            Sélectionnez un bloc pour éditer ses propriétés
          </p>
        </div>

        {/* Font manager */}
        <div className="p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Polices disponibles ({fonts.length})
          </p>

          {/* Font list */}
          <div className="space-y-1.5 mb-4">
            {fonts.length === 0 && (
              <p className="text-[10px] text-gray-400 text-center py-3">
                Aucune police. Ajoutez-en ci-dessous.
              </p>
            )}
            {fonts.map((f) => (
              <div
                key={f.family}
                className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate" style={{ fontFamily: f.family }}>
                    {f.family}
                  </p>
                  {f.url && (
                    <p className="text-[9px] text-emerald-600 truncate">✓ Fichier local</p>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveFont(f.family)}
                  className="shrink-0 ml-2 text-gray-300 hover:text-red-400 transition-colors text-sm"
                  title="Supprimer cette police"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Add Google Font */}
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Ajouter une police</p>
            <div className="flex gap-1">
              <input
                type="text"
                value={newFontName}
                onChange={(e) => setNewFontName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddGoogleFont()}
                placeholder="ex: Roboto"
                className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                onClick={handleAddGoogleFont}
                disabled={!newFontName.trim()}
                className="shrink-0 px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                +
              </button>
            </div>
            <p className="text-[9px] text-gray-400">
              Depuis Google Fonts — ou importez un fichier :
            </p>
            <input
              ref={fontFileRef}
              type="file"
              accept=".woff,.woff2,.ttf,.otf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFontFileUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fontFileRef.current?.click()}
              disabled={uploadingFont}
              className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {uploadingFont ? "⏳ Chargement…" : "📁 Importer un fichier (.woff2, .ttf…)"}
            </button>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {block.type} <span className="text-gray-300 font-normal">#{block.id.slice(-4)}</span>
        </p>
        <button
          onClick={() => updateBlock(block.id, { locked: !block.locked } as Partial<AnyBlock>)}
          title={block.locked ? "Déverrouiller le bloc" : "Verrouiller le bloc"}
          className={`shrink-0 text-sm px-1.5 py-0.5 rounded border transition-colors ${
            block.locked
              ? "bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100"
              : "bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
          }`}
        >
          {block.locked ? "🔒" : "🔓"}
        </button>
      </div>

      <div className="p-4 space-y-5 text-xs">
        {/* Position & taille */}
        <Section label="Position / Taille">
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y", "w", "h", "z"] as const).map((field) => (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-gray-400 uppercase">{field}</span>
                <input
                  type="number"
                  value={(block as unknown as Record<string, number>)[field]}
                  onChange={(e) => updateBlock(block.id, { [field]: Number(e.target.value) } as Partial<AnyBlock>)}
                  className="border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </label>
            ))}
            {/* Rotation */}
            <label className="flex flex-col gap-0.5 col-span-2">
              <span className="text-gray-400 uppercase">Rotation (°)</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={block.rotation ?? 0}
                  onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={block.rotation ?? 0}
                  onChange={(e) => updateBlock(block.id, { rotation: Number(e.target.value) || undefined } as Partial<AnyBlock>)}
                  className="w-16 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </label>
          </div>
        </Section>

        {/* Alignment to canvas */}
        <Section label="Aligner sur le canvas">
          <div className="flex flex-col gap-1.5">
            {/* Horizontal */}
            <div className="flex gap-1">
              {([
                { title: "Aligner à gauche",        label: "⇤",  fn: () => ({ x: 0 }) },
                { title: "Centrer horizontalement", label: "↔",  fn: () => ({ x: Math.round((template.canvas.width  - block.w) / 2) }) },
                { title: "Aligner à droite",        label: "⇥",  fn: () => ({ x: template.canvas.width  - block.w }) },
              ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
                <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                  className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                  {label}
                </button>
              ))}
            </div>
            {/* Vertical */}
            <div className="flex gap-1">
              {([
                { title: "Aligner en haut",        label: "⇡",  fn: () => ({ y: 0 }) },
                { title: "Centrer verticalement",  label: "↕",  fn: () => ({ y: Math.round((template.canvas.height - block.h) / 2) }) },
                { title: "Aligner en bas",         label: "⇣",  fn: () => ({ y: template.canvas.height - block.h }) },
              ] as { title: string; label: string; fn: () => Partial<AnyBlock> }[]).map(({ title, label, fn }) => (
                <button key={title} type="button" title={title} onClick={() => updateBlock(block.id, fn())}
                  className="flex-1 py-1.5 rounded border border-gray-200 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Content (text blocks) — template string with {{variable}} interpolation */}
        {block.type === "text" && (() => {
          const tb = block as TextBlock;
          // Migrate: if block still uses old staticText/binding, seed content
          const currentContent = tb.content ?? (tb.binding ? `{{${tb.binding}}}` : tb.staticText ?? "");
          return (
            <Section label="Contenu">
              <textarea
                rows={3}
                value={currentContent}
                onChange={(e) => updateBlock(block.id, { content: e.target.value } as never)}
                onFocus={() => { prevContentRef.current = currentContent; }}
                onBlur={(e) => {
                  const newContent = e.target.value;
                  const oldVars = extractVars(prevContentRef.current);
                  const newVars = extractVars(newContent);
                  const newCondVars = extractConditionFields(newContent);
                  let nextSchema = [...template.schema];

                  // Remove vars no longer present and not used by other blocks
                  for (const key of oldVars) {
                    if (!newVars.includes(key)) {
                      const usedElsewhere = template.blocks.some((b) => {
                        if (b.id === block.id) return false;
                        if (b.binding === key) return true;
                        return (b as TextBlock).content?.includes(`{{${key}}}`) ?? false;
                      });
                      if (!usedElsewhere) nextSchema = nextSchema.filter((f) => f.key !== key);
                    }
                  }
                  // Add new {{variable}} vars not yet in schema
                  for (const key of newVars) {
                    if (!nextSchema.some((f) => f.key === key)) {
                      nextSchema.push({ key, label: key.replace(/_/g, " "), type: "text", required: false });
                    }
                  }
                  // Add {{#if field == value}} condition fields as select
                  for (const { field, values } of newCondVars) {
                    const existing = nextSchema.find((f) => f.key === field);
                    if (!existing) {
                      nextSchema.push({
                        key: field,
                        label: field.replace(/_/g, " "),
                        type: "select",
                        required: false,
                        options: values,
                        description: "Champ conditionnel",
                      });
                    } else if (existing.type === "select" && existing.options) {
                      // Merge new values into existing options
                      const merged = [...new Set([...existing.options, ...values])];
                      nextSchema = nextSchema.map((f) => f.key === field ? { ...f, options: merged } : f);
                    }
                  }
                  setSchema(nextSchema);
                }}
                placeholder={`Texte libre avec variables :\n{{prix}} \u20ac · Surface : {{surface}} m\u00b2\n\nConditionnel :\n{{#if is_copro == oui}} - Nbre lots : {{nbre_lots}}{{/if}}`}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                <code className="bg-gray-100 px-0.5 rounded">{`{{variable}}`}</code> pour insérer une valeur.{" "}
                <code className="bg-gray-100 px-0.5 rounded">{`{{#if champ == val}}...{{/if}}`}</code> pour un segment conditionnel.{" "}
                Les séparateurs <code className="bg-gray-100 px-0.5 rounded"> - </code> en trop sont supprimés automatiquement.
              </p>
              {/* Per-variable required toggles */}
              {extractVars(currentContent).map((key) => {
                const sf = template.schema.find((f) => f.key === key);
                if (!sf) return null;
                return (
                  <label key={key} className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sf.required}
                      onChange={(e) => setSchema(template.schema.map((f) =>
                        f.key === key ? { ...f, required: e.target.checked } : f
                      ))}
                      className="rounded"
                    />
                    <code className="text-[11px] text-indigo-700 bg-indigo-50 px-1 rounded">{`{{${key}}}`}</code>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                      sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                    }`}>{sf.required ? "*" : "opt"}</span>
                  </label>
                );
              })}
            </Section>
          );
        })()}

        {/* Binding — only for image / dpe / shape blocks */}
        {block.type !== "text" && (
          <Section label="Binding (variable)">
            <input
              type="text"
              value={block.binding ?? ""}
              onChange={(e) => updateBlock(block.id, { binding: e.target.value || undefined })}
              onFocus={() => { prevBindingRef.current = block.binding ?? ""; }}
              onBlur={(e) => {
                const newKey = e.target.value.trim();
                const oldKey = prevBindingRef.current.trim();

                // Nothing changed
                if (newKey === oldKey) return;

                let nextSchema = [...template.schema];

                // Remove the old key if no OTHER block still uses it
                if (oldKey) {
                  const stillUsed = template.blocks.some(
                    (b) => b.id !== block.id && b.binding === oldKey
                  );
                  if (!stillUsed) {
                    nextSchema = nextSchema.filter((f) => f.key !== oldKey);
                  }
                }

                // Add new key if non-empty and not already in schema
                if (newKey && !nextSchema.some((f) => f.key === newKey)) {
                  const inferredType: SchemaField["type"] =
                    block.type === "image" ? "image" :
                    block.type === "video" ? "video" : "text";
                  nextSchema.push({
                    key: newKey,
                    label: newKey.replace(/_/g, " "),
                    type: inferredType,
                    required: false,
                  });
                }

                setSchema(nextSchema);
              }}
              placeholder="ex: price_eur"
              className="w-full border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            {/* Inline required toggle for this binding */}
            {block.binding && (() => {
              const sf = template.schema.find((f) => f.key === block.binding);
              if (!sf) return (
                <p className="text-[10px] text-indigo-600 mt-1">
                  Sauvegardez le champ pour l’ajouter au schéma.
                </p>
              );
              return (
                <label className="flex items-center gap-1.5 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sf.required}
                    onChange={(e) => {
                      const next = template.schema.map((f) =>
                        f.key === block.binding ? { ...f, required: e.target.checked } : f
                      );
                      setSchema(next);
                    }}
                    className="rounded"
                  />
                  <span className="text-gray-600 text-[11px]">Obligatoire dans le formulaire</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                    sf.required ? "bg-red-50 text-red-400" : "bg-gray-100 text-gray-400"
                  }`}>
                    {sf.required ? "*" : "optionnel"}
                  </span>
                </label>
              );
            })()}
          </Section>
        )}

        {/* Text specific */}
        {block.type === "text" && (
          <TextProps block={block as TextBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Shape specific */}
        {block.type === "shape" && (
          <ShapeProps block={block as ShapeBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Image specific */}
        {block.type === "image" && (
          <ImageProps block={block as ImageBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Vidéo specific */}
        {block.type === "video" && (
          <VideoProps block={block as VideoBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* DPE specific */}
        {block.type === "dpe" && (
          <DPEProps block={block as DPEBlock} onChange={(c) => updateBlock(block.id, c)} />
        )}

        {/* Condition d'affichage — tous types */}
        <ShowIfSection block={block} onChange={(c) => updateBlock(block.id, c as Partial<DPEBlock>)} />
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      {children}
    </div>
  );
}

function StyleEditor({
  style,
  onChange,
}: {
  style: BlockStyle;
  onChange: (s: Partial<BlockStyle>) => void;
}) {
  const { template } = useBuilderStore();
  const availableFonts = template.theme.customFonts ?? [];
  const fontListId = "builder-font-list";

  return (
    <div className="space-y-2">
      {/* Font family picker */}
      <datalist id={fontListId}>
        {availableFonts.map((f) => (
          <option key={f.family} value={f.family} />
        ))}
      </datalist>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Police</span>
        <input
          type="text"
          list={fontListId}
          value={style.fontFamily ?? ""}
          onChange={(e) => onChange({ fontFamily: e.target.value || undefined })}
          placeholder="ex: Montserrat"
          className="border border-gray-200 rounded px-2 py-1"
          style={{ fontFamily: style.fontFamily }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Taille (pt)</span>
          <input type="number" value={style.fontSize ?? 14}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="border border-gray-200 rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Font weight</span>
          <select value={style.fontWeight ?? 400}
            onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
            className="border border-gray-200 rounded px-2 py-1"
          >
            {[300,400,500,600,700].map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Couleur texte</span>
          <input type="color" value={style.color ?? "#000000"}
            onChange={(e) => onChange({ color: e.target.value })}
            className="w-full h-7 cursor-pointer rounded border border-gray-200"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Fond</span>
          <input type="color" value={style.backgroundColor ?? "#FFFFFF"}
            onChange={(e) => onChange({ backgroundColor: e.target.value })}
            className="w-full h-7 cursor-pointer rounded border border-gray-200"
          />
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Padding</span>
        <input type="number" value={style.padding ?? 0}
          onChange={(e) => onChange({ padding: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Border radius</span>
        <input type="number" value={style.borderRadius ?? 0}
          onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Alignement vertical</span>
        <div className="flex gap-1">
          {(["top", "middle", "bottom"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange({ verticalAlign: v })}
              title={v === "top" ? "Haut" : v === "middle" ? "Milieu" : "Bas"}
              className={`flex-1 py-1 rounded border text-xs transition-colors ${
                (style.verticalAlign ?? "top") === v
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-gray-200 text-gray-500 hover:border-indigo-300"
              }`}
            >
              {v === "top" ? "↑" : v === "middle" ? "↕" : "↓"}
            </button>
          ))}
        </div>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Alignement horizontal</span>
        <select value={style.textAlign ?? "left"}
          onChange={(e) => onChange({ textAlign: e.target.value as BlockStyle["textAlign"] })}
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="left">Gauche</option>
          <option value="center">Centre</option>
          <option value="right">Droite</option>
        </select>
      </label>
    </div>
  );
}

function TextProps({ block, onChange }: { block: TextBlock; onChange: (c: Partial<TextBlock>) => void }) {
  return (
    <>
      <Section label="Style">
        <StyleEditor style={block.style}
          onChange={(s) => onChange({ style: { ...block.style, ...s } })} />
      </Section>
      <Section label="Règles texte">
        <div className="space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Max lignes</span>
            <input type="number" min={1} value={block.rules.maxLines ?? ""}
              onChange={(e) => onChange({ rules: { ...block.rules, maxLines: e.target.value ? Number(e.target.value) : undefined } })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.shrinkToFit}
              onChange={(e) => onChange({ rules: { ...block.rules, shrinkToFit: e.target.checked } })} />
            <span className="text-gray-600">Shrink to fit</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!block.rules.uppercase}
              onChange={(e) => onChange({ rules: { ...block.rules, uppercase: e.target.checked } })} />
            <span className="text-gray-600">Majuscules</span>
          </label>
        </div>
      </Section>
    </>
  );
}

function ShapeProps({ block, onChange }: { block: ShapeBlock; onChange: (c: Partial<ShapeBlock>) => void }) {
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

function ImageProps({ block, onChange }: { block: ImageBlock; onChange: (c: Partial<ImageBlock>) => void }) {
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
      <div className="mb-3">
        <p className="text-gray-400 mb-1">Image statique (logo, fond…)</p>
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
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.staticSrc} alt="" className="h-10 w-10 object-contain rounded border border-gray-200 bg-gray-50" />
            <span className="text-[10px] text-gray-500 flex-1 truncate">{block.staticSrc.split("/").pop()}</span>
            <button
              type="button"
              onClick={() => onChange({ staticSrc: undefined })}
              className="text-[10px] text-red-400 hover:text-red-600"
              title="Retirer l'image statique"
            >✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="w-full text-xs py-1.5 border border-dashed border-gray-300 rounded text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Upload…" : "+ Télécharger une image"}
          </button>
        )}
        {block.staticSrc && (
          <button
            type="button"
            onClick={() => staticInputRef.current?.click()}
            disabled={uploading}
            className="mt-1 w-full text-[10px] text-gray-400 hover:text-gray-600"
          >
            Remplacer
          </button>
        )}
        <p className="text-[9px] text-gray-300 mt-1">
          Si renseigné, cette image est toujours affichée (ignore le binding).
        </p>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Ajustement</span>
        <select value={block.fit}
          onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}
          className="border border-gray-200 rounded px-2 py-1"
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5 mt-2">
        <span className="text-gray-400">Border radius</span>
        <input type="number" value={block.borderRadius ?? 0}
          onChange={(e) => onChange({ borderRadius: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
    </Section>
  );
}

function VideoProps({ block, onChange }: { block: VideoBlock; onChange: (c: Partial<VideoBlock>) => void }) {
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
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        🎬 Ce bloc déclenche le pipeline RunPod.<br />
        La vidéo sera composite via FFmpeg avec le template en overlay PNG.
      </p>
    </Section>
  );
}

function DPEProps({ block, onChange }: { block: DPEBlock; onChange: (c: Partial<DPEBlock>) => void }) {
  return (
    <Section label="Diagramme">
      <div className="flex gap-1">
        {(["energy", "climate"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange({ variant: v, w: v === "climate" ? 243 : 350 })}
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
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        Les valeurs sont saisies lors de la génération.<br/>
        Clés fixes : <span className="font-mono">dpe_note</span>, <span className="font-mono">dpe_valeur</span>, <span className="font-mono">ges_note</span>, <span className="font-mono">ges_valeur</span>.
      </p>
    </Section>
  );
}

function ShowIfSection({ block, onChange }: { block: AnyBlock; onChange: (c: Partial<AnyBlock>) => void }) {
  const showIf = block.showIf;
  const hasCondition = !!showIf;
  return (
    <Section label="Condition d'affichage">
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasCondition}
            onChange={(e) => {
              if (e.target.checked) onChange({ showIf: { field: "", equals: "" } } as Partial<AnyBlock>);
              else onChange({ showIf: undefined } as Partial<AnyBlock>);
            }}
          />
          <span className="text-gray-600 text-xs">Affichage conditionnel</span>
        </label>
        {hasCondition && showIf && (
          <div className="space-y-1.5 pl-1">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 text-[11px]">Champ</span>
              <input
                type="text"
                value={showIf.field}
                onChange={(e) => onChange({ showIf: { ...showIf, field: e.target.value } } as Partial<AnyBlock>)}
                placeholder="ex: bandeau"
                className="border border-gray-200 rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-400 text-[11px]">Valeur attendue</span>
              <input
                type="text"
                value={showIf.equals}
                onChange={(e) => onChange({ showIf: { ...showIf, equals: e.target.value } } as Partial<AnyBlock>)}
                placeholder="ex: vendu"
                className="border border-gray-200 rounded px-2 py-1 text-xs"
              />
            </label>
            <p className="text-[9px] text-gray-400 leading-relaxed">
              Ce bloc s&apos;affiche seulement si{" "}
              <code className="bg-gray-100 px-0.5 rounded">
                {showIf.field || "champ"} = {showIf.equals || "valeur"}
              </code>
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

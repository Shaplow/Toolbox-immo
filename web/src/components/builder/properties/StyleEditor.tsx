"use client";

import { collectBuilderFonts, type BuilderFontEntry } from "@/lib/builderFonts";
import {
  getTextBackgroundBorderRadius,
  getTextBackgroundMode,
  getTextBackgroundPadding,
  getTextBackgroundSize,
  getTextContentPadding,
  isTextBackgroundEnabled,
  type BoxPadding,
} from "@/lib/textBackground";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { BlockStyle } from "@/types/template";
import { BoxPaddingEditor } from "./BoxPaddingEditor";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { toUniformPaddingValue } from "./utils";

export function StyleEditor({
  style,
  globalFonts,
  backgroundDefaults,
  onChange,
}: {
  style: BlockStyle;
  globalFonts: BuilderFontEntry[];
  backgroundDefaults?: { width: number; height: number };
  onChange: (s: Partial<BlockStyle>) => void;
}) {
  const { template } = useBuilderStore();
  const availableFonts = collectBuilderFonts(template, globalFonts);
  const backgroundEnabled = isTextBackgroundEnabled(style);
  const backgroundMode = getTextBackgroundMode(style);
  const backgroundSize = getTextBackgroundSize(
    style,
    backgroundDefaults?.width ?? 200,
    backgroundDefaults?.height ?? 60
  );
  const textPadding = getTextContentPadding(style);
  const backgroundPadding = getTextBackgroundPadding(style);
  const textPaddingSplit = style.padding === undefined && (
    style.paddingTop !== undefined ||
    style.paddingRight !== undefined ||
    style.paddingBottom !== undefined ||
    style.paddingLeft !== undefined
  );
  const backgroundPaddingSplit = style.textBackgroundPadding === undefined && (
    style.textBackgroundPaddingTop !== undefined ||
    style.textBackgroundPaddingRight !== undefined ||
    style.textBackgroundPaddingBottom !== undefined ||
    style.textBackgroundPaddingLeft !== undefined
  );
  const backgroundRadius = getTextBackgroundBorderRadius(style);

  function updateTextPaddingUniform(value: number) {
    onChange({
      padding: value,
      paddingTop: undefined,
      paddingRight: undefined,
      paddingBottom: undefined,
      paddingLeft: undefined,
    });
  }

  function updateTextPaddingSide(side: keyof BoxPadding, value: number) {
    onChange({
      padding: undefined,
      ...(side === "top" ? { paddingTop: value } : {}),
      ...(side === "right" ? { paddingRight: value } : {}),
      ...(side === "bottom" ? { paddingBottom: value } : {}),
      ...(side === "left" ? { paddingLeft: value } : {}),
    });
  }

  function updateBackgroundPaddingUniform(value: number) {
    onChange({
      textBackgroundPadding: value,
      textBackgroundPaddingTop: undefined,
      textBackgroundPaddingRight: undefined,
      textBackgroundPaddingBottom: undefined,
      textBackgroundPaddingLeft: undefined,
    });
  }

  function updateBackgroundPaddingSide(side: keyof BoxPadding, value: number) {
    onChange({
      textBackgroundPadding: undefined,
      ...(side === "top" ? { textBackgroundPaddingTop: value } : {}),
      ...(side === "right" ? { textBackgroundPaddingRight: value } : {}),
      ...(side === "bottom" ? { textBackgroundPaddingBottom: value } : {}),
      ...(side === "left" ? { textBackgroundPaddingLeft: value } : {}),
    });
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Police</span>
        <FontFamilyPicker
          value={style.fontFamily}
          fonts={availableFonts}
          onChange={(fontFamily) => onChange({ fontFamily })}
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
          <div className="flex items-center gap-1">
            <select value={style.fontWeight ?? 400}
              onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
              className="flex-1 border border-gray-200 rounded px-2 py-1"
            >
              {[300,400,500,600,700].map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <button
              type="button"
              title="Italique"
              onClick={() => onChange({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" })}
              className={`h-7 w-7 rounded flex items-center justify-center border text-sm font-bold italic shrink-0 ${
                style.fontStyle === "italic"
                  ? "bg-indigo-100 border-indigo-400 text-indigo-700"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              I
            </button>
          </div>
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400">Espacement lettres</span>
        <input
          type="number"
          step={0.1}
          value={style.letterSpacing ?? 0}
          onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
          className="border border-gray-200 rounded px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-2 rounded border border-gray-200 px-2 py-2">
        <input
          type="checkbox"
          checked={style.textShadowEnabled ?? false}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({
                textShadowEnabled: true,
                textShadowColor: style.textShadowColor ?? "#000000",
                textShadowOpacity: style.textShadowOpacity ?? 0.35,
                textShadowBlur: style.textShadowBlur ?? 6,
                textShadowDistance: style.textShadowDistance ?? 4,
                textShadowAngle: style.textShadowAngle ?? 90,
              });
              return;
            }

            onChange({
              textShadowEnabled: false,
              textShadowColor: undefined,
              textShadowOpacity: undefined,
              textShadowBlur: undefined,
              textShadowDistance: undefined,
              textShadowAngle: undefined,
            });
          }}
          className="rounded"
        />
        <span className="text-gray-600">Ombre du texte</span>
      </label>
      {style.textShadowEnabled ? (
        <div className="grid grid-cols-2 gap-2 rounded border border-gray-100 bg-gray-50 p-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Couleur ombre</span>
            <input
              type="color"
              value={style.textShadowColor ?? "#000000"}
              onChange={(e) => onChange({ textShadowColor: e.target.value })}
              className="w-full h-7 cursor-pointer rounded border border-gray-200"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Opacité</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={style.textShadowOpacity ?? 0.35}
              onChange={(e) => onChange({ textShadowOpacity: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Distance</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={style.textShadowDistance ?? 4}
              onChange={(e) => onChange({ textShadowDistance: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Angle</span>
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              value={style.textShadowAngle ?? 90}
              onChange={(e) => onChange({ textShadowAngle: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-0.5 col-span-2">
            <span className="text-gray-400">Flou</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={style.textShadowBlur ?? 6}
              onChange={(e) => onChange({ textShadowBlur: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Couleur texte</span>
          <input type="color" value={style.color ?? "#000000"}
            onChange={(e) => onChange({ color: e.target.value })}
            className="w-full h-7 cursor-pointer rounded border border-gray-200"
          />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-200 px-2 py-2">
          <input
            type="checkbox"
            checked={backgroundEnabled}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({
                  textBackgroundEnabled: true,
                  textBackgroundMode: style.textBackgroundMode ?? "fit",
                  backgroundColor: style.backgroundColor ?? "#FFFFFF",
                  textBackgroundBorderRadius: style.textBackgroundBorderRadius ?? style.borderRadius,
                });
                return;
              }

              onChange({ textBackgroundEnabled: false });
            }}
            className="rounded"
          />
          <span className="text-gray-600">Fond texte</span>
        </label>
      </div>
      {backgroundEnabled ? (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-gray-700">Fond texte</p>
              <p className="text-[10px] text-gray-400">
                {backgroundMode === "fit"
                  ? "Le cartouche suit le texte et respecte son alignement."
                  : backgroundMode === "per-line"
                    ? "Chaque ligne a son propre cartouche ajusté à sa largeur."
                    : "Le cartouche conserve une largeur et une hauteur fixes."}
              </p>
            </div>
            <input type="color" value={style.backgroundColor ?? "#FFFFFF"}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-200 bg-white p-1">
            <button
              type="button"
              onClick={() => onChange({ textBackgroundMode: "fit" })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "fit"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Adaptatif
            </button>
            <button
              type="button"
              onClick={() => onChange({ textBackgroundMode: "per-line" })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "per-line"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Par ligne
            </button>
            <button
              type="button"
              onClick={() => onChange({
                textBackgroundMode: "fixed",
                textBackgroundWidth: style.textBackgroundWidth ?? (backgroundDefaults?.width ?? 200),
                textBackgroundHeight: style.textBackgroundHeight ?? (backgroundDefaults?.height ?? 60),
              })}
              className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                backgroundMode === "fixed"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Fixe
            </button>
          </div>
          {backgroundMode === "fixed" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400">Largeur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.width}
                  onChange={(e) => onChange({ textBackgroundWidth: Number(e.target.value) })}
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-400">Hauteur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.height}
                  onChange={(e) => onChange({ textBackgroundHeight: Number(e.target.value) })}
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 bg-white px-2 py-1.5 text-[10px] text-gray-400 leading-4">
              {backgroundMode === "per-line"
                ? "Chaque ligne obtient son propre fond ajusté. Le padding vertical agit comme espacement entre les lignes."
                : "Le fond suit automatiquement la largeur du texte et s'ancre selon l'alignement horizontal du bloc."}
            </p>
          )}

          <BoxPaddingEditor
            label="Padding du fond"
            values={backgroundPadding}
            split={backgroundPaddingSplit}
            onToggleSplit={(nextSplit) => {
              if (nextSplit) {
                onChange({
                  textBackgroundPadding: undefined,
                  textBackgroundPaddingTop: backgroundPadding.top,
                  textBackgroundPaddingRight: backgroundPadding.right,
                  textBackgroundPaddingBottom: backgroundPadding.bottom,
                  textBackgroundPaddingLeft: backgroundPadding.left,
                });
                return;
              }

              updateBackgroundPaddingUniform(toUniformPaddingValue(backgroundPadding));
            }}
            onChangeUniform={updateBackgroundPaddingUniform}
            onChangeSide={updateBackgroundPaddingSide}
          />

          <label className="flex flex-col gap-0.5">
            <span className="text-gray-400">Arrondi du fond</span>
            <input
              type="number"
              min={0}
              value={backgroundRadius}
              onChange={(e) => onChange({ textBackgroundBorderRadius: Number(e.target.value) })}
              className="border border-gray-200 rounded px-2 py-1"
            />
          </label>
        </div>
      ) : null}
      <BoxPaddingEditor
        label={backgroundEnabled ? "Padding texte" : "Padding texte"}
        values={textPadding}
        split={textPaddingSplit}
        onToggleSplit={(nextSplit) => {
          if (nextSplit) {
            onChange({
              padding: undefined,
              paddingTop: textPadding.top,
              paddingRight: textPadding.right,
              paddingBottom: textPadding.bottom,
              paddingLeft: textPadding.left,
            });
            return;
          }

          updateTextPaddingUniform(toUniformPaddingValue(textPadding));
        }}
        onChangeUniform={updateTextPaddingUniform}
        onChangeSide={updateTextPaddingSide}
      />
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

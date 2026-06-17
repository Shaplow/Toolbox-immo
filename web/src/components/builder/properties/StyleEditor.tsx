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
import { Slider } from "@/components/ui/Slider";
import { ToggleSwitch } from "@/components/builder/shared/ToggleSwitch";
import { BoxPaddingEditor } from "./BoxPaddingEditor";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { toUniformPaddingValue } from "./utils";

/** Reusable section sub-header within StyleEditor */
function SubSection({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1">
      {label}
    </p>
  );
}

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
    <div className="space-y-3">
      {/* ── Typographie ── */}
      <SubSection label="Typographie" />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Police</span>
        <FontFamilyPicker
          value={style.fontFamily}
          fonts={availableFonts}
          onChange={(fontFamily) => onChange({ fontFamily })}
        />
      </label>

      <Slider
        label="Taille (pt)"
        value={style.fontSize ?? 14}
        onChange={(v) => onChange({ fontSize: v })}
        min={10}
        max={200}
        unit="pt"
      />

      {/* Font weight — kept as select; slider step-100 looks odd in practice */}
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-medium text-muted-foreground">Graisse</span>
          <select
            value={style.fontWeight ?? 400}
            onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
            className="border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
          >
            {[300, 400, 500, 600, 700].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          title="Italique"
          onClick={() => onChange({ fontStyle: style.fontStyle === "italic" ? "normal" : "italic" })}
          className={[
            "h-8 w-9 rounded-lg flex items-center justify-center border text-sm font-bold italic shrink-0 transition-colors",
            style.fontStyle === "italic"
              ? "bg-indigo-100 border-indigo-400 text-indigo-700"
              : "border-border text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          I
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Espacement lettres</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={-5}
            max={20}
            step={0.1}
            value={style.letterSpacing ?? 0}
            onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
            className="flex-1 h-1.5 rounded-full appearance-none accent-indigo-600 cursor-pointer"
          />
          <span className="text-xs font-mono text-foreground tabular-nums min-w-[3rem] text-right">
            {(style.letterSpacing ?? 0).toFixed(1)}
          </span>
        </div>
      </label>

      {/* Alignements */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Alignement H</span>
          <select
            value={style.textAlign ?? "left"}
            onChange={(e) => onChange({ textAlign: e.target.value as BlockStyle["textAlign"] })}
            className="border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
          >
            <option value="left">Gauche</option>
            <option value="center">Centre</option>
            <option value="right">Droite</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Alignement V</span>
          <div className="flex gap-1">
            {(["top", "middle", "bottom"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ verticalAlign: v })}
                title={v === "top" ? "Haut" : v === "middle" ? "Milieu" : "Bas"}
                className={[
                  "flex-1 py-1.5 rounded-lg border text-xs transition-colors",
                  (style.verticalAlign ?? "top") === v
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-border text-muted-foreground hover:border-indigo-300",
                ].join(" ")}
              >
                {v === "top" ? "↑" : v === "middle" ? "↕" : "↓"}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* ── Couleurs ── */}
      <SubSection label="Couleurs" />

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Texte</span>
          <input
            type="color"
            value={style.color ?? "#000000"}
            onChange={(e) => onChange({ color: e.target.value })}
            className="h-8 w-full cursor-pointer rounded-lg border border-border"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Fond texte</span>
          <ToggleSwitch
            checked={backgroundEnabled}
            onChange={(checked) => {
              if (checked) {
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
            label=""
          />
        </div>
      </div>

      {backgroundEnabled && (
        <div className="space-y-3 rounded-xl border border-border bg-muted p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-foreground">Fond texte</p>
              <p className="text-[10px] text-muted-foreground">
                {backgroundMode === "fit"
                  ? "Le cartouche suit le texte et respecte son alignement."
                  : backgroundMode === "per-line"
                    ? "Chaque ligne a son propre cartouche ajusté à sa largeur."
                    : "Le cartouche conserve une largeur et une hauteur fixes."}
              </p>
            </div>
            <input
              type="color"
              value={style.backgroundColor ?? "#FFFFFF"}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-white"
            />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-white p-1">
            {(["fit", "per-line", "fixed"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (mode === "fixed") {
                    onChange({
                      textBackgroundMode: "fixed",
                      textBackgroundWidth: style.textBackgroundWidth ?? (backgroundDefaults?.width ?? 200),
                      textBackgroundHeight: style.textBackgroundHeight ?? (backgroundDefaults?.height ?? 60),
                    });
                    return;
                  }
                  onChange({ textBackgroundMode: mode });
                }}
                className={[
                  "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  backgroundMode === mode ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {mode === "fit" ? "Adaptatif" : mode === "per-line" ? "Par ligne" : "Fixe"}
              </button>
            ))}
          </div>
          {backgroundMode === "fixed" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Largeur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.width}
                  onChange={(e) => onChange({ textBackgroundWidth: Number(e.target.value) })}
                  className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Hauteur fond</span>
                <input
                  type="number"
                  min={1}
                  value={backgroundSize.height}
                  onChange={(e) => onChange({ textBackgroundHeight: Number(e.target.value) })}
                  className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </label>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border bg-white px-2 py-1.5 text-[10px] text-muted-foreground leading-4">
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

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Arrondi du fond</span>
            <input
              type="number"
              min={0}
              value={backgroundRadius}
              onChange={(e) => onChange({ textBackgroundBorderRadius: Number(e.target.value) })}
              className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>
        </div>
      )}

      {/* ── Ombre ── */}
      <SubSection label="Ombre" />

      <ToggleSwitch
        checked={style.textShadowEnabled ?? false}
        onChange={(checked) => {
          if (checked) {
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
        label="Ombre du texte"
      />

      {style.textShadowEnabled && (
        <div className="space-y-3 rounded-xl border border-border bg-muted p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Couleur ombre</span>
              <input
                type="color"
                value={style.textShadowColor ?? "#000000"}
                onChange={(e) => onChange({ textShadowColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded-lg border border-border"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Opacité ombre</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={style.textShadowOpacity ?? 0.35}
                onChange={(e) => onChange({ textShadowOpacity: Number(e.target.value) })}
                className="border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </label>
          </div>
          <Slider
            label="Distance"
            value={style.textShadowDistance ?? 4}
            onChange={(v) => onChange({ textShadowDistance: v })}
            min={0}
            max={30}
            step={0.5}
            unit="px"
          />
          <Slider
            label="Angle"
            value={style.textShadowAngle ?? 90}
            onChange={(v) => onChange({ textShadowAngle: v })}
            min={-180}
            max={180}
            unit="°"
          />
          <Slider
            label="Flou"
            value={style.textShadowBlur ?? 6}
            onChange={(v) => onChange({ textShadowBlur: v })}
            min={0}
            max={30}
            step={0.5}
            unit="px"
          />
        </div>
      )}

      {/* ── Espacement ── */}
      <SubSection label="Espacement" />

      <BoxPaddingEditor
        label="Padding texte"
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
    </div>
  );
}

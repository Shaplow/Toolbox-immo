"use client";

/**
 * CoverPresetThumbnail — mini-preview SVG d'un cover preset.
 *
 * Affiche sur un canvas ratio 9:16 (Instagram) :
 * - Background : placeholder gris quadrillé (sera remplacé en Phase 4+ par
 *   une frame extraite du dernier render du template)
 * - Overlay groups sélectionnés : rectangles colorés au bon emplacement
 *   (lus depuis template.canvas + template.blocks via groupId)
 * - Zones d'exclusion : rectangles rouges semi-transparents
 *
 * Réutilisé dans :
 *   - CoverPresetsPanel (cards de la liste presets)
 *   - CoverPresetEditDialog (preview live pendant l'édition)
 *   - CoverConfigEditor (preview du preset sélectionné dans le pattern)
 */

import type { TemplateJSON, AnyBlock } from "@/types/template";

interface ExcludeZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CoverPresetConfigSubset {
  overlayGroupIds?: string[];
  excludeZones?: ExcludeZone[];
  offsetX?: number;
  offsetY?: number;
}

interface Props {
  /** Le template parent (avec ses blocks et son canvas). */
  template: TemplateJSON;
  /** La config du preset à afficher. */
  config: CoverPresetConfigSubset;
  /** Largeur cible du thumbnail en pixels (la hauteur s'ajuste au ratio 9:16). */
  width?: number;
  /** Classes Tailwind additionnelles sur le wrapper. */
  className?: string;
}

export function CoverPresetThumbnail({
  template,
  config,
  width = 96,
  className = "",
}: Props) {
  const canvas = template.canvas;
  if (!canvas) {
    return (
      <div
        className={`bg-gray-100 rounded ${className}`}
        style={{ width, aspectRatio: "9 / 16" }}
      />
    );
  }

  const cw = canvas.width;
  const ch = canvas.height;
  const aspectRatio = cw / ch;
  const height = width / aspectRatio;

  const selectedGroupIds = new Set(config.overlayGroupIds ?? []);
  const offsetX = config.offsetX ?? 0;
  const offsetY = config.offsetY ?? 0;
  const excludeZones = config.excludeZones ?? [];

  // Filtre les blocks qui appartiennent aux groupes sélectionnés (et qui sont visibles)
  const overlayBlocks = (template.blocks ?? []).filter(
    (b: AnyBlock) =>
      !b.hidden &&
      b.groupId !== undefined &&
      selectedGroupIds.has(b.groupId),
  );

  // Couleur unique par groupId (palette stable hash → hue)
  function colorForGroup(groupId: string): string {
    let h = 0;
    for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) & 0xffffff;
    const hue = h % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }

  return (
    <div
      className={`relative bg-gray-200 rounded overflow-hidden border border-gray-300 ${className}`}
      style={{ width, height }}
    >
      {/* Background placeholder : motif quadrillé */}
      <svg
        viewBox={`0 0 ${cw} ${ch}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <defs>
          <pattern id={`grid-${width}`} width="60" height="60" patternUnits="userSpaceOnUse">
            <path
              d="M 60 0 L 0 0 0 60"
              fill="none"
              stroke="rgba(0,0,0,0.06)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={cw} height={ch} fill={`url(#grid-${width})`} />

        {/* Overlay groups (rectangles colorés à l'emplacement des blocks) */}
        {overlayBlocks.map((b) => (
          <rect
            key={b.id}
            x={b.x + offsetX}
            y={b.y + offsetY}
            width={b.w}
            height={b.h}
            fill={colorForGroup(b.groupId!)}
            fillOpacity="0.35"
            stroke={colorForGroup(b.groupId!)}
            strokeWidth="4"
            strokeOpacity="0.7"
            rx="6"
          />
        ))}

        {/* Zones d'exclusion (rectangles rouges semi-transparents) */}
        {excludeZones.map((zone, i) => (
          <g key={i}>
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.w}
              height={zone.h}
              fill="rgba(220, 38, 38, 0.2)"
              stroke="rgba(220, 38, 38, 0.6)"
              strokeWidth="3"
              strokeDasharray="8 4"
              rx="4"
            />
            <text
              x={zone.x + zone.w / 2}
              y={zone.y + zone.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgba(220, 38, 38, 0.9)"
              fontSize="32"
              fontWeight="600"
            >
              ✕
            </text>
          </g>
        ))}
      </svg>

      {/* Badge "vide" si aucun overlay ni zone */}
      {overlayBlocks.length === 0 && excludeZones.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] text-gray-400 font-medium">Aperçu</span>
        </div>
      )}
    </div>
  );
}

// ─── Canvas ────────────────────────────────────────────────────────────────────
export type CanvasFormat =
  | "A3_LANDSCAPE"
  | "A4_PORTRAIT"
  | "IG_1080x1350"
  | "IG_1080x1920";

export const CANVAS_FORMATS: Record<
  CanvasFormat,
  { label: string; width: number; height: number }
> = {
  A3_LANDSCAPE:  { label: "A3 Paysage",       width: 1587, height: 1123 },
  A4_PORTRAIT:   { label: "A4 Portrait",       width: 794,  height: 1123 },
  IG_1080x1350:  { label: "Instagram 4:5",     width: 1080, height: 1350 },
  IG_1080x1920:  { label: "Instagram Stories", width: 1080, height: 1920 },
};

export interface TemplateCanvas {
  format: CanvasFormat;
  width: number;
  height: number;
  dpi: number; // e.g. 300
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  bleed: number; // fond perdu en px
  backgroundColor: string;
}

// ─── Theme ─────────────────────────────────────────────────────────────────────
export interface TemplateTheme {
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    textLight: string;
  };
  fonts: {
    heading: FontConfig;
    body: FontConfig;
  };
  /** Polices partagées disponibles dans tous les blocs texte */
  customFonts?: { family: string; url?: string }[];
  defaultStyles: {
    title: TextStyle;
    body: TextStyle;
    legal: TextStyle;
  };
}

export interface FontConfig {
  family: string;
  fallback: string;
  weights: number[];
  /** URL du fichier police custom uploadé, ex. "/fonts/ma-typo.woff2" */
  url?: string;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  lineHeight: number;
  letterSpacing: number;
}

// ─── Blocks ────────────────────────────────────────────────────────────────────
export type BlockType =
  | "text"
  | "image"
  | "video"
  | "shape"
  | "dpe";

export interface BaseBlock {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation?: number; // degrés, ex: -45 pour le badge VENDU
  locked?: boolean;  // si true : pas de drag/resize accidentel
  binding?: string; // variable name from schema
  animations: AnimationDef[]; // V2 — kept empty in V1
  /** Visibilité conditionnelle : le bloc ne s'affiche que si listing[field] === equals */
  showIf?: { field: string; equals: string };
}

export interface BlockStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  backgroundColor?: string;
  padding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  borderRadius?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  opacity?: number;
}

export interface TextRules {
  maxLines?: number;
  minFontSize?: number;
  shrinkToFit?: boolean;
  ellipsis?: boolean;
  uppercase?: boolean;
}

export interface TextBlock extends BaseBlock {
  type: "text";
  style: BlockStyle;
  rules: TextRules;
  /** Template string with interpolation: "{{prix}} €", "Surface : {{surface}} m²", texte libre.
   *  Supports any mix of static text and {{variable}} tokens. */
  content?: string;
  staticText?: string; // @deprecated: utiliser content à la place
}

export interface ImageBlock extends BaseBlock {
  type: "image";
  fit: "cover" | "contain";
  focalX?: number; // 0–1
  focalY?: number; // 0–1
  borderRadius?: number;
  staticSrc?: string; // URL statique pour logos et images fixes (jamais liées au listing)
}

/**
 * Bloc vidéo : remplace une image par une vidéo dans le template.
 * À la génération, active le pipeline RunPod (FFmpeg composite)
 * au lieu du pipeline Node.js (PNG/PDF direct).
 */
export interface VideoBlock extends BaseBlock {
  type: "video";
  fit: "cover" | "contain";
  borderRadius?: number;
  /** Couleur de fond affichée dans le builder (placeholder) */
  placeholderColor?: string;
}

/**
 * "energy" = diagramme DPE consommation (flèches couleurs)
 * "climate" = diagramme GES émissions CO₂ (capsules bleues)
 *
 * Clés listing utilisées (fixes, pas configurables) :
 *   dpe_note    → lettre énergie A–G
 *   dpe_valeur  → kWh/m²/an
 *   ges_note    → lettre GES A–G
 *   ges_valeur  → kg CO₂/m²/an
 */
export type DPEVariant = "energy" | "climate";

export interface DPEBlock extends BaseBlock {
  type: "dpe";
  variant: DPEVariant;
  style: BlockStyle;
}

// ─── Shape ────────────────────────────────────────────────────────────────────
export type ShapeKind = "rectangle" | "circle" | "triangle" | "diamond";

export interface ShapeBlock extends BaseBlock {
  type: "shape";
  shape: ShapeKind;
  fillColor: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number; // arrondi px (rectangle uniquement)
  opacity?: number;
}

export type AnyBlock =
  | TextBlock
  | ImageBlock
  | VideoBlock
  | ShapeBlock
  | DPEBlock;

// ─── Schema (variables attendues par le template) ──────────────────────────────
export type SchemaFieldType =
  | "text"
  | "number"
  | "image"
  | "video"
  | "select"
  | "boolean"
  | "url";

export interface SchemaField {
  key: string; // ex: "price_eur"
  label: string; // ex: "Prix (€)"
  type: SchemaFieldType;
  required: boolean;
  description?: string; // hint affiché sous le champ dans le formulaire
  options?: string[]; // pour type "select"
  default?: unknown;
  placeholder?: string;
  showIf?: { field: string; equals: string }; // n'affiche ce champ que si un autre champ vaut une certaine valeur
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// ─── Template JSON (structure complète) ────────────────────────────────────────
export interface TemplateJSON {
  canvas: TemplateCanvas;
  theme: TemplateTheme;
  blocks: AnyBlock[];
  schema: SchemaField[];
  timeline?: undefined; // V2 placeholder
}

// ─── V2 Placeholder ────────────────────────────────────────────────────────────
export interface AnimationDef {
  // V2 — empty for now
  type?: never;
}

// ─── Default values ────────────────────────────────────────────────────────────
export function defaultCanvas(format: CanvasFormat): TemplateCanvas {
  const dims = CANVAS_FORMATS[format];
  return {
    format,
    width: dims.width,
    height: dims.height,
    dpi: 300,
    marginTop: 40,
    marginRight: 40,
    marginBottom: 40,
    marginLeft: 40,
    bleed: 0,
    backgroundColor: "#FFFFFF",
  };
}

export function defaultTheme(): TemplateTheme {
  return {
    palette: {
      primary: "#1A1A1A",
      secondary: "#FFFFFF",
      accent: "#C9A84C",
      background: "#FFFFFF",
      text: "#1A1A1A",
      textLight: "#6B6B6B",
    },
    fonts: {
      heading: {
        family: "Playfair Display",
        fallback: "Georgia, serif",
        weights: [400, 700],
      },
      body: {
        family: "Montserrat",
        fallback: "Arial, sans-serif",
        weights: [300, 400, 600],
      },
    },
    customFonts: [
      { family: "Playfair Display" },
      { family: "Montserrat" },
    ],
    defaultStyles: {
      title: {
        fontFamily: "Playfair Display",
        fontSize: 32,
        fontWeight: 700,
        color: "#1A1A1A",
        lineHeight: 1.2,
        letterSpacing: 0,
      },
      body: {
        fontFamily: "Montserrat",
        fontSize: 14,
        fontWeight: 400,
        color: "#1A1A1A",
        lineHeight: 1.5,
        letterSpacing: 0,
      },
      legal: {
        fontFamily: "Montserrat",
        fontSize: 8,
        fontWeight: 300,
        color: "#6B6B6B",
        lineHeight: 1.4,
        letterSpacing: 0,
      },
    },
  };
}

export function emptyTemplate(): TemplateJSON {
  return {
    canvas: defaultCanvas("A3_LANDSCAPE"),
    theme: defaultTheme(),
    blocks: [],
    schema: [],
  };
}

import type { TextTemplateSegment } from "@/lib/textTemplate";
import type { DecimalSeparator } from "@/lib/numberFormatting";

// ─── Canvas ────────────────────────────────────────────────────────────────────
export type CanvasFormat =
  | "A3_LANDSCAPE"
  | "A4_PORTRAIT"
  | "IG_1080x1350"
  | "IG_1080x1920"
  | "CUSTOM";

export const CANVAS_FORMATS: Record<
  CanvasFormat,
  { label: string; width: number; height: number }
> = {
  A3_LANDSCAPE:  { label: "A3 Paysage",       width: 1587, height: 1123 },
  A4_PORTRAIT:   { label: "A4 Portrait",       width: 794,  height: 1123 },
  IG_1080x1350:  { label: "Instagram 4:5",     width: 1080, height: 1350 },
  IG_1080x1920:  { label: "Instagram Stories", width: 1080, height: 1920 },
  CUSTOM:        { label: "Personnalise",      width: 1920, height: 1080 },
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
  /** Durée max de la vidéo de sortie en secondes. undefined = durée de la vidéo source. */
  maxDuration?: number;
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
  | "dpe"
  | "music";

export interface BaseBlock {
  id: string;
  name?: string;
  type: BlockType;
  groupId?: string;
  hidden?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation?: number; // degrés, ex: -45 pour le badge VENDU
  locked?: boolean;  // si true : pas de drag/resize accidentel
  binding?: string; // variable name from schema
  animations: AnimationDef[]; // V2 — kept empty in V1
  /** Seconde d'apparition dans la vidéo (global). undefined ou 0 = dès le début. Ne s'applique que pour les templates vidéo. */
  appearAt?: number;
  /** Seconde de disparition dans la vidéo (global). undefined = visible jusqu'à la fin. Ne s'applique que pour les templates vidéo. */
  hideAt?: number;
  /**
   * Overrides de timing par slot de séquence. Clé = slot.id.
   * Prioritaire sur `appearAt`/`hideAt` pour ce slot spécifique.
   * Permet d'avoir un bloc qui apparaît à 2s dans le clip 1 et à 0.5s dans le clip 2.
   */
  slotTimings?: Record<string, { appearAt?: number; hideAt?: number }>;
  /** Règles conditionnelles du bloc (modèle actuel). */
  conditionalRules?: BlockConditionalRule[];
  /** @deprecated Compat legacy lu puis normalisé côté application. */
  showIf?: ConditionMatch;
  /** @deprecated Compat legacy lu puis normalisé côté application. */
  conditionalOverrides?: ConditionalBlockOverride[];
}

export interface ConditionMatch {
  field: string;
  equals: string;
}

export interface BlockConditionalEffects {
  visible?: boolean;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  opacity?: number;
  backgroundColor?: string;
  textColor?: string;
}

export interface BlockConditionalRule {
  when: ConditionMatch;
  effects: BlockConditionalEffects;
}

export interface ConditionalBlockOverride {
  when: ConditionMatch;
  color?: string;
  offsetX?: number;
  offsetY?: number;
}

export interface LayerGroup {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
  collapsed?: boolean;
  layout?: GroupLayoutConfig;
  conditionalRules?: BlockConditionalRule[];
  /**
   * Groupe parent (pour l'imbrication ligne-dans-colonne). Absent = groupe
   * top-level (comportement historique). Profondeur limitée à **1 niveau** :
   * un groupe qui a un `parentGroupId` ne peut pas lui-même être parent (garde-fou
   * appliqué à la normalisation). `block.groupId` reste plat et pointe toujours
   * vers le groupe feuille direct du bloc.
   */
  parentGroupId?: string;
}

export interface GroupLayoutConfig {
  mode?: "free" | "row" | "column";
  width?: number;
  height?: number;
  gap?: number;
  justify?: "start" | "center" | "end";
  align?: "top" | "middle" | "bottom";
  order?: string[];
  anchorBlockId?: string;
  /**
   * Si vrai, l'auto-layout mesure la hauteur RÉELLE du contenu texte (glyphes
   * wrappés) au lieu de la hauteur du cadre figé `block.h` pour les blocs sans
   * cartouche. Permet aux blocs suivants (ex: surface m²) de coller au titre,
   * que celui-ci tienne sur 1 ou 2 lignes. Défaut absent/false = comportement
   * historique (cadre figé), zéro régression.
   */
  sizeToContent?: boolean;
}

export interface BlockStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /**
   * Faux-gras bipolaire, en px à la résolution native du template. 0/absent = off.
   * - POSITIF : contour `-webkit-text-stroke` de la MÊME couleur que le texte →
   *   épaissit les glyphes au-delà de `fontWeight` (plafonné par les fontes
   *   dispo + la saturation du gras synthétique navigateur).
   * - NÉGATIF : érosion `feMorphology operator="erode"` (filtre SVG) → affine les
   *   glyphes (impossible au stroke, dont la largeur ne peut être négative).
   */
  fauxBoldWidth?: number;
  color?: string;
  letterSpacing?: number;
  textShadowEnabled?: boolean;
  textShadowColor?: string;
  textShadowOpacity?: number;
  textShadowBlur?: number;
  textShadowDistance?: number;
  textShadowAngle?: number;
  textBackgroundEnabled?: boolean;
  /** "fit": single box hugging all text; "fixed": explicit w/h; "per-line": each line gets its own box */
  textBackgroundMode?: "fit" | "fixed" | "per-line";
  textBackgroundWidth?: number;
  textBackgroundHeight?: number;
  textBackgroundPadding?: number;
  textBackgroundPaddingTop?: number;
  textBackgroundPaddingRight?: number;
  textBackgroundPaddingBottom?: number;
  textBackgroundPaddingLeft?: number;
  textBackgroundBorderRadius?: number;
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
  /** Opacité des glyphes du texte seul (0-1, défaut 1). Indépendant du fond. */
  textOpacity?: number;
  /** Opacité du cartouche de fond seul (0-1, défaut 1). Injectée en rgba() pour laisser le texte opaque. */
  backgroundOpacity?: number;
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
  /** Structured segments used by the builder as source of truth. */
  contentSegments?: TextTemplateSegment[];
  /** Template string with interpolation: "{{prix}} €", "Surface : {{surface}} m²", texte libre.
   *  Supports any mix of static text and {{variable}} tokens. */
  content?: string;
  staticText?: string; // @deprecated: utiliser content à la place
  /** Résout le contenu depuis les métadonnées d'un asset vidéo au moment de la génération.
   *  Remplace le contenu du bloc par la valeur de `key` dans l'asset résolu pour `libraryId`. */
  libraryMetadataRef?: { libraryId: string; key: string };
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
 * Condition de filtre par tag sur un asset de bibliothèque.
 * Plusieurs conditions peuvent être combinées avec AND ou OR.
 */
export interface TagCondition {
  /**
   * Valeur littérale du tag, OU clé d'un champ du schéma si `fromParam` est true.
   * Ex: "lola" (littéral) ou "agent" (champ schéma → formData["agent"]).
   */
  tag: string;
  /** Si true, la valeur de `tag` est une clé de champ résolue à la génération. */
  fromParam?: boolean;
  /** Si true, l'asset NE doit PAS avoir ce tag. */
  negate?: boolean;
}

/**
 * Règle de sélection structurée pour les assets de bibliothèque média.
 * Permet de combiner une stratégie de tri avec des filtres optionnels par tag et compte IG.
 */
export interface MediaSelectionRuleConfig {
  /** Stratégie de sélection. */
  strategy: "least_used" | "oldest_used" | "random" | "manual" | "theme_sequence" | "not_used_in_cycle";
  /**
   * Tag littéral — restreint la sélection aux assets ayant ce tag.
   * Rétrocompatibilité : préférer `tagConditions` pour les nouvelles règles.
   * Prioritaire sur tagFilterParam si les deux sont définis.
   */
  tagFilter?: string;
  /**
   * Clé d'un champ du schéma dont la valeur sera utilisée comme tag de filtre.
   * Rétrocompatibilité : préférer `tagConditions` pour les nouvelles règles.
   */
  tagFilterParam?: string;
  /**
   * Liste de conditions de filtre par tag.
   * Remplace tagFilter/tagFilterParam pour les nouvelles règles.
   */
  tagConditions?: TagCondition[];
  /**
   * Opérateur logique entre les conditions de `tagConditions`.
   * "AND" (défaut) = l'asset doit satisfaire toutes les conditions.
   * "OR" = l'asset doit satisfaire au moins une condition.
   */
  tagConditionsOperator?: "AND" | "OR";
}

/**
 * Règle de sélection d'un asset média depuis une bibliothèque.
 * Accepte soit une chaîne simple (rétrocompat) soit un objet structuré.
 */
export type MediaSelectionRule =
  | "oldest_used"
  | "least_used"
  | "random"
  | "manual"
  | "theme_sequence"
  | "not_used_in_cycle"
  | MediaSelectionRuleConfig;

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
  /** Couper l'audio de cette vidéo au rendu (défaut false). */
  mute?: boolean;
  /** Volume de l'audio de cette vidéo (0–1, défaut 1.0). */
  audioVolume?: number;
  /** ID de la MediaLibrary (type="video") liée à ce bloc. Metadata only — aucun effet sur le preview. */
  libraryId?: string;
  /** Règle de sélection automatique depuis la bibliothèque. */
  selectionRule?: MediaSelectionRule;
  /**
   * Durée minimale de l'asset attendue, en secondes (optionnel).
   * Si défini, exclut les assets plus courts en AUTO et MANUEL.
   */
  minDuration?: number;
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
  showFrame?: boolean;
  frameColor?: string;
  showBackground?: boolean;
  backgroundColor?: string;
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

/**
 * Bloc musique : non-visuel, définit une piste audio de fond à mixer
 * avec l'audio de la vidéo source lors du rendu FFmpeg.
 * N'est jamais affiché sur le canvas — x/y/w/h sont ignorés.
 */
export interface MusicBlock extends BaseBlock {
  type: "music";
  /** Volume de la piste musique (0–1, défaut 0.3). */
  volume?: number;
  /**
   * Durée minimale de l'asset audio attendue, en secondes (optionnel).
   * Si défini, exclut les assets plus courts en AUTO et MANUEL.
   */
  minDuration?: number;
  /** Boucler la musique si plus courte que la vidéo (défaut false). */
  loop?: boolean;
  /** Fondu d'entrée en secondes (défaut 0). */
  fadeIn?: number;
  /** Fondu de sortie en secondes (défaut 0). */
  fadeOut?: number;
  /** ID de la MediaLibrary (type="audio") liée à ce bloc. Metadata only — aucun effet sur le preview. */
  libraryId?: string;
  /** Règle de sélection automatique depuis la bibliothèque audio. */
  audioSelectionRule?: MediaSelectionRule;
  /**
   * Overrides audio comportement par slot de séquence. Clé = slot.id.
   * Prioritaire sur les champs globaux pour ce slot spécifique.
   */
  slotAudio?: Record<string, {
    /** Volume override pour ce slot (0–1). Utilise `volume` si absent. */
    volume?: number;
    /** Silence total sur ce slot. */
    mute?: boolean;
    /** Commence à lire à cette position en secondes dans ce clip (défaut 0). */
    startAt?: number;
    /** S'arrête à cette position en secondes dans ce clip. */
    stopAt?: number;
    /**
     * Volume cible de la piste musicale pour ce slot, en dB (ex: -18, -3).
     * La piste musicale sera au niveau global (MusicBlock.volume) par défaut,
     * et atteindra ce niveau via un fondu de `musicTrackFadeIn` secondes.
     */
    musicTrackVolumeDb?: number;
    /**
     * Durée du fondu (en secondes) appliqué à la piste musicale au début de ce slot
     * pour atteindre `musicTrackVolumeDb`. Défaut 0 (changement instantané).
     */
    musicTrackFadeIn?: number;
    /**
     * Durée du fondu (en secondes) appliqué à la piste musicale à la FIN de ce slot,
     * en commençant `musicTrackFadeOut` secondes avant la coupe suivante.
     * Défaut 0 (changement instantané à la coupe).
     */
    musicTrackFadeOut?: number;
  }>;
}

export type AnyBlock =
  | TextBlock
  | ImageBlock
  | VideoBlock
  | ShapeBlock
  | DPEBlock
  | MusicBlock;

// ─── Schema (variables attendues par le template) ──────────────────────────────
export type SchemaFieldType =
  | "text"
  | "number"
  | "image"
  | "video"
  | "audio"
  | "select"
  | "boolean"
  | "url";

/**
 * Source dynamique d'options pour un champ "select".
 * Au lieu d'une liste statique, les options sont chargées depuis une
 * bibliothèque média au moment de l'affichage du formulaire.
 */
export interface SchemaFieldOptionsSource {
  /** Type de source dynamique. */
  type: "ig-accounts-from-library" | "metadata-values-from-library";
  /** ID de la MediaLibrary à interroger. */
  libraryId: string;
  /**
   * Clé de métadonnée dont les valeurs distinctes remplissent les options du select.
   * Requis pour `type === "metadata-values-from-library"`.
   */
  metadataKey?: string;
  /**
   * ID du VideoBlock du template que ce champ pilote.
   * Quand l'utilisateur choisit une valeur, le render cherche l'asset dont
   * `metadata[metadataKey] === valeur` dans la bibliothèque `libraryId`.
   * Requis pour `type === "metadata-values-from-library"`.
   */
  blockId?: string;
}

export interface SchemaField {
  key: string; // ex: "price_eur"
  label: string; // ex: "Prix (€)"
  sectionId?: string;
  sectionLayout?: SchemaFieldSectionLayout;
  type: SchemaFieldType;
  required: boolean;
  description?: string; // hint affiché sous le champ dans le formulaire
  options?: string[]; // pour type "select" avec liste statique
  /** Source dynamique d'options (remplace `options` si défini). */
  optionsSource?: SchemaFieldOptionsSource;
  default?: unknown;
  placeholder?: string;
  formatThousands?: boolean;
  decimalSeparator?: DecimalSeparator;
  showIf?: ConditionMatch; // n'affiche ce champ que si un autre champ vaut une certaine valeur
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  /**
   * Source automatique depuis les métadonnées d'un asset de bibliothèque.
   * Quand défini, la valeur du champ est injectée dans listingData avant le rendu,
   * à partir des métadonnées de l'asset vidéo résolu pour cette bibliothèque.
   * Fonctionne avec {{key}} dans les blocs texte, formatThousands, decimalSeparator inclus.
   */
  metadataSource?: {
    /** ID de la MediaLibrary dont l'asset est résolu à la génération. */
    libraryId: string;
    /** Clé dans MediaAsset.metadata (ex: "prix", "surface"). */
    metadataKey: string;
  };
}

export type TemplateSectionColumnCount = 1 | 2 | 3 | 4 | 5;

export interface SchemaFieldSectionLayout {
  column?: TemplateSectionColumnCount;
  row?: number;
}

export interface TemplateFormSectionLayout {
  desktopSpan?: "full" | "half";
  fieldColumns?: TemplateSectionColumnCount;
  rowCount?: number;
}

export interface TemplateFormSection {
  id: string;
  title: string;
  description?: string;
  conditions?: ConditionMatch[];
  revealWhenPreviousComplete?: boolean;
  revealCompletionMode?: "all" | "required";
  /** @deprecated Compat single condition legacy. */
  showIf?: ConditionMatch;
  layout?: TemplateFormSectionLayout;
}

/**
 * Slot dans une séquence vidéo multi-clip (intro → contenu → outro).
 * Lorsque `videoSequence` est défini sur un template, le pipeline
 * « render_sequence » est utilisé au lieu du pipeline vidéo standard.
 */
export interface VideoSequenceSlot {
  /** Identifiant interne du slot (généré automatiquement). */
  id: string;
  /** Nom affiché dans l'interface (ex: "Accroche", "Tour du bien", "Logo fin"). */
  label?: string;
  /** Clé du schéma pour la vidéo fournie manuellement dans le formulaire. */
  binding?: string;
  /** ID de la MediaLibrary (type="video") pour la résolution automatique. */
  libraryId?: string;
  /** Règle de sélection depuis la bibliothèque. "theme_sequence" pour intro/outro. */
  selectionRule?: MediaSelectionRule;
  /**
   * ID explicite du VideoBlock du template que ce slot utilise pour le positionnement
   * (x, y, w, h, fit) lors du composite FFmpeg.
   * Si absent, le pipeline cherche un VideoBlock dont le binding = slot.binding.
   * S'il n'en trouve pas, canvas complet (0, 0, w, h, cover) est utilisé.
   */
  videoBlockId?: string;
  /**
   * IDs des groupes de blocs visibles dans l'overlay de ce slot.
   * - `undefined` : tous les blocs visibles (overlay complet).
   * - `[]`        : aucun overlay (vidéo nue, sans titre).
   * - `["ID1"]`   : seulement les blocs de ces groupes.
   */
  overlayGroupIds?: string[];
  /** Cap optionnel sur la durée de ce clip en secondes. */
  maxDuration?: number;
  /**
   * Fondu d'entrée audio en secondes appliqué au début de ce clip.
   * Implémenté côté Python (`template_composite.py`) via le filtre afade :
   * la rampe démarre au boundary du slot et dure `fadeIn` secondes.
   * Défaut 0 (pas de fondu).
   */
  fadeIn?: number;
  /**
   * Fondu de sortie audio en secondes appliqué à la fin de ce clip.
   * Implémenté côté Python (`template_composite.py`) via le filtre afade :
   * la rampe démarre `fadeOut` secondes avant le boundary suivant et termine
   * au boundary. Prioritaire sur le `fadeIn` du slot suivant (overlap).
   * Défaut 0 (pas de fondu).
   */
  fadeOut?: number;
}

// ─── Template JSON (structure complète) ────────────────────────────────────────
export interface TemplateJSON {
  /**
   * Version du schéma TemplateJSON — bumpée à chaque modification structurelle
   * qui nécessite une normalize/migration (orphan group cleanup, default
   * videoSequence, etc.). Permet à normalizeTemplateJSON de skip le travail
   * si le template est déjà à la version courante. Absent = template legacy
   * (pré-W5.17), normalisation complète à la prochaine lecture.
   */
  schemaVersion?: number;
  canvas: TemplateCanvas;
  theme: TemplateTheme;
  blocks: AnyBlock[];
  groups: LayerGroup[];
  formSections: TemplateFormSection[];
  schema: SchemaField[];
  /** Configuration des bibliothèques de contenu liées à cette template. */
  contentLibrary?: {
    /** ID de la DataLibrary pour cette template (ex: bibliothèque RPI). */
    dataLibraryId?: string;
    /** ID de la DataCampaign active (peut être surchargé à la génération). */
    dataCampaignId?: string;
    /** Règle de sélection automatique d'une DataEntry. */
    dataSelectionRule?: "not_used_in_cycle" | "least_used" | "manual";
  };
  /**
   * Contrôle la façon dont le formulaire de génération est présenté.
   * - "manual" (défaut) : formulaire affiché, valeurs pré-remplies depuis la DataCampaign
   * - "auto" : pas de formulaire — tout est résolu depuis les bibliothèques et la DataCampaign
   * - "both" : l'utilisateur choisit le mode au moment de lancer la génération
   */
  generationMode?: "manual" | "auto" | "both";
  /**
   * Séquence de clips vidéo ordonnés (intro → contenu → outro).
   * Si défini, le pipeline `render_sequence` est utilisé.
   * Si absent ou vide, comportement standard (bloc vidéo unique).
   */
  videoSequence?: VideoSequenceSlot[];
  /**
   * Configuration du pipeline de sous-titrage automatique.
   * Si défini et activé, un job de transcription est créé automatiquement
   * à la fin d'un render vidéo basé sur ce template.
   */
  captionAutoConfig?: CaptionAutoConfig;
  // coverAutoConfig removed in Phase 1.8 — migrated to AccountPattern.coverConfig
  timeline?: undefined; // V2 placeholder
}

/**
 * Zone temporelle dans laquelle les sous-titres sont supprimés (ex: outro).
 * Les timestamps de début et fin sont dérivés des groupes référencés ou fournis explicitement.
 */
export interface CaptionExcludeZone {
  /** Identifiant unique de la zone. */
  id: string;
  /** Nom lisible ("outro", "générique", etc.) — utilisé dans les logs et l'UI. */
  label: string;
  /**
   * ID du groupe LayerGroup dont le min(block.appearAt) des membres donne le timestamp de début.
   * Prioritaire sur `startTime` si défini.
   */
  startGroupId?: string;
  /**
   * Timestamp de début explicite en secondes.
   * Utilisé si `startGroupId` est absent ou si le groupe n'a aucun bloc avec `appearAt`.
   */
  startTime?: number;
  /**
   * ID du groupe LayerGroup dont le min(block.appearAt) des membres donne le timestamp de fin.
   * Prioritaire sur `endTime` si défini.
   */
  endGroupId?: string;
  /**
   * Timestamp de fin explicite en secondes.
   * Si absent et `endGroupId` absent, la zone s'étend jusqu'à la fin de la vidéo.
   */
  endTime?: number;
}

/**
 * Configuration du pipeline de sous-titrage automatique pour un template.
 * Si `enabled` est false ou si ce champ est absent, aucun job de transcription
 * n'est créé automatiquement après un render.
 */
export interface CaptionAutoConfig {
  /** Active le déclenchement automatique de la transcription après un render. */
  enabled: boolean;
  /** ID du CaptionPreset à utiliser pour le job de sous-titres. */
  presetId?: string;
  /**
   * Zones temporelles à exclure du sous-titrage (ex: outro, générique).
   * Résolues en timestamps au moment de la création du CaptionJob.
   */
  excludeZones: CaptionExcludeZone[];
  /**
   * IDs des slots de videoSequence à exclure du sous-titrage.
   * À l'exécution, convertis en zones temporelles via les maxDuration des slots.
   * Prioritaire sur excludeZones pour les templates séquence.
   */
  excludeSlotIds?: string[];
  /** ID du CaptionPrompt à utiliser pour la correction IA des segments. Optionnel. */
  correctionPromptId?: string;
  /** Modèle IA à utiliser pour la correction. Défaut : "claude". */
  correctionModel?: "claude" | "gpt";
}

/**
 * Configuration du pipeline cover semi-automatique pour un template.
 * Les zones d'exclusion suivent le même modèle temporel que l'auto-caption.
 */
export interface CoverAutoConfig {
  /** Active la préparation automatique d'un pack cover après un render vidéo. */
  enabled: boolean;
  /** Nombre de frames à proposer par tirage. Défaut produit: 36. */
  frameCount?: number;
  /** Zones temporelles à exclure de la recherche de frames. */
  excludeZones: CaptionExcludeZone[];
  /**
   * IDs des slots de videoSequence à exclure de la recherche de frames.
   * Convertis en zones temporelles comme pour l'auto-caption.
   * Ignoré si includeSlotIds est non vide.
   */
  excludeSlotIds?: string[];
  /**
   * Phase 2.5 — IDs des slots à utiliser EXCLUSIVEMENT comme source de frames.
   * Si non vide, prend le pas sur excludeSlotIds (mode "uniquement ces clips").
   * Si vide ou absent, on retombe sur le mode "toute la vidéo + exclusions".
   */
  includeSlotIds?: string[];
  /** Groupes du builder à reprendre comme overlay texte sur la cover finale. */
  overlayGroupIds?: string[];
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
    groups: [],
    formSections: [],
    schema: [],
  };
}

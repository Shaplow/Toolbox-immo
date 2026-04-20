export type CaptionConfigState = {
  base: {
    font: string
    size_ratio: number
    bold: boolean
    italic: boolean
    text_transform: 'none' | 'upper' | 'lower' | 'title'
    color: string
    spacing: number
  }
  highlight: {
    font: string
    size_ratio: number
    bold: boolean
    italic: boolean
    text_transform: 'none' | 'upper' | 'lower' | 'title'
    color: string
    spacing: number
  }
  highlight2: {
    enabled: boolean
    font: string
    size_ratio: number
    bold: boolean
    italic: boolean
    text_transform: 'none' | 'upper' | 'lower' | 'title'
    color: string
    spacing: number
  }
  layout: {
    anchor: 'bottom' | 'center' | 'top'
    max_lines: number
    line_gap: number
    max_width_ratio: number
    vertical_offset: number
    safe_left: number
    safe_right: number
    safe_top: number
    safe_bottom: number
    auto_safe_area: boolean
  }
  effects: {
    shadow_enabled: boolean
    shadow_distance: number
    shadow_blur: number
    shadow_angle: number
    shadow_alpha: number
    shadow_color: string
    shadow_targets: { base: boolean; highlight: boolean; highlight2: boolean }
    glow_enabled: boolean
    glow_color: string
    glow_color_auto: boolean
    glow_targets: { base: boolean; highlight: boolean; highlight2: boolean }
    glow_intensity: number
    outline_enabled: boolean
    outline_color: string
    outline_width: number
    outline_targets: { base: boolean; highlight: boolean; highlight2: boolean }
  }
  animation: 'none' | 'appear' | 'reveal' | 'word_pop'
  animation_enabled: boolean
  export_profile: 'draft' | 'balanced' | 'final'
  preview_time: number
}

export const DEFAULT_CAPTION_CONFIG: CaptionConfigState = {
  base: { font: 'Playfair Display SemiBold', size_ratio: 0.062, bold: true, italic: false, text_transform: 'none', color: '#ffffff', spacing: 0 },
  highlight: { font: 'Didot', size_ratio: 0.068, bold: false, italic: true, text_transform: 'none', color: '#c88b3a', spacing: 0 },
  highlight2: { enabled: false, font: 'Didot', size_ratio: 0.068, bold: false, italic: true, text_transform: 'none', color: '#3ab8c8', spacing: 0 },
  layout: {
    anchor: 'center', max_lines: 2, line_gap: 0.22, max_width_ratio: 1.0,
    vertical_offset: 0, safe_left: 0.06, safe_right: 0.06, safe_top: 0.08, safe_bottom: 0.18, auto_safe_area: true,
  },
  effects: {
    shadow_enabled: false, shadow_distance: 0, shadow_blur: 0, shadow_angle: 90, shadow_alpha: 0.45, shadow_color: '#000000',
    shadow_targets: { base: true, highlight: true, highlight2: true },
    glow_enabled: false, glow_color: '#c88b3a', glow_color_auto: false,
    glow_targets: { base: true, highlight: true, highlight2: true },
    glow_intensity: 0,
    outline_enabled: false, outline_color: '#000000', outline_width: 3,
    outline_targets: { base: true, highlight: true, highlight2: true },
  },
  animation: 'reveal', animation_enabled: true, export_profile: 'balanced', preview_time: 0,
}

export function mergeCaptionConfig(config?: Partial<CaptionConfigState> | null): CaptionConfigState {
  const next: Partial<CaptionConfigState> = config ?? {}
  const effects: Partial<CaptionConfigState['effects']> = next.effects ?? {}

  return {
    ...DEFAULT_CAPTION_CONFIG,
    ...next,
    base: { ...DEFAULT_CAPTION_CONFIG.base, ...(next.base ?? {}) },
    highlight: { ...DEFAULT_CAPTION_CONFIG.highlight, ...(next.highlight ?? {}) },
    highlight2: { ...DEFAULT_CAPTION_CONFIG.highlight2, ...(next.highlight2 ?? {}) },
    effects: {
      ...DEFAULT_CAPTION_CONFIG.effects,
      ...effects,
      shadow_targets: {
        ...DEFAULT_CAPTION_CONFIG.effects.shadow_targets,
        ...(effects.shadow_targets ?? {}),
      },
      glow_targets: {
        ...DEFAULT_CAPTION_CONFIG.effects.glow_targets,
        ...(effects.glow_targets ?? {}),
      },
      outline_targets: {
        ...DEFAULT_CAPTION_CONFIG.effects.outline_targets,
        ...(effects.outline_targets ?? {}),
      },
    },
    layout: { ...DEFAULT_CAPTION_CONFIG.layout, ...(next.layout ?? {}) },
  }
}
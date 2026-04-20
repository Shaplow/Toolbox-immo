export type CaptionHighlightGroup = 0 | 1

export type CaptionHighlightStateName = 'base' | 'hl1' | 'hl2'

export function getNextHighlightGroup(
  current: number | undefined,
  highlight2Enabled: boolean,
): CaptionHighlightGroup | undefined {
  if (current === undefined) return 0
  if (current === 0 && highlight2Enabled) return 1
  return undefined
}

export function getHighlightStateName(group: number | undefined): CaptionHighlightStateName {
  if (group === 0) return 'hl1'
  if (group === 1) return 'hl2'
  return 'base'
}
export type Caption = {
  index: number
  start: string   // e.g. "00:00:01,000"
  end: string
  text: string    // possibly multi-line
}

const HIGHLIGHT_OPEN_RE = /^\{HL:(\d+)\}/
const HIGHLIGHT_CLOSE_RE = /^\{\/HL:(\d+)\}/

// Punctuation that terminates a sentence — next SRT block starts fresh.
const SENTENCE_END_RE = /[.!?…]+\s*$/

function _srtSeconds(t: string): number {
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/**
 * Merge consecutive SRT captions that belong to the same sentence.
 * Two blocks are merged when ALL of:
 *  - the previous block's text does NOT end with sentence-ending punctuation (.!?…)
 *  - the gap between the two blocks is ≤ maxGapSeconds (default 0.6 s)
 *
 * This fixes Whisper's habit of splitting a sentence like
 *   "…EN PLEIN CŒUR" / "DE paris."
 * into separate tiny blocks.
 *
 * Call this BEFORE parseHighlightedCaptions so that inline {HL:N}…{/HL:N}
 * markers in the raw text are preserved by the text concatenation and re-parsed
 * with correct word indices by parseHighlightedCaptions.
 */
export function mergeSentenceCaptions(captions: Caption[], maxGapSeconds = 0.6): Caption[] {
  if (captions.length === 0) return []

  const merged: Caption[] = []
  let current = { ...captions[0] }

  for (let i = 1; i < captions.length; i++) {
    const next = captions[i]
    const gap = _srtSeconds(next.start) - _srtSeconds(current.end)
    const prevEndsWithSentence = SENTENCE_END_RE.test(current.text)

    if (!prevEndsWithSentence && gap <= maxGapSeconds) {
      // Merge: extend current block to include next
      current = {
        ...current,
        end: next.end,
        text: current.text.trim() + ' ' + next.text.trim(),
      }
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  // Re-index sequentially from 1
  return merged.map((c, i) => ({ ...c, index: i + 1 }))
}

/** Parse an SRT string into Caption objects */
export function parseSRT(raw: string): Caption[] {
  const blocks = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n{2,}/)
  const captions: Caption[] = []
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const index = parseInt(lines[0], 10)
    if (isNaN(index)) continue
    const timeLine = lines[1]
    const m = timeLine.match(/^(\S+)\s+-->\s+(\S+)/)
    if (!m) continue
    const text = lines.slice(2).join('\n').trim()
    captions.push({ index, start: m[1], end: m[2], text })
  }
  return captions
}

function serializeCaptionText(text: string, captionIndex: number, highlighted?: Map<string, number>): string {
  if (!highlighted || highlighted.size === 0) return text

  const words = text.split(/(\s+)/)
  let wordIdx = 0
  const out: string[] = []

  for (const token of words) {
    if (/^\s+$/.test(token)) {
      out.push(token)
    } else {
      const key = `${captionIndex}-${wordIdx}`
      const group = highlighted.get(key)
      out.push(group !== undefined ? `{HL:${group}}${token}{/HL:${group}}` : token)
      wordIdx++
    }
  }

  return out.join('')
}

/**
 * Re-serialize Caption[] back to SRT string.
 * If `highlighted` is provided (Map of "captionIndex-wordIndex" → group index),
 * those specific word tokens are wrapped with {HL:N}…{/HL:N} markers so the
 * Python parser can set highlight=True + highlight_group=N on exactly those words.
 */
export function serializeSRT(captions: Caption[], highlighted?: Map<string, number>): string {
  return captions.map(c => {
    const text = serializeCaptionText(c.text, c.index, highlighted)
    return `${c.index}\n${c.start} --> ${c.end}\n${text}`
  }).join('\n\n') + '\n'
}

export function applyHighlightMarkersToCaptions(
  captions: Caption[],
  highlighted?: Map<string, number>
): Caption[] {
  if (!highlighted || highlighted.size === 0) return captions

  return captions.map(c => ({
    ...c,
    text: serializeCaptionText(c.text, c.index, highlighted),
  }))
}

/** Build a File from the current caption list */
export function captionsToFile(
  captions: Caption[],
  name = 'subtitles.srt',
  highlighted?: Map<string, number>
): File {
  const content = serializeSRT(captions, highlighted)
  return new File([content], name, { type: 'text/plain' })
}

/** Normalize a word for keyword matching (lowercase, strip punctuation) */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9àâäéèêëîïôùûüç'-]/gi, '').trim()
}

function parseHighlightedCaptionText(
  text: string,
  captionIndex: number,
  highlighted: Map<string, number>
): { text: string; malformed: boolean } {
  const tokens = text.split(/(\s+)/)
  const cleanTokens: string[] = []
  let wordIdx = 0
  let activeGroup: number | null = null
  let malformed = false

  for (const token of tokens) {
    if (token === '' || /^\s+$/.test(token)) {
      cleanTokens.push(token)
      continue
    }

    let cleanToken = ''
    let tokenGroup: number | null = activeGroup
    let cursor = 0

    while (cursor < token.length) {
      const rest = token.slice(cursor)
      const openMatch = HIGHLIGHT_OPEN_RE.exec(rest)
      if (openMatch) {
        const group = parseInt(openMatch[1], 10)
        if (activeGroup !== null || (tokenGroup !== null && tokenGroup !== group)) {
          malformed = true
        }
        activeGroup = group
        tokenGroup = group
        cursor += openMatch[0].length
        continue
      }

      const closeMatch = HIGHLIGHT_CLOSE_RE.exec(rest)
      if (closeMatch) {
        const group = parseInt(closeMatch[1], 10)
        if (activeGroup === null || activeGroup !== group) {
          malformed = true
        }
        activeGroup = null
        cursor += closeMatch[0].length
        continue
      }

      cleanToken += token[cursor]
      cursor += 1
    }

    if (cleanToken !== '') {
      if (tokenGroup !== null) {
        highlighted.set(`${captionIndex}-${wordIdx}`, tokenGroup)
      }
      cleanTokens.push(cleanToken)
      wordIdx += 1
    }
  }

  if (activeGroup !== null) {
    malformed = true
  }

  return { text: cleanTokens.join(''), malformed }
}

export function parseHighlightedCaptions(
  rawCaptions: Caption[]
): { captions: Caption[], highlighted: Map<string, number>, malformed: boolean } {
  const highlighted = new Map<string, number>()
  let malformed = false

  const captions = rawCaptions.map(c => {
    const parsed = parseHighlightedCaptionText(c.text, c.index, highlighted)
    malformed = malformed || parsed.malformed
    return { ...c, text: parsed.text }
  })

  return { captions, highlighted, malformed }
}

/**
 * Parse an SRT that may contain {HL:N}word{/HL:N} markers.
 * Returns clean captions (markers stripped) + the reconstructed highlighted map
 * so the CaptionEditor can display the words as already-highlighted without
 * showing raw marker text.
 */
export function parseHighlightedSRT(raw: string): { captions: Caption[], highlighted: Map<string, number>, malformed: boolean } {
  return parseHighlightedCaptions(mergeSentenceCaptions(parseSRT(raw)))
}

export type Caption = {
  index: number
  start: string   // e.g. "00:00:01,000"
  end: string
  text: string    // possibly multi-line
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

/**
 * Re-serialize Caption[] back to SRT string.
 * If `highlighted` is provided (Map of "captionIndex-wordIndex" → group index),
 * those specific word tokens are wrapped with {HL:N}…{/HL:N} markers so the Python
 * parser can set highlight=True + highlight_group=N on exactly those words.
 */
export function serializeSRT(captions: Caption[], highlighted?: Map<string, number>): string {
  return captions.map(c => {
    let text = c.text
    if (highlighted && highlighted.size > 0) {
      const words = c.text.split(/(\s+)/) // keep whitespace tokens
      let wordIdx = 0
      const out: string[] = []
      for (const token of words) {
        if (/^\s+$/.test(token)) {
          out.push(token)
        } else {
          const key = `${c.index}-${wordIdx}`
          const group = highlighted.get(key)
          out.push(group !== undefined ? `{HL:${group}}${token}{/HL:${group}}` : token)
          wordIdx++
        }
      }
      text = out.join('')
    }
    return `${c.index}\n${c.start} --> ${c.end}\n${text}`
  }).join('\n\n') + '\n'
}

/** Build a File from the current caption list */
export function captionsToFile(captions: Caption[], name = 'subtitles.srt', highlighted?: Map<string, number>): File {
  const content = serializeSRT(captions, highlighted)
  return new File([content], name, { type: 'text/plain' })
}

/** Normalize a word for keyword matching (lowercase, strip punctuation) */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9àâäéèêëîïôùûüç'-]/gi, '').trim()
}

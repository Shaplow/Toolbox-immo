import React, { useState } from 'react'
import { Tag, Check, Pencil, X } from 'lucide-react'
import { Caption } from '../lib/srt'

type Props = {
  captions: Caption[]
  onChange: (captions: Caption[]) => void
  /** Map of occurrence keys ("captionIndex-wordIndex") → highlight group index */
  highlighted: Map<string, number>
  /** Called with occurrence key — cycles: none → group 0 → group 1 (if enabled) → none */
  onToggleWord: (key: string) => void
  /** Text transform to preview in word chips */
  baseTransform: 'none' | 'upper' | 'lower' | 'title'
  /** Whether a second highlight group is active */
  highlight2Enabled?: boolean
}

function applyTransform(word: string, transform: string): string {
  if (transform === 'upper') return word.toUpperCase()
  if (transform === 'lower') return word.toLowerCase()
  if (transform === 'title') return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return word
}

const HL_STYLES = [
  { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' }, // group 0 — amber
  { bg: '#ccfbf1', border: '#2dd4bf', text: '#115e59' }, // group 1 — teal
] as const

export default function CaptionEditor({ captions, onChange, highlighted, onToggleWord, baseTransform, highlight2Enabled = false }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText]   = useState('')

  if (captions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 10, padding: '36px 20px', color: '#9ca3af', textAlign: 'center' }}>
        <Tag size={28} strokeWidth={1.5} />
        <p style={{ margin: 0, fontSize: 13 }}>
          Importe un fichier <b>.srt</b> pour éditer les captions
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                  maxHeight: '64vh', overflowY: 'auto', paddingRight: 4 }}>
      {captions.map(c => {
        const isEditing = editingId === c.index
        const words = c.text.trim().split(/\s+/).filter(Boolean)

        return (
          <div key={c.index} style={{
            border: '1px solid #e1e5f0',
            borderRadius: 8,
            background: '#fff',
            /* NO overflow:hidden — it clips inline content */
          }}>

            {/* ── meta row ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 10px', background: '#f7f8fc',
              borderBottom: '1px solid #e1e5f0',
              borderRadius: '8px 8px 0 0',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af',
                             fontVariantNumeric: 'tabular-nums', minWidth: 24 }}>
                #{c.index}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                {c.start.replace(',', '.')} → {c.end.replace(',', '.')}
              </span>
              <button
                onClick={() => {
                  if (isEditing) { setEditingId(null) }
                  else { setEditingId(c.index); setEditText(c.text) }
                }}
                style={{
                  all: 'unset', cursor: 'pointer',
                  color: isEditing ? '#5b6bff' : '#9ca3af',
                  display: 'flex', alignItems: 'center',
                  padding: '2px 4px', borderRadius: 4,
                }}
                title={isEditing ? 'Annuler édition' : 'Éditer texte'}
              >
                {isEditing ? <X size={13} /> : <Pencil size={12} />}
              </button>
            </div>

            {/* ── words — always visible, plain <p> so height is always natural ── */}
            <p style={{
              margin: 0,
              padding: '8px 10px',
              lineHeight: 1.9,
              fontSize: 13,
              color: '#1f2937',
              minHeight: 36,
              wordBreak: 'break-word',
            }}>
              {words.map((word, i) => {
                const key = `${c.index}-${i}`
                const hlGroup = highlighted.get(key) // undefined = not highlighted
                const hs = hlGroup !== undefined ? HL_STYLES[Math.min(hlGroup, HL_STYLES.length - 1)] : null
                const clickTitle = hlGroup !== undefined
                  ? (hlGroup === 0 && highlight2Enabled ? 'Cliquer pour HL 2 → encore pour retirer' : 'Retirer ce mot du highlight')
                  : (highlight2Enabled ? 'Ajouter au highlight 1' : 'Ajouter au highlight')
                return (
                  <React.Fragment key={i}>
                    {i > 0 && ' '}
                    <span
                      onClick={() => onToggleWord(key)}
                      title={clickTitle}
                      style={{
                        display: 'inline',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: hs ? 700 : 400,
                        color:      hs ? hs.text : '#374151',
                        background: hs ? hs.bg   : '#f3f4f6',
                        border:     `1px solid ${hs ? hs.border : '#e5e7eb'}`,
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {applyTransform(word, baseTransform)}
                    </span>
                  </React.Fragment>
                )
              })}
            </p>

            {/* ── edit textarea ── */}
            {isEditing && (
              <div style={{
                padding: '0 10px 10px',
                borderTop: '1px solid #e1e5f0',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={Math.max(2, editText.split('\n').length + 1)}
                  autoFocus
                  style={{
                    marginTop: 8, width: '100%', resize: 'vertical',
                    fontFamily: 'inherit', fontSize: 13,
                    background: '#fff', border: '1px solid #5b6bff',
                    borderRadius: 6, padding: '6px 8px', color: '#111827',
                    outline: 'none', boxShadow: '0 0 0 3px rgba(91,107,255,.12)',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      onChange(captions.map(cp =>
                        cp.index === c.index ? { ...cp, text: editText } : cp))
                      setEditingId(null)
                    }}
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'inline-flex',
                      alignItems: 'center', gap: 4, padding: '4px 12px',
                      background: '#5b6bff', color: '#fff', borderRadius: 6,
                      fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    }}
                  >
                    <Check size={12} /> OK
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'inline-flex',
                      alignItems: 'center', gap: 4, padding: '4px 10px',
                      background: '#f3f4f6', color: '#6b7280',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

"use client"

import { Fragment, useEffect, useRef, useState } from 'react'
import { Tag, Check, Pencil, X, Clock, Plus, Scissors, Combine, Trash2 } from 'lucide-react'
import { Caption } from '@/lib/srt'
import { getHighlightStateName, getNextHighlightGroup } from '@/lib/captionHighlightCycle'
import { type CaptionTimingStatus } from '@/lib/captionWordTiming'

type Props = {
  captions: Caption[]
  onChange: (captions: Caption[]) => void
  highlighted: Map<string, number>
  onToggleWord: (key: string) => void
  onSplitAtWord?: (captionIndex: number, wordIndex: number) => void
  onMergeWithNext?: (captionIndex: number) => void
  onDeleteCaption?: (captionIndex: number) => void
  timingStatuses?: CaptionTimingStatus[]
  baseTransform: 'none' | 'upper' | 'lower' | 'title'
  highlightTransform?: 'none' | 'upper' | 'lower' | 'title'
  highlight2Transform?: 'none' | 'upper' | 'lower' | 'title'
  highlight2Enabled?: boolean
}

function applyTransform(word: string, transform: string): string {
  if (transform === 'upper') return word.toUpperCase()
  if (transform === 'lower') return word.toLowerCase()
  if (transform === 'title') return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return word
}

function getWordTransform(
  highlightGroup: number | undefined,
  baseTransform: Props['baseTransform'],
  highlightTransform: Props['highlightTransform'],
  highlight2Transform: Props['highlight2Transform'],
) {
  if (highlightGroup === 0) return highlightTransform ?? baseTransform
  if (highlightGroup === 1) return highlight2Transform ?? highlightTransform ?? baseTransform
  return baseTransform
}

function handleWordKeyDown(event: React.KeyboardEvent<HTMLSpanElement>, onActivate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onActivate()
  }
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function normalizeEditedWords(words: string[]): string[] {
  return words.flatMap(word => splitWords(word))
}

function getTimingStatusLabel(status: CaptionTimingStatus | undefined): string | null {
  if (status === 'realigned') return 'Recalé'
  if (status === 'estimated') return 'Estimé'
  return null
}

function getTimingStatusTitle(status: CaptionTimingStatus | undefined): string | undefined {
  if (status === 'realigned') {
    return 'Timing recalculé à partir des mots restants'
  }
  if (status === 'estimated') {
    return 'Timing estimé depuis la plage de la caption'
  }
  return undefined
}

export default function CaptionEditor({
  captions,
  onChange,
  highlighted,
  onToggleWord,
  onSplitAtWord,
  onMergeWithNext,
  onDeleteCaption,
  timingStatuses,
  baseTransform,
  highlightTransform,
  highlight2Transform,
  highlight2Enabled = false,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editWords, setEditWords] = useState<string[]>([])
  const [editingTcId, setEditingTcId] = useState<number | null>(null)
  const [tcStart, setTcStart] = useState('')
  const [tcEnd, setTcEnd] = useState('')
  const editWordRefs = useRef<Array<HTMLInputElement | null>>([])
  const pendingFocusWordIndexRef = useRef<number | null>(null)

  const TC_RE = /^\d{2}:\d{2}:\d{2}[,\.]\d{3}$/

  function normalizeTc(v: string) {
    return v.replace('.', ',')
  }

  useEffect(() => {
    if (editingId === null) {
      editWordRefs.current = []
      pendingFocusWordIndexRef.current = null
      return
    }

    const targetIndex = pendingFocusWordIndexRef.current ?? 0
    const node = editWordRefs.current[targetIndex]
    if (!node) return

    try {
      node.focus({ preventScroll: true })
    } catch {
      node.focus()
    }

    node.select()
    pendingFocusWordIndexRef.current = null
  }, [editingId, editWords.length])

  function beginEditing(caption: Caption) {
    const words = splitWords(caption.text)
    setEditingId(caption.index)
    setEditWords(words.length > 0 ? words : [''])
    pendingFocusWordIndexRef.current = 0
  }

  function stopEditing() {
    setEditingId(null)
    setEditWords([])
    pendingFocusWordIndexRef.current = null
    editWordRefs.current = []
  }

  function replaceWord(index: number, value: string) {
    const tokens = splitWords(value)
    if (tokens.length > 1) {
      setEditWords(prev => [
        ...prev.slice(0, index),
        ...tokens,
        ...prev.slice(index + 1),
      ])
      pendingFocusWordIndexRef.current = index + tokens.length - 1
      return
    }

    setEditWords(prev => prev.map((word, wordIndex) => (wordIndex === index ? value : word)))
  }

  function insertWordAt(index: number) {
    setEditWords(prev => [
      ...prev.slice(0, index),
      '',
      ...prev.slice(index),
    ])
    pendingFocusWordIndexRef.current = index
  }

  function removeWord(index: number) {
    setEditWords(prev => {
      if (prev.length <= 1) return ['']
      return prev.filter((_word, wordIndex) => wordIndex !== index)
    })
    pendingFocusWordIndexRef.current = Math.max(0, index - 1)
  }

  function saveEditedCaption(captionIndex: number) {
    const words = normalizeEditedWords(editWords)
    if (words.length === 0) return

    onChange(captions.map(cp =>
      cp.index === captionIndex ? { ...cp, text: words.join(' ') } : cp))
    stopEditing()
  }

  function handleEditWordKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      insertWordAt(index + 1)
      return
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && editWords[index] === '') {
      event.preventDefault()
      removeWord(index)
    }
  }

  if (captions.length === 0) {
    return (
      <div className="cx-editor-empty">
        <Tag size={28} strokeWidth={1.5} />
        <p>
          Importez un fichier <b>.srt</b> pour commencer l&apos;édition des captions
        </p>
      </div>
    )
  }

  return (
    <div className="cx-editor-list">
      {captions.map((c, arrayIndex) => {
        const isEditing = editingId === c.index
        const words = splitWords(c.text)
        const canSaveEdit = normalizeEditedWords(editWords).length > 0
        const timingStatus = timingStatuses?.[c.index - 1]
        const timingStatusLabel = getTimingStatusLabel(timingStatus)
        const highlightedCount = words.reduce((count, _word, i) => {
          return count + (highlighted.has(`${c.index}-${i}`) ? 1 : 0)
        }, 0)
        const metaLabel = isEditing
          ? 'Edition'
          : highlightedCount > 0
          ? `${highlightedCount} surligne${highlightedCount > 1 ? 's' : ''}`
          : null

        return (
          <Fragment key={c.index}>
          <article className={`cx-editor-item${isEditing ? ' is-editing' : ''}`}>
            <div className="cx-editor-meta">
              <span className="cx-editor-index">
                #{c.index}
              </span>
              {timingStatusLabel && (
                <span
                  className={`cx-editor-badge cx-editor-badge-${timingStatus}`}
                  title={getTimingStatusTitle(timingStatus)}
                >
                  {timingStatusLabel}
                </span>
              )}
              {metaLabel && (
                <span className="cx-editor-badge">{metaLabel}</span>
              )}
              {editingTcId === c.index ? (
                <div className="cx-editor-timecode-edit">
                  <input
                    value={tcStart}
                    onChange={e => setTcStart(e.target.value)}
                    placeholder="00:00:00,000"
                    className={`cx-editor-timecode-input${TC_RE.test(tcStart) ? '' : ' is-invalid'}`}
                  />
                  <span className="cx-editor-timecode-sep">→</span>
                  <input
                    value={tcEnd}
                    onChange={e => setTcEnd(e.target.value)}
                    placeholder="00:00:00,000"
                    className={`cx-editor-timecode-input${TC_RE.test(tcEnd) ? '' : ' is-invalid'}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (TC_RE.test(tcStart) && TC_RE.test(tcEnd)) {
                        onChange(captions.map(cp =>
                          cp.index === c.index ? { ...cp, start: normalizeTc(tcStart), end: normalizeTc(tcEnd) } : cp
                        ))
                        setEditingTcId(null)
                      }
                    }}
                    disabled={!TC_RE.test(tcStart) || !TC_RE.test(tcEnd)}
                    className="cx-editor-mini-btn cx-editor-mini-btn-primary"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTcId(null)}
                    className="cx-editor-icon-btn"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <span className="cx-editor-timecode">
                  {c.start.replace(',', '.')} → {c.end.replace(',', '.')}
                </span>
              )}
              <div className="cx-editor-toolbar">
                <button
                  type="button"
                  onClick={() => {
                    if (editingTcId === c.index) { setEditingTcId(null) }
                    else { setEditingTcId(c.index); setTcStart(c.start); setTcEnd(c.end) }
                  }}
                  className={`cx-editor-icon-btn${editingTcId === c.index ? ' is-active' : ''}`}
                  title={editingTcId === c.index ? 'Annuler édition timecode' : 'Éditer timecodes'}
                >
                  {editingTcId === c.index ? <X size={13} /> : <Clock size={12} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isEditing) { stopEditing() }
                    else { beginEditing(c) }
                  }}
                  className={`cx-editor-icon-btn${isEditing ? ' is-active' : ''}`}
                  title={isEditing ? 'Annuler édition' : 'Éditer texte'}
                >
                  {isEditing ? <X size={13} /> : <Pencil size={12} />}
                </button>
              </div>
            </div>

            <div className={`cx-editor-body${isEditing ? ' is-editing' : ''}`}>
              <div className="cx-editor-edit-panel">
                {isEditing ? (
                  <>
                    <div className="cx-editor-word-edit-list">
                      {editWords.map((word, wordIndex) => (
                        <Fragment key={`${c.index}-${wordIndex}`}>
                          <button
                            type="button"
                            onClick={() => insertWordAt(wordIndex)}
                            className="cx-editor-word-insert"
                            title={wordIndex === 0 ? 'Insérer un mot au début' : `Insérer un mot avant le mot ${wordIndex + 1}`}
                            aria-label={wordIndex === 0 ? 'Insérer un mot au début' : `Insérer un mot avant le mot ${wordIndex + 1}`}
                          >
                            <Plus size={10} />
                          </button>
                          <div className="cx-editor-word-field">
                            <input
                              ref={node => {
                                editWordRefs.current[wordIndex] = node
                              }}
                              type="text"
                              value={word}
                              onChange={event => replaceWord(wordIndex, event.target.value)}
                              onKeyDown={event => handleEditWordKeyDown(event, wordIndex)}
                              className="cx-editor-word-field-input"
                              style={{ width: `${Math.max(4, word.length + 2)}ch` }}
                              aria-label={`Mot ${wordIndex + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeWord(wordIndex)}
                              className="cx-editor-word-field-remove"
                              title="Supprimer ce mot"
                              aria-label={`Supprimer le mot ${wordIndex + 1}`}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </Fragment>
                      ))}
                      <button
                        type="button"
                        onClick={() => insertWordAt(editWords.length)}
                        className="cx-editor-word-insert cx-editor-word-insert-end"
                        title="Insérer un mot à la fin"
                        aria-label="Insérer un mot à la fin"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                    <p className="cx-editor-edit-hint">
                      Le bouton + insère un mot à l&apos;endroit voulu. Espace ou Entrée ajoute aussi un mot après le champ actif.
                    </p>
                    <div className="cx-editor-edit-actions">
                      <button
                        type="button"
                        onClick={() => saveEditedCaption(c.index)}
                        disabled={!canSaveEdit}
                        className="cx-editor-action-btn cx-editor-action-btn-primary"
                      >
                        <Check size={12} /> OK
                      </button>
                      {!canSaveEdit && onDeleteCaption && (
                        <button
                          type="button"
                          onClick={() => { stopEditing(); onDeleteCaption(c.index) }}
                          className="cx-editor-action-btn cx-editor-action-btn-danger"
                        >
                          <Trash2 size={12} /> Supprimer la phrase
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={stopEditing}
                        className="cx-editor-action-btn"
                      >
                        Annuler
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="cx-editor-words-text">
                    {words.map((word, i) => {
                      const key = `${c.index}-${i}`
                      const hlGroup = highlighted.get(key)
                      const nextGroup = getNextHighlightGroup(hlGroup, highlight2Enabled)
                      const nextStateName = getHighlightStateName(nextGroup)
                      const clickTitle = hlGroup === undefined
                        ? 'Passer en HL1'
                        : hlGroup === 0 && highlight2Enabled
                        ? 'Passer en HL2'
                        : 'Revenir au style de base'
                      return (
                        <Fragment key={i}>
                          {i > 0 && (
                            onSplitAtWord ? (
                              <button
                                type="button"
                                onClick={() => onSplitAtWord(c.index, i)}
                                className="cx-editor-split-btn"
                                title="Séparer la phrase ici"
                                aria-label={`Séparer avant le mot ${i + 1}`}
                              >
                                <Scissors size={9} />
                              </button>
                            ) : ' '
                          )}
                          <span
                            role="button"
                            tabIndex={0}
                            onKeyDown={event => handleWordKeyDown(event, () => onToggleWord(key))}
                            onClick={() => onToggleWord(key)}
                            title={clickTitle}
                            aria-pressed={hlGroup !== undefined}
                            data-highlight-state={getHighlightStateName(hlGroup)}
                            data-next-highlight-state={nextStateName}
                            className={`cx-editor-word${hlGroup !== undefined ? ' is-highlighted' : ''}${hlGroup === 1 ? ' is-highlighted-2' : ''}`}
                          >
                            {applyTransform(
                              word,
                              getWordTransform(hlGroup, baseTransform, highlightTransform, highlight2Transform),
                            )}
                          </span>
                        </Fragment>
                      )
                    })}
                  </p>
                )}
              </div>
            </div>
          </article>
          {onMergeWithNext && arrayIndex < captions.length - 1 && (
            <div className="cx-editor-merge-row">
              <button
                type="button"
                onClick={() => onMergeWithNext(c.index)}
                className="cx-editor-merge-btn"
                title="Fusionner avec la phrase suivante"
                aria-label={`Fusionner la phrase ${c.index} avec la suivante`}
              >
                <Combine size={10} />
              </button>
            </div>
          )}
          </Fragment>
        )
      })}
    </div>
  )
}

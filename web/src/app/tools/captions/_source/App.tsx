import { useEffect, useMemo, useState } from 'react'
import {
  Film, Type, Sparkles, LayoutTemplate, Eye,
  Bold, Italic, Upload, Layers, FileText, Settings2, X, BookMarked, Save
} from 'lucide-react'
import Card from './components/Card'
import { Field } from './components/Field'
import CaptionEditor from './components/CaptionEditor'
import { Caption, parseSRT, serializeSRT } from './lib/srt'

const API_BASE = 'http://localhost:8000'

type ConfigState = {
  base: { font: string; size_ratio: number; bold: boolean; italic: boolean; text_transform: 'none'|'upper'|'lower'|'title'; color: string; spacing: number; outline: number }
  highlight: { font: string; size_ratio: number; bold: boolean; italic: boolean; text_transform: 'none'|'upper'|'lower'|'title'; color: string; spacing: number; outline: number }
  highlight2: { enabled: boolean; font: string; size_ratio: number; bold: boolean; italic: boolean; text_transform: 'none'|'upper'|'lower'|'title'; color: string; spacing: number; outline: number }
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
  }
  animation: 'none' | 'fade_pop' | 'slide_in' | 'reveal' | 'appear'
  animation_enabled: boolean
  export_profile: 'draft' | 'balanced' | 'final'
  preview_time: number
}

type Preset = { name: string; config: ConfigState; savedAt: string }
const PRESETS_KEY = 'subtitle_engine_presets_v1'

function loadPresets(): Preset[] {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]') } catch { return [] }
}
function savePresets(list: Preset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
}

const emptyConfig: ConfigState = {
  base: { font: 'Playfair Display SemiBold', size_ratio: 0.062, bold: true, italic: false, text_transform: 'none' as const, color: '#ffffff', spacing: 0, outline: 0 },
  highlight: { font: 'Didot', size_ratio: 0.068, bold: false, italic: true, text_transform: 'none' as const, color: '#c88b3a', spacing: 0, outline: 0 },
  highlight2: { enabled: false, font: 'Didot', size_ratio: 0.068, bold: false, italic: true, text_transform: 'none' as const, color: '#3ab8c8', spacing: 0, outline: 0 },
  layout: {
    anchor: 'center',
    max_lines: 2,
    line_gap: 0.22,
    max_width_ratio: 1.0,
    vertical_offset: 0,
    safe_left: 0.06,
    safe_right: 0.06,
    safe_top: 0.08,
    safe_bottom: 0.18,
    auto_safe_area: true
  },
  effects: {
    shadow_enabled: false,
    shadow_distance: 0,
    shadow_blur: 0,
    shadow_angle: 90,
    shadow_alpha: 0.45,
    shadow_color: '#000000',
    shadow_targets: { base: true, highlight: true, highlight2: true },
    glow_enabled: false,
    glow_color: '#ffffff',
    glow_color_auto: false,
    glow_targets: { base: true, highlight: true, highlight2: true },
    glow_intensity: 0
  },
  animation: 'reveal',
  animation_enabled: true,
  export_profile: 'balanced',
  preview_time: 0
}

export default function App() {
  const [fonts, setFonts] = useState<string[]>([])
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [subsFile, setSubsFile] = useState<File | null>(null)
  const [captions, setCaptions] = useState<Caption[]>([])
  const [config, setConfig] = useState<ConfigState>(emptyConfig)
  const [previewUrl, setPreviewUrl] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Prêt')
  const [renderProgress, setRenderProgress] = useState(-1) // -1 = idle, 0-1 = active
  const [tab, setTab] = useState<'render' | 'captions'>('render')
  const [highlighted, setHighlighted] = useState<Map<string, number>>(new Map())
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [presetName, setPresetName] = useState('')

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const updated = [
      ...presets.filter(p => p.name !== name),
      { name, config, savedAt: new Date().toLocaleString('fr-FR') }
    ]
    setPresets(updated)
    savePresets(updated)
    setPresetName('')
  }

  const loadPreset = (p: Preset) => {
    // Deep-merge with emptyConfig so old presets without new fields still work
    setConfig({
      ...emptyConfig,
      ...p.config,
      base:       { ...emptyConfig.base,       ...p.config.base },
      highlight:  { ...emptyConfig.highlight,  ...p.config.highlight },
      highlight2: { ...emptyConfig.highlight2, ...(p.config as any).highlight2 },
      effects: { ...emptyConfig.effects, ...p.config.effects, shadow_targets: { ...emptyConfig.effects.shadow_targets, ...(p.config.effects as any).shadow_targets }, glow_targets: { ...emptyConfig.effects.glow_targets, ...(p.config.effects as any).glow_targets } },
      layout:     { ...emptyConfig.layout,     ...p.config.layout },
    })
  }

  const deletePreset = (name: string) => {
    const updated = presets.filter(p => p.name !== name)
    setPresets(updated)
    savePresets(updated)
  }

  useEffect(() => {
    const load = async () => {
      const [fontsRes, cfgRes] = await Promise.all([
        fetch(`${API_BASE}/api/fonts`),
        fetch(`${API_BASE}/api/default-config`)
      ])
      if (fontsRes.ok) {
        const data = await fontsRes.json()
        setFonts(data.fonts || [])
      }
      if (cfgRes.ok) {
        const data = await cfgRes.json()
        setConfig({
          ...emptyConfig,
          ...data,
          base: { ...emptyConfig.base, ...(data.base ?? {}) },
          highlight: { ...emptyConfig.highlight, ...(data.highlight ?? {}) },
          highlight2: { ...emptyConfig.highlight2, ...(data.highlight2 ?? {}) },
          effects: {
            ...emptyConfig.effects,
            ...(data.effects ?? {}),
            shadow_targets: { ...emptyConfig.effects.shadow_targets, ...((data.effects ?? {}).shadow_targets ?? {}) },
            glow_targets: { ...emptyConfig.effects.glow_targets, ...((data.effects ?? {}).glow_targets ?? {}) },
          },
          layout: { ...emptyConfig.layout, ...(data.layout ?? {}) },
        })
      }
    }
    load().catch(() => setMessage('API non joignable (lance uvicorn api:app --reload --port 8000)'))
  }, [])

  const runAction = async (mode: 'preview' | 'render-preview' | 'render-full') => {
    if (!videoFile || !subsFile) {
      setMessage('Ajoute vidéo + sous-titres')
      return
    }
    setBusy(true)
    setMessage(mode === 'preview' ? 'Génération preview…' : 'Rendu vidéo…')
    // Build subtitle blob explicitly with filename — more reliable than passing a File object directly
    const srtContent = captions.length > 0
      ? serializeSRT(captions, highlighted)
      : await subsFile.text()
    const srtBlob = new Blob([srtContent], { type: 'text/plain' })
    const jobId = Date.now().toString()
    let pollTimer: ReturnType<typeof setInterval> | null = null
    if (mode !== 'preview') {
      setRenderProgress(0)
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/api/render-progress/${jobId}`)
          if (r.ok) {
            const d = await r.json()
            if (d.found) setRenderProgress(d.progress)
          }
        } catch { /* ignore */ }
      }, 400)
    }
    try {
      const form = new FormData()
      form.append('video', videoFile)
      form.append('subtitles', srtBlob, subsFile.name)
      form.append('config', JSON.stringify(config))

      if (mode === 'preview') {
        const res = await fetch(`${API_BASE}/api/preview`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        setPreviewUrl(`${API_BASE}${data.imageUrl}?t=${Date.now()}`)
        setMessage('Preview OK')
      } else {
        form.append('preview_mode', mode === 'render-preview' ? 'true' : 'false')
        form.append('job_id', jobId)
        const res = await fetch(`${API_BASE}/api/render`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        setVideoUrl(`${API_BASE}${data.videoUrl}?t=${Date.now()}`)
        setRenderProgress(1)
        setMessage(mode === 'render-preview' ? 'Render preview 6s OK' : 'Render full OK')
      }
    } catch (error) {
      setMessage(`Erreur: ${String(error)}`)
    } finally {
      if (pollTimer) clearInterval(pollTimer)
      setBusy(false)
      setTimeout(() => setRenderProgress(-1), 1200)
    }
  }

  const toggleWord = (key: string) => {
    setHighlighted(prev => {
      const next = new Map(prev)
      const current = next.get(key)
      if (current === undefined) {
        next.set(key, 0) // not highlighted → group 0
      } else if (current === 0 && config.highlight2.enabled) {
        next.set(key, 1) // group 0 → group 1 (only if HL2 enabled)
      } else {
        next.delete(key) // group 0/1 → off
      }
      return next
    })
  }

  /** Derive label for a highlight chip: word text + group */
  const highlightChips = useMemo(() => {
    return Array.from(highlighted.entries()).map(([key, group]) => {
      const [ciStr, wiStr] = key.split('-')
      const cap = captions.find(c => c.index === parseInt(ciStr))
      const word = cap ? cap.text.trim().split(/\s+/)[parseInt(wiStr)] ?? key : key
      return { key, label: word, group }
    })
  }, [highlighted, captions])

  const status = useMemo(() => {
    const effects = [
      config.effects.shadow_enabled ? 'Ombre' : null,
      config.effects.glow_enabled ? 'Lueur' : null,
      highlighted.size > 0 ? `Highlight (${highlighted.size})` : null
    ].filter(Boolean)
    return effects.length ? `Actifs : ${effects.join(' • ')}` : 'Aucun effet actif'
  }, [config.effects.shadow_enabled, config.effects.glow_enabled, highlighted.size])

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-brand">
          <Film size={20}/>
          <h1>Subtitle Engine<span>moteur Python local</span></h1>
        </div>
        <div className="top-actions">
          <button className="btn-ghost" onClick={() => setConfig(emptyConfig)}>Reset</button>
          <button className="btn-primary" disabled={busy} onClick={() => runAction('render-full')}><Film size={14}/>Render Full</button>
        </div>
      </header>

      <main className="layout">
        <section className="left-col">
          {/* Tab bar */}
          <div className="tab-bar">
            <button className={`tab-btn${tab === 'render' ? ' active' : ''}`} onClick={() => setTab('render')}>
              <Settings2 size={14}/>Rendu
            </button>
            <button className={`tab-btn${tab === 'captions' ? ' active' : ''}`} onClick={() => setTab('captions')}>
              <FileText size={14}/>Captions
              {captions.length > 0 && <span className="tab-badge">{captions.length}</span>}
            </button>
          </div>

          {tab === 'render' && <>
          <Card title="Médias" subtitle="Import vidéo + sous-titres" icon={<Upload size={15}/>}>
            <div className="grid two">
              <Field label="Vidéo">
                <input type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Sous-titres (.srt/.json)">
                <input type="file" accept=".srt,.json" onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setSubsFile(f)
                  if (f && f.name.endsWith('.srt')) {
                    f.text().then(txt => setCaptions(parseSRT(txt)))
                  } else {
                    setCaptions([])
                  }
                }} />
              </Field>
            </div>
          </Card>

          <Card title="Typo Base" icon={<Type size={15}/>}>
            <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
              <Field label="Police">
                <select value={config.base.font} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, font: e.target.value } }))}>
                  {fonts.map(f => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Couleur">
                <input type="color" value={config.base.color} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, color: e.target.value } }))} />
              </Field>
            </div>
            <div className="grid three">
              <Field label="Taille" value={`${Math.round(config.base.size_ratio * 1080)}px`}>
                <input type="range" min={10} max={200} step={1} value={Math.round(config.base.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, size_ratio: Number(e.target.value) / 1080 } }))} />
              </Field>
              <Field label="Espacement" value={`${config.base.spacing.toFixed(1)}px`}>
                <input type="range" min={-5} max={20} step={0.5} value={config.base.spacing} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, spacing: Number(e.target.value) } }))} />
              </Field>
              <Field label="Contour" value={`${config.base.outline.toFixed(1)}px`}>
                <input type="range" min={0} max={20} step={0.5} value={config.base.outline} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, outline: Number(e.target.value) } }))} />
              </Field>
            </div>
            <div className="checks-row">
              <label><input type="checkbox" checked={config.base.bold} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
              <label><input type="checkbox" checked={config.base.italic} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
            </div>
            <Field label="Casse">
              <select value={config.base.text_transform} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, text_transform: e.target.value as ConfigState['base']['text_transform'] } }))}>
                <option value="none">Original</option>
                <option value="lower">minuscule</option>
                <option value="upper">MAJUSCULE</option>
                <option value="title">Titre</option>
              </select>
            </Field>
          </Card>

          <Card title="Typo Highlight" icon={<Layers size={15}/>}>
            <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
              <Field label="Police">
                <select value={config.highlight.font} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, font: e.target.value } }))}>
                  {fonts.map(f => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Couleur">
                <input type="color" value={config.highlight.color} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, color: e.target.value } }))} />
              </Field>
            </div>
            <div className="grid three">
              <Field label="Taille" value={`${Math.round(config.highlight.size_ratio * 1080)}px`}>
                <input type="range" min={10} max={200} step={1} value={Math.round(config.highlight.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, size_ratio: Number(e.target.value) / 1080 } }))} />
              </Field>
              <Field label="Espacement" value={`${config.highlight.spacing.toFixed(1)}px`}>
                <input type="range" min={-5} max={20} step={0.5} value={config.highlight.spacing} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, spacing: Number(e.target.value) } }))} />
              </Field>
              <Field label="Contour" value={`${config.highlight.outline.toFixed(1)}px`}>
                <input type="range" min={0} max={20} step={0.5} value={config.highlight.outline} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, outline: Number(e.target.value) } }))} />
              </Field>
            </div>
            <div className="checks-row">
              <label><input type="checkbox" checked={config.highlight.bold} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
              <label><input type="checkbox" checked={config.highlight.italic} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
            </div>
            <Field label="Casse">
              <select value={config.highlight.text_transform} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, text_transform: e.target.value as ConfigState['highlight']['text_transform'] } }))}>
                <option value="none">Original</option>
                <option value="lower">minuscule</option>
                <option value="upper">MAJUSCULE</option>
                <option value="title">Titre</option>
              </select>
            </Field>
          </Card>

          <Card title="Highlight 2" icon={<Layers size={15}/>}>
            <label className="toggle-row" style={{marginBottom: config.highlight2.enabled ? 10 : 0}}>
              <input type="checkbox" checked={config.highlight2.enabled} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, enabled: e.target.checked } }))} />
              <span className="toggle-label">Activer un 2ᵉ style highlight</span>
            </label>
            {config.highlight2.enabled && (
              <>
                <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
                  <Field label="Police">
                    <select value={config.highlight2.font} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, font: e.target.value } }))}>
                      {fonts.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </Field>
                  <Field label="Couleur">
                    <input type="color" value={config.highlight2.color} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, color: e.target.value } }))} />
                  </Field>
                </div>
                <div className="grid three">
                  <Field label="Taille" value={`${Math.round(config.highlight2.size_ratio * 1080)}px`}>
                    <input type="range" min={10} max={200} step={1} value={Math.round(config.highlight2.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, size_ratio: Number(e.target.value) / 1080 } }))} />
                  </Field>
                  <Field label="Espacement" value={`${config.highlight2.spacing.toFixed(1)}px`}>
                    <input type="range" min={-5} max={20} step={0.5} value={config.highlight2.spacing} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, spacing: Number(e.target.value) } }))} />
                  </Field>
                  <Field label="Contour" value={`${config.highlight2.outline.toFixed(1)}px`}>
                    <input type="range" min={0} max={20} step={0.5} value={config.highlight2.outline} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, outline: Number(e.target.value) } }))} />
                  </Field>
                </div>
                <div className="checks-row">
                  <label><input type="checkbox" checked={config.highlight2.bold} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
                  <label><input type="checkbox" checked={config.highlight2.italic} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
                </div>
                <Field label="Casse">
                  <select value={config.highlight2.text_transform} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, text_transform: e.target.value as ConfigState['highlight2']['text_transform'] } }))}>
                    <option value="none">Original</option>
                    <option value="lower">minuscule</option>
                    <option value="upper">MAJUSCULE</option>
                    <option value="title">Titre</option>
                  </select>
                </Field>
              </>
            )}
          </Card>

          <Card title="Effets" icon={<Sparkles size={15}/>}>
            <div className="effect-block">
              <label className="toggle-row">
                <input type="checkbox" checked={config.effects.shadow_enabled} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_enabled: e.target.checked } }))} />
                <span className="toggle-label">Ombre portée</span>
              </label>
              {config.effects.shadow_enabled && (
                <div className="effect-fields">
                  <div className="grid five">
                    <Field label="Distance" value={`${config.effects.shadow_distance}px`}><input type="range" min={0} max={50} step={0.5} value={config.effects.shadow_distance} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_distance: Number(e.target.value) } }))} /></Field>
                    <Field label="Flou" value={`${config.effects.shadow_blur}px`}><input type="range" min={0} max={20} step={0.1} value={config.effects.shadow_blur} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_blur: Number(e.target.value) } }))} /></Field>
                    <Field label="Angle" value={`${config.effects.shadow_angle}°`}><input type="range" min={-180} max={180} step={1} value={config.effects.shadow_angle} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_angle: Number(e.target.value) } }))} /></Field>
                    <Field label="Opacité" value={config.effects.shadow_alpha}><input type="range" min={0} max={1} step={0.01} value={config.effects.shadow_alpha} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_alpha: Number(e.target.value) } }))} /></Field>
                    <Field label="Couleur"><input type="color" value={config.effects.shadow_color} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_color: e.target.value } }))} /></Field>
                  </div>
                  <div className="checks-row">
                    <span style={{fontSize:11, fontWeight:600, color:'var(--text-2)', alignSelf:'center'}}>Appliquer à :</span>
                    <label><input type="checkbox" checked={config.effects.shadow_targets.base} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, base: e.target.checked } } }))} />Base</label>
                    <label><input type="checkbox" checked={config.effects.shadow_targets.highlight} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, highlight: e.target.checked } } }))} />Highlight 1</label>
                    <label><input type="checkbox" checked={config.effects.shadow_targets.highlight2} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, highlight2: e.target.checked } } }))} />Highlight 2</label>
                  </div>
                </div>
              )}
            </div>
            <div className="effect-block">
              <label className="toggle-row">
                <input type="checkbox" checked={config.effects.glow_enabled} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_enabled: e.target.checked } }))} />
                <span className="toggle-label">Lueur (glow)</span>
              </label>
              {config.effects.glow_enabled && (
                <div className="effect-fields">
                  <div className="grid two">
                    <Field label="Intensité" value={config.effects.glow_intensity}><input type="range" min={0} max={8} step={0.1} value={config.effects.glow_intensity} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_intensity: Number(e.target.value) } }))} /></Field>
                    <Field label="Couleur">
                      <input type="color" value={config.effects.glow_color} disabled={config.effects.glow_color_auto} style={{opacity: config.effects.glow_color_auto ? 0.3 : 1, cursor: config.effects.glow_color_auto ? 'not-allowed' : 'pointer'}} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_color: e.target.value } }))} />
                    </Field>
                  </div>
                  <div className="checks-row">
                    <label><input type="checkbox" checked={config.effects.glow_color_auto} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_color_auto: e.target.checked } }))} />Couleur du texte auto</label>
                  </div>
                  <div className="checks-row">
                    <span style={{fontSize:11, fontWeight:600, color:'var(--text-2)', alignSelf:'center'}}>Appliquer à :</span>
                    <label><input type="checkbox" checked={config.effects.glow_targets.base} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, base: e.target.checked } } }))} />Base</label>
                    <label><input type="checkbox" checked={config.effects.glow_targets.highlight} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, highlight: e.target.checked } } }))} />Highlight 1</label>
                    <label><input type="checkbox" checked={config.effects.glow_targets.highlight2} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, highlight2: e.target.checked } } }))} />Highlight 2</label>
                  </div>
                </div>
              )}
            </div>
          </Card>
          </>
          }

          {tab === 'captions' && (
            <Card title="Éditeur de captions" subtitle="Cliquez les mots pour les highlight" icon={<FileText size={15}/>}>
              {/* Keyword chips */}
              <div>
                <div className="field-label" style={{marginBottom:6}}>Mots highlight actifs</div>
                <div className="kw-chips">
                  {highlightChips.length === 0
                    ? <span className="kw-empty">Aucun — cliquez un mot ci-dessous</span>
                    : highlightChips.map(({ key, label, group }) => (
                        <span key={key} className={`kw-chip${group === 1 ? ' kw-chip-2' : ''}`}>
                          {label}
                          <button onClick={() => toggleWord(key)} title="Retirer"><X size={10}/></button>
                        </span>
                      ))
                  }
                </div>
              </div>
              <CaptionEditor
                captions={captions}
                onChange={setCaptions}
                highlighted={highlighted}
                onToggleWord={toggleWord}
                baseTransform={config.base.text_transform}
                highlight2Enabled={config.highlight2.enabled}
              />
            </Card>
          )}
        </section>

        <aside className="right-col">
          <Card title="Presets" subtitle="Styles sauvegardés" icon={<BookMarked size={15}/>}>
            <div className="preset-save-row">
              <input
                type="text"
                placeholder="Nom du preset…"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePreset()}
              />
              <button onClick={savePreset} title="Sauvegarder"><Save size={13}/>Sauvegarder</button>
            </div>
            <div className="preset-list">
              {presets.length === 0
                ? <div className="preset-empty">Aucun preset sauvegardé</div>
                : [...presets].reverse().map(p => (
                  <div key={p.name} className="preset-item">
                    <span className="preset-item-name">{p.name}</span>
                    <span className="preset-item-meta">{p.savedAt}</span>
                    <button className="preset-load" onClick={() => loadPreset(p)}>Charger</button>
                    <button className="preset-delete" onClick={() => deletePreset(p.name)}><X size={11}/></button>
                  </div>
                ))
              }
            </div>
          </Card>

          <Card title="Preview" subtitle={status} icon={<Eye size={15}/>}>
            {previewUrl ? <img className="preview-image" src={previewUrl} alt="preview" /> : <div className="preview-placeholder">Aucun preview</div>}
            <div className="actions-row">
              <button disabled={busy} onClick={() => runAction('preview')}><Eye size={13}/>Preview</button>
              <button disabled={busy} onClick={() => runAction('render-preview')}><Film size={13}/>Render 6s</button>
            </div>
            <Field label="Profil d'export">
              <select value={config.export_profile} onChange={e => setConfig(c => ({ ...c, export_profile: e.target.value as ConfigState['export_profile'] }))}>
                <option value="draft">Rapide (8 Mb/s)</option>
                <option value="balanced">Équilibré (12 Mb/s)</option>
                <option value="final">Max (16 Mb/s)</option>
              </select>
            </Field>
            <div className="status-line">
              <span className={`status-dot ${busy ? 'run' : message.startsWith('Erreur') ? 'err' : 'ok'}`}/>
              {message}
            </div>
            {renderProgress >= 0 && (
              <div className="render-progress-track">
                <div className="render-progress-bar" style={{ width: `${Math.round(renderProgress * 100)}%` }} />
              </div>
            )}
            {videoUrl ? <video className="preview-video" controls src={videoUrl} /> : null}
          </Card>

          <Card title="Layout" icon={<LayoutTemplate size={15}/>}>
            <div className="grid two">
              <Field label="Position">
                <select value={config.layout.anchor} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, anchor: e.target.value as ConfigState['layout']['anchor'] } }))}>
                  <option value="bottom">Bas</option>
                  <option value="center">Centre</option>
                  <option value="top">Haut</option>
                </select>
              </Field>
              <Field label="Nb lignes max" value={config.layout.max_lines}>
                <input type="range" min={1} max={4} step={1} value={config.layout.max_lines} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, max_lines: Number(e.target.value) } }))} />
              </Field>
            </div>
            <Field label="Décalage vertical" value={config.layout.vertical_offset === 0 ? 'Centre' : config.layout.vertical_offset > 0 ? `+${Math.round(config.layout.vertical_offset * 100)}%` : `${Math.round(config.layout.vertical_offset * 100)}%`}>
              <input type="range" min={-0.4} max={0.4} step={0.01} value={config.layout.vertical_offset} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, vertical_offset: Number(e.target.value) } }))} />
            </Field>
            <div className="grid three">
              <Field label="Interline" value={`${(1 + config.layout.line_gap).toFixed(2)}×`}>
                <input type="range" min={0.20} max={3.00} step={0.05} value={1 + config.layout.line_gap} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, line_gap: Number(e.target.value) - 1 } }))} />
              </Field>
              <Field label="Largeur max" value={config.layout.max_width_ratio >= 1.0 ? 'Auto' : `${Math.round(config.layout.max_width_ratio * 100)}%`}>
                <input type="range" min={0.3} max={1.0} step={0.05} value={config.layout.max_width_ratio} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, max_width_ratio: Number(e.target.value) } }))} />
              </Field>
              <Field label="Preview (s)">
                <input type="number" min={0} value={config.preview_time} onChange={e => setConfig(c => ({ ...c, preview_time: Number(e.target.value) }))} />
              </Field>
            </div>
            <div className="grid two">
              <Field label="Animation">
                <select value={config.animation} onChange={e => setConfig(c => ({ ...c, animation: e.target.value as ConfigState['animation'] }))}>
                  <option value="none">Aucune</option>
                  <option value="reveal">Machine à écrire</option>
                  <option value="appear">Apparition mot à mot</option>
                  <option value="fade_pop">Fade + pop</option>
                  <option value="slide_in">Slide in</option>
                </select>
              </Field>
              <Field label="">
                <label style={{display:'flex',alignItems:'center',gap:6,marginTop:18,fontSize:12}}>
                  <input type="checkbox" checked={config.animation_enabled} onChange={e => setConfig(c => ({ ...c, animation_enabled: e.target.checked }))} />
                  Activer
                </label>
              </Field>
            </div>
          </Card>
        </aside>
      </main>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useJobEvent } from '@/lib/hooks/jobEventBus'
import { useJobPolling } from '@/lib/hooks/useJobPolling'
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  Film, Type, Sparkles, LayoutTemplate, Eye,
  Bold, Italic, Upload, Layers, FileText, Settings2, X, Save, ChevronLeft
} from 'lucide-react'
import CaptionsCard from '@/components/captions/CaptionsCard'
import { CaptionsField } from '@/components/captions/CaptionsField'
import CaptionEditor from '@/components/captions/CaptionEditor'
import { getNextHighlightGroup } from '@/lib/captionHighlightCycle'
import { DEFAULT_CAPTION_CONFIG, mergeCaptionConfig, type CaptionConfigState } from '@/lib/captionPresetConfig'
import { Caption, parseSRT, serializeSRT } from '@/lib/srt'

const API_BASE = '/api/captions'

type ConfigState = CaptionConfigState

/** Preset stocké en base de données */
type Preset = {
  id: string
  name: string
  isBuiltin: boolean
  config: ConfigState
  createdAt: string
}

const emptyConfig: ConfigState = DEFAULT_CAPTION_CONFIG

// ── Session persistence ───────────────────────────────────────────────────────
// Survit à la navigation inter-onglets. TTL = 10 min.
// On stocke : config, captions, highlights, contenu SRT.
// La vidéo (lourd binaire) n'est pas stockée.
const SESSION_KEY = 'captions_draft_v1'
const SESSION_TTL = 10 * 60 * 1000

type SessionDraft = {
  savedAt: number
  config: ConfigState
  captions: Caption[]
  highlights: [string, number][]  // Map sérialisée
  subsText: string                // contenu texte SRT
  subsFileName: string
}

function loadDraft(): SessionDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as SessionDraft
    if (Date.now() - draft.savedAt > SESSION_TTL) { sessionStorage.removeItem(SESSION_KEY); return null }
    return draft
  } catch { return null }
}

function saveDraft(d: Omit<SessionDraft, 'savedAt'>) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...d, savedAt: Date.now() })) } catch { /* quota */ }
}

function clearDraft() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

export default function CaptionsApp({
  isAdmin = false,
  initialPresetId,
  backUrl,
}: {
  isAdmin?: boolean
  initialPresetId?: string
  backUrl?: string
}) {
  // Charger le brouillon une seule fois au montage
  const draft = useMemo(() => loadDraft(), [])

  const [fonts, setFonts] = useState<string[]>([])
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [subsFile, setSubsFile] = useState<File | null>(null)
  const [captions, setCaptions] = useState<Caption[]>(() => draft?.captions ?? [])
  const [config, setConfig] = useState<ConfigState>(() => draft ? mergeCaptionConfig(draft.config) : emptyConfig)
  const [previewUrl, setPreviewUrl] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Prêt')
  const [renderProgress, setRenderProgress] = useState(-1)
  const [tab, setTab] = useState<'render' | 'captions'>('render')
  const [highlighted, setHighlighted] = useState<Map<string, number>>(
    () => draft ? new Map(draft.highlights) : new Map()
  )
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(true)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [loadedPresetName, setLoadedPresetName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  // Mémo du nom de fichier SRT restauré (pour ré-affichage)
  const [restoredSubsFileName] = useState<string>(() => draft?.subsFileName ?? '')
  const [draftBanner, setDraftBanner] = useState<boolean>(() => !!draft)

  const initialLoadDone = useRef(false)
  // Job en attente de complétion RunPod (null = pas de render en cours)
  const [renderingJobId, setRenderingJobId] = useState<string | null>(null)
  // Mode du render en cours (nécessaire pour le message de completion)
  const renderingModeRef = useRef<'render-preview' | 'render-full'>('render-full')

  const fetchPresets = async () => {
    try {
      const res = await fetch('/api/caption-presets')
      if (res.ok) setPresets(await res.json() as Preset[])
    } finally {
      setPresetsLoading(false)
    }
  }

  const updatePreset = async () => {
    if (!initialPresetId) return
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch(`/api/caption-presets/${initialPresetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      setSaveStatus(res.ok ? 'ok' : 'err')
    } catch {
      setSaveStatus('err')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }

  const loadPreset = (p: Preset) => {
    setConfig(mergeCaptionConfig(p.config))
  }

  useEffect(() => {
    // Fonts + presets DB : toujours disponibles, indépendant de l'API Python
    fetch('/api/caption-fonts')
      .then(r => r.ok ? r.json() as Promise<{ fonts: string[] }> : Promise.reject())
      .then(d => setFonts(d.fonts ?? []))
      .catch(() => { /* fallback géré côté serveur */ })

    void fetchPresets()

    // Config par défaut depuis l'API Python (optionnel — pas bloquant).
    // Si un brouillon a été restauré on ne l'écrase pas.
    if (!draft) {
      fetch(`${API_BASE}/api/default-config`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((data) => {
          setConfig(mergeCaptionConfig(data as Partial<ConfigState>))
        })
        .catch(() => setMessage('⚠ API captions non joignable — lance : docker compose up render-engine'))
    } else {
      // API non joignable ? On signale discrètement
      fetch(`${API_BASE}/api/default-config`).catch(() =>
        setMessage('⚠ API captions non joignable — lance : docker compose up render-engine')
      )
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load an initial preset (when coming from the gallery "Éditer" button)
  useEffect(() => {
    if (!initialPresetId || presets.length === 0 || initialLoadDone.current) return
    const p = presets.find(x => x.id === initialPresetId)
    if (p) { loadPreset(p); setLoadedPresetName(p.name); initialLoadDone.current = true }
  }, [presets, initialPresetId])

  // ── SSE fast path — résolution immédiate via webhook ──────────────────────
  const jobEvent = useJobEvent(renderingJobId ?? '')
  useEffect(() => {
    if (!jobEvent || jobEvent.jobType !== 'captions' || !renderingJobId) return
    if (jobEvent.status === 'COMPLETED' || jobEvent.status === 'DONE') {
      setVideoUrl(typeof jobEvent.videoUrl === 'string' ? jobEvent.videoUrl : '')
      setRenderProgress(1)
      setMessage(renderingModeRef.current === 'render-preview' ? 'Render preview 6s OK' : 'Render complet OK')
      setRenderingJobId(null)
      setBusy(false)
      setTimeout(() => setRenderProgress(-1), 1500)
    } else if (jobEvent.status === 'FAILED') {
      setMessage(`Erreur rendu : ${String(jobEvent.errorMsg ?? 'Rendu échoué')}`)
      setRenderingJobId(null)
      setBusy(false)
      setTimeout(() => setRenderProgress(-1), 1500)
    }
  }, [jobEvent, renderingJobId])

  // ── Polling fallback (10 s) — actif uniquement si SSE indisponible ─────────
  const { data: pollData } = useJobPolling<{ status: string; videoUrl?: string; outputUrl?: string; error?: string }>({
    fetchFn: () => fetch(`/api/render/captions/${renderingJobId}`).then(r => r.json()),
    isTerminal: (d) => d.status === 'COMPLETED' || d.status === 'DONE' || d.status === 'FAILED',
    intervalMs: 10000,
    enabled: renderingJobId !== null,
  })
  useEffect(() => {
    if (!pollData || !renderingJobId) return
    if (pollData.status === 'COMPLETED' || pollData.status === 'DONE') {
      setVideoUrl(pollData.videoUrl ?? pollData.outputUrl ?? '')
      setRenderProgress(1)
      setMessage(renderingModeRef.current === 'render-preview' ? 'Render preview 6s OK' : 'Render complet OK')
      setRenderingJobId(null)
      setBusy(false)
      setTimeout(() => setRenderProgress(-1), 1500)
    } else if (pollData.status === 'FAILED') {
      setMessage(`Erreur rendu : ${pollData.error ?? 'Rendu échoué'}`)
      setRenderingJobId(null)
      setBusy(false)
      setTimeout(() => setRenderProgress(-1), 1500)
    } else {
      setRenderProgress(p => Math.min(p + 0.02, 0.9))
      setMessage(pollData.status === 'PROCESSING' ? 'Rendu en cours…' : 'En file d\'attente…')
    }
  }, [pollData, renderingJobId])

  // Sauvegarde automatique du brouillon (debounce 800ms)
  useEffect(() => {
    if (captions.length === 0 && highlighted.size === 0) return
    const timer = setTimeout(() => {
      saveDraft({
        config,
        captions,
        highlights: Array.from(highlighted.entries()),
        subsText: serializeSRT(captions, highlighted),
        subsFileName: subsFile?.name ?? restoredSubsFileName,
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [config, captions, highlighted, subsFile, restoredSubsFileName])

  const runAction = async (mode: 'preview' | 'render-preview' | 'render-full') => {
    // subsFile optionnel si les captions sont déjà chargées (brouillon restauré ou édité)
    if (!videoFile) { setMessage('Ajoute une vidéo'); return }
    if (!subsFile && captions.length === 0) { setMessage('Ajoute les sous-titres (.srt)'); return }
    setBusy(true)
    setMessage(mode === 'preview' ? 'Génération preview…' : 'Rendu vidéo en cours…')
    const srtContent = captions.length > 0
      ? serializeSRT(captions, highlighted)
      : await subsFile!.text()
    const srtBlob = new Blob([srtContent], { type: 'text/plain' })
    const srtFileName = subsFile?.name ?? (restoredSubsFileName || 'captions.srt')

    // ── Preview image : appel direct Python API (rapide) ────────────────────
    if (mode === 'preview') {
      try {
        const form = new FormData()
        form.append('video', videoFile)
        form.append('subtitles', srtBlob, srtFileName)
        form.append('config', JSON.stringify(config))
        const res = await fetch(`${API_BASE}/api/preview`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        setPreviewUrl(`${API_BASE}${data.imageUrl}?t=${Date.now()}`)
        setMessage('Preview OK')
      } catch (error) {
        setMessage(`Erreur preview : ${String(error)}`)
      } finally {
        setBusy(false)
      }
      return
    }

    // ── Render vidéo : via RunPod ─────────────────────────────────────────
    setRenderProgress(0.05)
    // Simulate slow progress while the local render engine works synchronously.
    // In RunPod mode the polling loop overrides this with real increments.
    let fakeProgressVal = 0.05
    const fakeProgressTimer = setInterval(() => {
      fakeProgressVal = Math.min(fakeProgressVal + 0.008, 0.88)
      setRenderProgress(fakeProgressVal)
    }, 800)
    // Set to true when we hand off to SSE/polling — finally block must NOT reset busy
    let submittedToRunPod = false
    try {
      // ── Mode RunPod : URL présignée (upload direct browser → R2) ─────────
      // Essayer le mode presigned d'abord ; 503 = fallback multipart (local)
      const prepRes = await fetch('/api/render/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename:    videoFile.name,
          ext:         videoFile.name.split('.').pop()?.toLowerCase() ?? 'mp4',
          srtContent,
          srtFilename,
          config,
          previewMode: mode === 'render-preview',
        }),
      })

      let captionJobId: string
      let immediateVideoUrl: string | undefined

      if (prepRes.ok) {
        const { captionJobId: jobId, uploadUrl } = await prepRes.json() as { captionJobId: string; uploadUrl: string }
        captionJobId = jobId

        // Upload direct vers R2 — contourne le serveur Next.js
        setMessage('Upload vidéo…')
        setRenderProgress(0.25)
        const r2Res = await fetch(uploadUrl, {
          method: 'PUT',
          body: videoFile,
          headers: { 'Content-Type': videoFile.type || 'video/mp4' },
        })
        if (!r2Res.ok) throw new Error(`Upload R2 échoué : ${r2Res.status}`)

        // Soumettre à RunPod
        setMessage('Soumission RunPod…')
        setRenderProgress(0.45)
        const submitRes = await fetch(`/api/render/captions/${captionJobId}/submit`, { method: 'POST' })
        if (!submitRes.ok) {
          const err = await submitRes.json().catch(() => ({ error: submitRes.statusText })) as { error?: string }
          throw new Error(err.error ?? submitRes.statusText)
        }
      } else if (prepRes.status === 503) {
        // ── Mode local (USE_RUNPOD=false) : fallback multipart ───────────────
        const form = new FormData()
        form.append('video', videoFile)
        form.append('subtitles', srtBlob, srtFileName)
        form.append('config', JSON.stringify(config))
        form.append('preview_mode', mode === 'render-preview' ? 'true' : 'false')
        const fallbackRes = await fetch('/api/render/captions', { method: 'POST', body: form })
        if (!fallbackRes.ok) {
          const err = await fallbackRes.json().catch(() => ({ error: fallbackRes.statusText })) as { error?: string }
          throw new Error(err.error ?? fallbackRes.statusText)
        }
        const fallbackData = await fallbackRes.json() as { captionJobId?: string; videoUrl?: string }
        captionJobId = fallbackData.captionJobId!
        immediateVideoUrl = fallbackData.videoUrl
      } else {
        const err = await prepRes.json().catch(() => ({ error: prepRes.statusText })) as { error?: string }
        throw new Error(err.error ?? prepRes.statusText)
      }

      // ── Mode local : videoUrl déjà dans la réponse ───────────────────────
      if (immediateVideoUrl) {
        setVideoUrl(immediateVideoUrl)
        setRenderProgress(1)
        setMessage(mode === 'render-preview' ? 'Render preview 6s OK' : 'Render complet OK')
        return
      }

      setMessage('Job RunPod soumis — en attente du résultat…')
      setRenderProgress(0.5)
      clearInterval(fakeProgressTimer) // stop fake progress, SSE/polling takes over

      // ── Mode RunPod : SSE primaire + polling fallback 10s ────────────────
      submittedToRunPod = true
      renderingModeRef.current = mode as 'render-preview' | 'render-full'
      setRenderingJobId(captionJobId!)
      // Effects above will handle busy state + videoUrl when job completes
      return
    } catch (error) {
      setMessage(`Erreur rendu : ${String(error)}`)
    } finally {
      clearInterval(fakeProgressTimer)
      // If handed off to RunPod (SSE/polling), busy + progress are managed by completion effects
      if (!submittedToRunPod) {
        setBusy(false)
        setTimeout(() => setRenderProgress(-1), 1500)
      }
    }
  }

  const toggleWord = (key: string) => {
    setHighlighted(prev => {
      const next = new Map(prev)
      const current = next.get(key)
      const nextGroup = getNextHighlightGroup(current, config.highlight2.enabled)
      if (nextGroup === undefined) next.delete(key)
      else next.set(key, nextGroup)
      return next
    })
  }

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
      config.effects.outline_enabled ? 'Contour' : null,
      highlighted.size > 0 ? `Highlight (${highlighted.size})` : null,
    ].filter(Boolean)
    return effects.length ? `Actifs : ${effects.join(' • ')}` : 'Aucun effet actif'
  }, [config.effects.shadow_enabled, config.effects.glow_enabled, config.effects.outline_enabled, highlighted.size])

  const F = CaptionsField

  // ── Mode simplifié (non-admin) ─────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <UserCaptionsMode
        presets={presets}
        presetsLoading={presetsLoading}
        selectedPresetId={selectedPresetId}
        onSelectPreset={(p) => { setSelectedPresetId(p.id); loadPreset(p) }}
        videoFile={videoFile}
        onVideoChange={setVideoFile}
        subsFile={subsFile}
        captions={captions}
        restoredSubsFileName={restoredSubsFileName}
        onSubsChange={(f) => {
          setSubsFile(f)
          if (f && f.name.endsWith('.srt')) { f.text().then(txt => setCaptions(parseSRT(txt))) }
          else { setCaptions([]) }
        }}
        exportProfile={config.export_profile}
        onExportProfileChange={(v) => setConfig(c => ({ ...c, export_profile: v }))}
        busy={busy}
        message={message}
        renderProgress={renderProgress}
        videoUrl={videoUrl}
        onRender={() => runAction('render-full')}
        onReset={() => {
          setVideoFile(null); setSubsFile(null); setCaptions([])
          setVideoUrl(''); setSelectedPresetId(null); clearDraft()
        }}
      />
    )
  }

  return (
    <div className="cx">
      <div className="cx-page">
        {/* Page header — matches app style */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {backUrl && (
              <Link href={backUrl} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors mr-1">
                <ChevronLeft size={14}/>Retour
              </Link>
            )}
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center text-white shrink-0">
              <Film size={20}/>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {loadedPresetName ?? (initialPresetId ? 'Modifier le preset' : 'Nouveau preset')}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Réglez la typo, les effets et le placement des sous-titres</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                  {loadedPresetName ? 'Preset chargé' : initialPresetId ? 'Preset existant' : 'Nouveau preset'}
                </span>
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
                  {captions.length} bloc{captions.length > 1 ? 's' : ''}
                </span>
                <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
                  {highlighted.size} mot{highlighted.size > 1 ? 's' : ''} en highlight
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors bg-white"
              onClick={() => {
                setConfig(emptyConfig)
                setCaptions([])
                setHighlighted(new Map())
                setVideoFile(null)
                setSubsFile(null)
                setPreviewUrl('')
                setVideoUrl('')
                setDraftBanner(false)
                clearDraft()
              }}
            >
              Réinitialiser
            </button>
            {initialPresetId && (
              <button
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg disabled:opacity-60 transition-colors font-medium ${
                  saveStatus === 'ok' ? 'bg-green-600 text-white' :
                  saveStatus === 'err' ? 'bg-red-500 text-white' :
                  'border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                }`}
                disabled={saving}
                onClick={() => void updatePreset()}
              >
                <Save size={13}/>{saving ? 'Sauvegarde…' : saveStatus === 'ok' ? 'Sauvegardé ✓' : saveStatus === 'err' ? 'Erreur' : 'Enregistrer'}
              </button>
            )}
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-60 transition-colors font-medium"
              disabled={busy}
              onClick={() => runAction('render-full')}
            >
              <Film size={13}/>Rendu final
            </button>
          </div>
        </div>

        {draftBanner && (
          <div className="cx-draft-banner">
            <span>✦ Brouillon restauré{restoredSubsFileName ? ` — ${restoredSubsFileName}` : ''} (config + captions + highlights)</span>
            <button onClick={() => { clearDraft(); setDraftBanner(false) }}>Effacer</button>
          </div>
        )}

        <main className="cx-layout">
          <section className="cx-left-col">
            <div className="cx-tab-bar">
              <button className={`cx-tab-btn${tab === 'render' ? ' active' : ''}`} onClick={() => setTab('render')}>
                <Settings2 size={14}/>Rendu
              </button>
              <button className={`cx-tab-btn${tab === 'captions' ? ' active' : ''}`} onClick={() => setTab('captions')}>
                <FileText size={14}/>Texte
                {captions.length > 0 && <span className="cx-tab-badge">{captions.length}</span>}
              </button>
            </div>

            {tab === 'render' && <>
              <CaptionsCard title="Médias" subtitle="Vidéo source et fichier .srt" icon={<Upload size={15}/>}> 
                <div className="cx-grid two">
                  <F label="Vidéo"><input type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] ?? null)} /></F>
                  <F label={`Sous-titres (.srt)${!subsFile && captions.length > 0 ? ` ✓ ${restoredSubsFileName || 'restauré'}` : ''}`}>
                    <input type="file" accept=".srt,.json" onChange={e => {
                      const f = e.target.files?.[0] ?? null
                      setSubsFile(f)
                      if (f && f.name.endsWith('.srt')) { f.text().then(txt => setCaptions(parseSRT(txt))) }
                      else { setCaptions([]) }
                    }} />
                  </F>
                </div>
              </CaptionsCard>

              <CaptionsCard title="Style principal" subtitle="Texte par défaut" icon={<Type size={15}/>}> 
                <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
                  <F label="Police"><select value={config.base.font} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, font: e.target.value } }))}>{fonts.map(f => <option key={f}>{f}</option>)}</select></F>
                  <F label="Couleur"><input type="color" value={config.base.color} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, color: e.target.value } }))} /></F>
                </div>
                <div className="cx-grid two">
                  <F label="Taille" value={`${Math.round(config.base.size_ratio * 1080)}px`}><input type="range" min={10} max={200} step={1} value={Math.round(config.base.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, size_ratio: Number(e.target.value) / 1080 } }))} /></F>
                  <F label="Espacement" value={`${config.base.spacing.toFixed(1)}px`}><input type="range" min={-5} max={20} step={0.5} value={config.base.spacing} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, spacing: Number(e.target.value) } }))} /></F>
                </div>
                <div className="cx-checks-row">
                  <label><input type="checkbox" checked={config.base.bold} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
                  <label><input type="checkbox" checked={config.base.italic} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
                </div>
                <F label="Casse">
                  <select value={config.base.text_transform} onChange={e => setConfig(c => ({ ...c, base: { ...c.base, text_transform: e.target.value as ConfigState['base']['text_transform'] } }))}>
                    <option value="none">Original</option><option value="lower">minuscule</option><option value="upper">MAJUSCULE</option><option value="title">Titre</option>
                  </select>
                </F>
              </CaptionsCard>

              <CaptionsCard title="Highlight 1" subtitle="Style du premier niveau d'accent" icon={<Layers size={15}/>}> 
                <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
                  <F label="Police"><select value={config.highlight.font} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, font: e.target.value } }))}>{fonts.map(f => <option key={f}>{f}</option>)}</select></F>
                  <F label="Couleur"><input type="color" value={config.highlight.color} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, color: e.target.value } }))} /></F>
                </div>
                <div className="cx-grid two">
                  <F label="Taille" value={`${Math.round(config.highlight.size_ratio * 1080)}px`}><input type="range" min={10} max={200} step={1} value={Math.round(config.highlight.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, size_ratio: Number(e.target.value) / 1080 } }))} /></F>
                  <F label="Espacement" value={`${config.highlight.spacing.toFixed(1)}px`}><input type="range" min={-5} max={20} step={0.5} value={config.highlight.spacing} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, spacing: Number(e.target.value) } }))} /></F>
                </div>
                <div className="cx-checks-row">
                  <label><input type="checkbox" checked={config.highlight.bold} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
                  <label><input type="checkbox" checked={config.highlight.italic} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
                </div>
                <F label="Casse">
                  <select value={config.highlight.text_transform} onChange={e => setConfig(c => ({ ...c, highlight: { ...c.highlight, text_transform: e.target.value as ConfigState['highlight']['text_transform'] } }))}>
                    <option value="none">Original</option><option value="lower">minuscule</option><option value="upper">MAJUSCULE</option><option value="title">Titre</option>
                  </select>
                </F>
              </CaptionsCard>

              <CaptionsCard title="Highlight 2" subtitle="Deuxième niveau d'accent" icon={<Layers size={15}/>}> 
                <label className="cx-toggle-row" style={{marginBottom: config.highlight2.enabled ? 10 : 0}}>
                  <input type="checkbox" checked={config.highlight2.enabled} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, enabled: e.target.checked } }))} />
                  <span className="cx-toggle-label">Activer un 2ᵉ style highlight</span>
                </label>
                {config.highlight2.enabled && (<>
                  <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) 44px', gap:10, alignItems:'end'}}>
                    <F label="Police"><select value={config.highlight2.font} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, font: e.target.value } }))}>{fonts.map(f => <option key={f}>{f}</option>)}</select></F>
                    <F label="Couleur"><input type="color" value={config.highlight2.color} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, color: e.target.value } }))} /></F>
                  </div>
                  <div className="cx-grid two">
                    <F label="Taille" value={`${Math.round(config.highlight2.size_ratio * 1080)}px`}><input type="range" min={10} max={200} step={1} value={Math.round(config.highlight2.size_ratio * 1080)} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, size_ratio: Number(e.target.value) / 1080 } }))} /></F>
                    <F label="Espacement" value={`${config.highlight2.spacing.toFixed(1)}px`}><input type="range" min={-5} max={20} step={0.5} value={config.highlight2.spacing} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, spacing: Number(e.target.value) } }))} /></F>
                  </div>
                  <div className="cx-checks-row">
                    <label><input type="checkbox" checked={config.highlight2.bold} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, bold: e.target.checked } }))} /><Bold size={13}/>Gras</label>
                    <label><input type="checkbox" checked={config.highlight2.italic} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, italic: e.target.checked } }))} /><Italic size={13}/>Italique</label>
                  </div>
                  <F label="Casse">
                    <select value={config.highlight2.text_transform} onChange={e => setConfig(c => ({ ...c, highlight2: { ...c.highlight2, text_transform: e.target.value as ConfigState['highlight2']['text_transform'] } }))}>
                      <option value="none">Original</option><option value="lower">minuscule</option><option value="upper">MAJUSCULE</option><option value="title">Titre</option>
                    </select>
                  </F>
                </>)}
              </CaptionsCard>

              <CaptionsCard title="Effets" subtitle="Ombre, lueur et contour" icon={<Sparkles size={15}/>}> 
                <div className="cx-effect-block">
                  <label className="cx-toggle-row">
                    <input type="checkbox" checked={config.effects.shadow_enabled} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_enabled: e.target.checked } }))} />
                    <span className="cx-toggle-label">Ombre portée</span>
                  </label>
                  {config.effects.shadow_enabled && (
                    <div className="cx-effect-fields">
                      <div className="cx-grid five">
                        <F label="Distance" value={`${config.effects.shadow_distance}px`}><input type="range" min={0} max={50} step={0.5} value={config.effects.shadow_distance} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_distance: Number(e.target.value) } }))} /></F>
                        <F label="Flou" value={`${config.effects.shadow_blur}px`}><input type="range" min={0} max={20} step={0.1} value={config.effects.shadow_blur} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_blur: Number(e.target.value) } }))} /></F>
                        <F label="Angle" value={`${config.effects.shadow_angle}°`}><input type="range" min={-180} max={180} step={1} value={config.effects.shadow_angle} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_angle: Number(e.target.value) } }))} /></F>
                        <F label="Opacité" value={config.effects.shadow_alpha}><input type="range" min={0} max={1} step={0.01} value={config.effects.shadow_alpha} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_alpha: Number(e.target.value) } }))} /></F>
                        <F label="Couleur"><input type="color" value={config.effects.shadow_color} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_color: e.target.value } }))} /></F>
                      </div>
                      <div className="cx-checks-row">
                        <span style={{fontSize:11, fontWeight:600, color:'var(--cx-text-2)', alignSelf:'center'}}>Appliquer à :</span>
                        <label><input type="checkbox" checked={config.effects.shadow_targets.base} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, base: e.target.checked } } }))} />Base</label>
                        <label><input type="checkbox" checked={config.effects.shadow_targets.highlight} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, highlight: e.target.checked } } }))} />Highlight 1</label>
                        <label><input type="checkbox" checked={config.effects.shadow_targets.highlight2} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, shadow_targets: { ...c.effects.shadow_targets, highlight2: e.target.checked } } }))} />Highlight 2</label>
                      </div>
                    </div>
                  )}
                </div>
                <div className="cx-effect-block">
                  <label className="cx-toggle-row">
                    <input type="checkbox" checked={config.effects.glow_enabled} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_enabled: e.target.checked } }))} />
                    <span className="cx-toggle-label">Lueur (glow)</span>
                  </label>
                  {config.effects.glow_enabled && (
                    <div className="cx-effect-fields">
                      <div className="cx-grid two">
                        <F label="Intensité" value={config.effects.glow_intensity}><input type="range" min={0} max={8} step={0.1} value={config.effects.glow_intensity} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_intensity: Number(e.target.value) } }))} /></F>
                        <F label="Couleur"><input type="color" value={config.effects.glow_color} disabled={config.effects.glow_color_auto} style={{opacity: config.effects.glow_color_auto ? 0.3 : 1}} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_color: e.target.value } }))} /></F>
                      </div>
                      <div className="cx-checks-row">
                        <label><input type="checkbox" checked={config.effects.glow_color_auto} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_color_auto: e.target.checked } }))} />Couleur du texte auto</label>
                      </div>
                      <div className="cx-checks-row">
                        <span style={{fontSize:11, fontWeight:600, color:'var(--cx-text-2)', alignSelf:'center'}}>Appliquer à :</span>
                        <label><input type="checkbox" checked={config.effects.glow_targets.base} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, base: e.target.checked } } }))} />Base</label>
                        <label><input type="checkbox" checked={config.effects.glow_targets.highlight} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, highlight: e.target.checked } } }))} />Highlight 1</label>
                        <label><input type="checkbox" checked={config.effects.glow_targets.highlight2} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, glow_targets: { ...c.effects.glow_targets, highlight2: e.target.checked } } }))} />Highlight 2</label>
                      </div>
                    </div>
                  )}
                </div>
                <div className="cx-effect-block">
                  <label className="cx-toggle-row">
                    <input type="checkbox" checked={config.effects.outline_enabled} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_enabled: e.target.checked } }))} />
                    <span className="cx-toggle-label">Contour (outline)</span>
                  </label>
                  {config.effects.outline_enabled && (
                    <div className="cx-effect-fields">
                      <div className="cx-grid two">
                        <F label="Épaisseur" value={`${config.effects.outline_width}px`}><input type="range" min={0} max={20} step={0.5} value={config.effects.outline_width} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_width: Number(e.target.value) } }))} /></F>
                        <F label="Couleur"><input type="color" value={config.effects.outline_color} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_color: e.target.value } }))} /></F>
                      </div>
                      <div className="cx-checks-row">
                        <span style={{fontSize:11, fontWeight:600, color:'var(--cx-text-2)', alignSelf:'center'}}>Appliquer à :</span>
                        <label><input type="checkbox" checked={config.effects.outline_targets.base} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_targets: { ...c.effects.outline_targets, base: e.target.checked } } }))} />Base</label>
                        <label><input type="checkbox" checked={config.effects.outline_targets.highlight} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_targets: { ...c.effects.outline_targets, highlight: e.target.checked } } }))} />Highlight 1</label>
                        <label><input type="checkbox" checked={config.effects.outline_targets.highlight2} onChange={e => setConfig(c => ({ ...c, effects: { ...c.effects, outline_targets: { ...c.effects.outline_targets, highlight2: e.target.checked } } }))} />Highlight 2</label>
                      </div>
                    </div>
                  )}
                </div>
              </CaptionsCard>
            </>}

            {tab === 'captions' && (
              <CaptionsCard title="Texte & highlights" subtitle="Cliquez sur les mots pour changer leur style" icon={<FileText size={15}/>}> 
                <div>
                  <div className="cx-field-label" style={{marginBottom:6}}>Mots actifs</div>
                  <div className="cx-kw-chips">
                    {highlightChips.length === 0
                      ? <span className="cx-kw-empty">Aucun — cliquez un mot ci-dessous</span>
                      : highlightChips.map(({ key, label, group }) => (
                          <span key={key} className={`cx-kw-chip${group === 1 ? ' cx-kw-chip-2' : ''}`}>
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
                  highlightTransform={config.highlight.text_transform}
                  highlight2Transform={config.highlight2.text_transform}
                  highlight2Enabled={config.highlight2.enabled}
                />
              </CaptionsCard>
            )}
          </section>

          <aside className="cx-right-col">
            <CaptionsCard title="Aperçu" subtitle={status} icon={<Eye size={15}/>}> 
              {/* eslint-disable-next-line @next/next/no-img-element -- preview is a dynamic blob URL from the render API */}
              {previewUrl ? <img className="cx-preview-image" src={previewUrl} alt="preview" /> : <div className="cx-preview-placeholder">Aucun preview</div>}
              <div className="cx-actions-row">
                <button disabled={busy} onClick={() => runAction('preview')}><Eye size={13}/>Image</button>
                <button disabled={busy} onClick={() => runAction('render-preview')}><Film size={13}/>Clip 6 s</button>
              </div>
              <F label="Profil d&apos;export">
                <select value={config.export_profile} onChange={e => setConfig(c => ({ ...c, export_profile: e.target.value as ConfigState['export_profile'] }))}>
                  <option value="draft">Rapide (8 Mb/s)</option>
                  <option value="balanced">Équilibré (12 Mb/s)</option>
                  <option value="final">Max (16 Mb/s)</option>
                </select>
              </F>
              <div className="cx-status-line">
                <span className={`cx-status-dot ${busy ? 'run' : message.startsWith('Erreur') ? 'err' : 'ok'}`}/>
                {message}
              </div>
              {renderProgress >= 0 && (
                <div className="cx-progress-track">
                  <div className="cx-progress-bar" style={{ width: `${Math.round(renderProgress * 100)}%` }} />
                </div>
              )}
              {videoUrl && <video className="cx-preview-video" controls src={videoUrl} />}
            </CaptionsCard>

            <CaptionsCard title="Placement" subtitle="Position, largeur et animation" icon={<LayoutTemplate size={15}/>}> 
              <div className="cx-grid two">
                <F label="Position">
                  <select value={config.layout.anchor} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, anchor: e.target.value as ConfigState['layout']['anchor'] } }))}>
                    <option value="bottom">Bas</option><option value="center">Centre</option><option value="top">Haut</option>
                  </select>
                </F>
                <F label="Nb lignes max" value={config.layout.max_lines}><input type="range" min={1} max={4} step={1} value={config.layout.max_lines} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, max_lines: Number(e.target.value) } }))} /></F>
              </div>
              <F label="Décalage vertical" value={config.layout.vertical_offset === 0 ? 'Centre' : config.layout.vertical_offset > 0 ? `+${Math.round(config.layout.vertical_offset * 100)}%` : `${Math.round(config.layout.vertical_offset * 100)}%`}>
                <input type="range" min={-0.4} max={0.4} step={0.01} value={config.layout.vertical_offset} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, vertical_offset: Number(e.target.value) } }))} />
              </F>
              <div className="cx-grid three">
                <F label="Interline" value={`${(1 + config.layout.line_gap).toFixed(2)}×`}><input type="range" min={0.20} max={3.00} step={0.05} value={1 + config.layout.line_gap} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, line_gap: Number(e.target.value) - 1 } }))} /></F>
                <F label="Largeur max" value={config.layout.max_width_ratio >= 1.0 ? 'Auto' : `${Math.round(config.layout.max_width_ratio * 100)}%`}><input type="range" min={0.3} max={1.0} step={0.05} value={config.layout.max_width_ratio} onChange={e => setConfig(c => ({ ...c, layout: { ...c.layout, max_width_ratio: Number(e.target.value) } }))} /></F>
                <F label="Preview (s)"><input type="number" min={0} value={config.preview_time} onChange={e => setConfig(c => ({ ...c, preview_time: Number(e.target.value) }))} /></F>
              </div>
              <div className="cx-grid two">
                <F label="Animation">
                  <select value={config.animation} onChange={e => setConfig(c => ({ ...c, animation: e.target.value as ConfigState['animation'] }))}>
                    <option value="none">Aucune</option>
                    <option value="appear">Apparition mot à mot</option>
                    <option value="reveal">Machine à écrire (lettre par lettre)</option>
                    <option value="word_pop">Mot par mot (instantané)</option>
                  </select>
                </F>
                <F label="">
                  <label style={{display:'flex',alignItems:'center',gap:6,marginTop:18,fontSize:12}}>
                    <input type="checkbox" checked={config.animation_enabled} onChange={e => setConfig(c => ({ ...c, animation_enabled: e.target.checked }))} />
                    Activer
                  </label>
                </F>
              </div>
            </CaptionsCard>
          </aside>
        </main>
      </div>
    </div>
  )
}

// ── Mode simplifié pour les utilisateurs non-admin ───────────────────────────

interface UserModeProps {
  presets: Preset[]
  presetsLoading: boolean
  selectedPresetId: string | null
  onSelectPreset: (p: Preset) => void
  videoFile: File | null
  onVideoChange: (f: File | null) => void
  subsFile: File | null
  captions: Caption[]
  restoredSubsFileName: string
  onSubsChange: (f: File) => void
  exportProfile: ConfigState['export_profile']
  onExportProfileChange: (v: ConfigState['export_profile']) => void
  busy: boolean
  message: string
  renderProgress: number
  videoUrl: string
  onRender: () => void
  onReset: () => void
}

function UserCaptionsMode({
  presets, presetsLoading, selectedPresetId, onSelectPreset,
  videoFile, onVideoChange, subsFile, captions, restoredSubsFileName, onSubsChange,
  exportProfile, onExportProfileChange,
  busy, message, renderProgress, videoUrl,
  onRender, onReset,
}: UserModeProps) {
  const preset = presets.find(p => p.id === selectedPresetId) ?? null
  const canGenerate = !!videoFile && (!!subsFile || captions.length > 0) && !!preset

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Film size={18} className="text-violet-500" /> Captions
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Brûlez des sous-titres dans votre vidéo</p>
          </div>
          <button onClick={onReset} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Réinitialiser
          </button>
        </div>

        {/* Step 1 — Preset */}
        <StepCard number={1} title="Style de sous-titres">
          {presetsLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              Chargement…
            </div>
          ) : presets.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">Aucun preset disponible — contactez votre administrateur.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => onSelectPreset(p)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    selectedPresetId === p.id
                      ? 'bg-violet-50 border-violet-300 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                    selectedPresetId === p.id ? 'bg-violet-500 border-violet-500' : 'border-gray-300'
                  }`} />
                  <div>
                    <p className={`text-sm font-medium ${selectedPresetId === p.id ? 'text-violet-800' : 'text-gray-800'}`}>
                      {p.name}
                    </p>
                    {p.isBuiltin && (
                      <p className="text-[10px] text-violet-400 mt-0.5">Style intégré</p>
                    )}
                  </div>
                  {selectedPresetId === p.id && <span className="ml-auto text-violet-500 text-sm">✓</span>}
                </button>
              ))}
            </div>
          )}
        </StepCard>

        {/* Step 2 — Vidéo */}
        <StepCard number={2} title="Votre vidéo">
          <label className={`flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            videoFile ? 'border-violet-300 bg-violet-50' : 'border-gray-200 hover:border-gray-300 bg-white'
          }`}>
            <Upload size={20} className={videoFile ? 'text-violet-500' : 'text-gray-400'} />
            <span className="text-sm font-medium text-gray-700">
              {videoFile ? videoFile.name : 'Cliquer pour choisir une vidéo'}
            </span>
            {videoFile && (
              <span className="text-xs text-violet-600">{(videoFile.size / 1_000_000).toFixed(1)} Mo</span>
            )}
            <input type="file" accept="video/*" className="hidden"
              onChange={e => onVideoChange(e.target.files?.[0] ?? null)} />
          </label>
        </StepCard>

        {/* Step 3 — Sous-titres */}
        <StepCard number={3} title="Sous-titres (.srt)">
          <label className={`flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            (subsFile || captions.length > 0) ? 'border-violet-300 bg-violet-50' : 'border-gray-200 hover:border-gray-300 bg-white'
          }`}>
            <FileText size={20} className={(subsFile || captions.length > 0) ? 'text-violet-500' : 'text-gray-400'} />
            <span className="text-sm font-medium text-gray-700">
              {subsFile
                ? subsFile.name
                : captions.length > 0
                ? `${restoredSubsFileName || 'Sous-titres restaurés'} (${captions.length} lignes)`
                : 'Cliquer pour choisir un fichier .srt'}
            </span>
            <input type="file" accept=".srt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onSubsChange(f) }} />
          </label>
        </StepCard>

        {/* Step 4 — Generate */}
        <StepCard number={4} title="Qualité d&apos;export">
          <select
            value={exportProfile}
            onChange={e => onExportProfileChange(e.target.value as ConfigState['export_profile'])}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="draft">Rapide (8 Mb/s)</option>
            <option value="balanced">Équilibré (12 Mb/s, recommandé)</option>
            <option value="final">Max (16 Mb/s)</option>
          </select>
        </StepCard>

        {/* Generate button */}
        <button
          disabled={!canGenerate || busy}
          onClick={onRender}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors"
        >
          {busy
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Génération en cours…</>
            : <><Film size={16}/> Générer la vidéo</>
          }
        </button>
        {!canGenerate && !busy && (
          <p className="text-xs text-center text-gray-400">
            {!preset ? '① Choisissez un preset' : !videoFile ? '② Ajoutez une vidéo' : '③ Ajoutez les sous-titres (.srt)'}
          </p>
        )}

        {/* Progress */}
        {renderProgress >= 0 && (
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="bg-violet-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(renderProgress * 100)}%` }} />
          </div>
        )}

        {/* Status */}
        <div className={`text-sm text-center ${message.startsWith('Erreur') ? 'text-red-500' : 'text-gray-500'}`}>
          {message}
        </div>

        {/* Result video */}
        {videoUrl && (
          <div className="space-y-3">
            <video src={videoUrl} controls className="w-full rounded-xl border border-gray-200" />
            <a href={videoUrl} download
              className="flex items-center justify-center gap-2 py-3 bg-gray-900 hover:bg-gray-700 text-white rounded-xl font-medium text-sm transition-colors">
              ↓ Télécharger MP4
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </div>
  )
}

"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, AlignLeft, Film, Music, Settings, Undo2, Redo2, X, ChevronLeft, Image, Type, Loader2 } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { collectBuilderFontsFromSources, type BuilderFontEntry } from "@/lib/builderFonts";
import { toast } from "@/components/ui/Toast";
import type { TemplateJSON } from "@/types/template";
import { serializeTemplateJSON } from "@/lib/templateNormalization";
import { createLayoutDebugStorageKey, stringifyLayoutDebugSnapshot, type LayoutDebugSnapshot } from "@/lib/layoutDebug";
import { BlocksPanel } from "./BlocksPanel";
import { Canvas } from "./Canvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { SchemaPanel } from "@/components/builder/SchemaPanel";
import { VideoSequencePanel } from "@/components/builder/VideoSequencePanel";
import { MusicPanel } from "@/components/builder/MusicPanel";
import { SettingsPanel } from "@/components/builder/SettingsPanel";
import { CoverTabPanel } from "@/components/builder/CoverTabPanel";
import { CaptionsTabPanel } from "@/components/builder/CaptionsTabPanel";
import { SequenceTimeline } from "@/components/builder/SequenceTimeline";

// ─── Rail tab definitions ─────────────────────────────────────────────────────

type PanelId = "layers" | "schema" | "sequence" | "music" | "cover" | "captions" | "settings";

/** Top items du rail (création / structure du template) */
const PANEL_ITEMS_TOP: { id: PanelId; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "layers",   label: "Calques",    Icon: Layers },
  { id: "schema",   label: "Formulaire", Icon: AlignLeft },
  { id: "sequence", label: "Séquence",   Icon: Film },
  { id: "music",    label: "Musique",    Icon: Music },
];

/** Bottom items du rail (config auto cover/captions + paramètres généraux) */
const PANEL_ITEMS_BOTTOM: { id: PanelId; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "cover",    label: "Cover auto",      Icon: Image },
  { id: "captions", label: "Sous-titres auto", Icon: Type },
  { id: "settings", label: "Paramètres",       Icon: Settings },
];

const PANEL_LABELS: Record<PanelId, string> = {
  layers:   "Calques",
  schema:   "Formulaire",
  sequence: "Séquence",
  music:    "Musique",
  cover:    "Cover auto",
  captions: "Sous-titres auto",
  settings: "Paramètres",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  templateId: string;
  templateName: string;
  templateClient: string;
  initialJSON: TemplateJSON;
  initialFormats: string[];
  backUrl?: string;
  backLabel?: string;
}

export function BuilderClient({
  templateId,
  templateName,
  initialJSON,
  backUrl,
  backLabel = "Templates",
}: Props) {
  const { template, setTemplate, isSaving, isDirty, setSaving, markSaved, undo, redo, past, future } =
    useBuilderStore();
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<PanelId | null>("layers");
  const [globalFonts, setGlobalFonts] = useState<BuilderFontEntry[]>([]);
  const [videoLibraries, setVideoLibraries] = useState<{ id: string; name: string }[]>([]);
  const [layoutDebugSnapshot, setLayoutDebugSnapshot] = useState<LayoutDebugSnapshot | null>(null);
  const [showResolvedTextPreview, setShowResolvedTextPreview] = useState(false);

  const blockFontFamilies = useMemo(
    () => template.blocks.map((block) => (block as { style?: { fontFamily?: string } }).style?.fontFamily),
    [template.blocks]
  );
  const builderFonts = useMemo(
    () => collectBuilderFontsFromSources({
      customFonts: template.theme.customFonts,
      headingFont: template.theme.fonts.heading,
      bodyFont: template.theme.fonts.body,
      blockFontFamilies,
    }, globalFonts),
    [blockFontFamilies, globalFonts, template.theme.customFonts, template.theme.fonts.body, template.theme.fonts.heading]
  );
  const fontRefreshKey = useMemo(
    () => builderFonts.map((font) => `${font.family}:${font.url ?? ""}`).join("|"),
    [builderFonts]
  );

  // Init
  useEffect(() => {
    setTemplate(initialJSON);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load global fonts
  useEffect(() => {
    let cancelled = false;
    async function loadGlobalFonts() {
      try {
        const res = await fetch("/api/font-assets", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as Array<{ family: string; url: string }>;
        if (cancelled) return;
        setGlobalFonts(data.map((font) => ({ family: font.family, url: font.url, source: "global" })));
      } catch {
        if (!cancelled) setGlobalFonts([]);
      }
    }
    void loadGlobalFonts();
    return () => { cancelled = true; };
  }, []);

  // Inject custom fonts into document head for builder preview
  useEffect(() => {
    const googleFamilies: string[] = [];
    for (const { family, url } of builderFonts) {
      if (url) {
        const id = `font-face-${family.replace(/\s+/g, "-")}`;
        const css = `@font-face{font-family:'${family}';src:url('${url}');font-display:swap;}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = id;
          document.head.appendChild(el);
        }
        el.textContent = css;
      } else {
        googleFamilies.push(family);
      }
    }
    const managedLocalStyleIds = new Set(
      builderFonts.filter((font) => Boolean(font.url)).map((font) => `font-face-${font.family.replace(/\s+/g, "-")}`)
    );
    Array.from(document.querySelectorAll('style[id^="font-face-"]')).forEach((node) => {
      if (!managedLocalStyleIds.has(node.id)) node.remove();
    });
    if (googleFamilies.length > 0) {
      const id = "google-fonts-builder";
      const url = `https://fonts.googleapis.com/css2?${googleFamilies.map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`).join("&")}&display=swap`;
      let el = document.getElementById(id) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link") as HTMLLinkElement;
        el.id = id;
        el.rel = "stylesheet";
        document.head.appendChild(el);
      }
      el.href = url;
    } else {
      document.getElementById("google-fonts-builder")?.remove();
    }
  }, [builderFonts]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveTemplate = useCallback(async (options?: { showSuccessToast?: boolean }) => {
    const showSuccessToast = options?.showSuccessToast ?? true;
    if (isSaving) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonData: serializeTemplateJSON(template),
          formats: [template.canvas.format],
        }),
      });
      if (res.ok) {
        markSaved();
        if (showSuccessToast) toast.success("Template sauvegardé ✓");
        return true;
      } else {
        toast.error("Échec de la sauvegarde");
        return false;
      }
    } catch {
      toast.error("Erreur réseau lors de la sauvegarde");
      return false;
    } finally {
      setSaving(false);
    }
  }, [isSaving, setSaving, markSaved, template, templateId]);

  const handleSave = useCallback(async () => { void saveTemplate(); }, [saveTemplate]);

  const handleOpenPreview = useCallback(async (href: string) => {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      toast.error("Le navigateur a bloqué l'ouverture de l'aperçu");
      return;
    }
    previewWindow.document.title = "Sauvegarde du template…";
    previewWindow.document.body.innerHTML = "<p style=\"font-family:sans-serif;padding:24px;color:#111827\">Sauvegarde du template…</p>";
    const saved = await saveTemplate({ showSuccessToast: false });
    if (!saved) { previewWindow.close(); return; }
    previewWindow.location.replace(new URL(href, window.location.origin).toString());
  }, [saveTemplate]);

  const handleOpenGenerate = useCallback(async () => {
    const saved = await saveTemplate({ showSuccessToast: false });
    if (!saved) return;
    window.location.assign(`/generate/${templateId}`);
  }, [saveTemplate, templateId]);

  // Ctrl+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  // L5 — Bridge entre VideoBlockPropertiesPanel (à droite) et le panneau
  // Séquence (rail gauche). VideoBlockPropertiesPanel dispatche l'event
  // builder:open-sequence-panel après avoir sélectionné son slot ; on
  // ouvre alors le bon panneau ici sans avoir à propager setActivePanel
  // dans le prop drilling de PropertiesPanel.
  useEffect(() => {
    function onOpenSequencePanel() {
      setActivePanel("sequence");
    }
    window.addEventListener("builder:open-sequence-panel", onOpenSequencePanel);
    return () => window.removeEventListener("builder:open-sequence-panel", onOpenSequencePanel);
  }, []);

  // Guard fermeture / refresh / navigation externe quand des changements
  // sont en attente. Le navigateur affiche son prompt natif "Quitter ce
  // site ?". Pas de message custom (les browsers ignorent depuis 2017).
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Confirm sur clic du lien "Retour" — Link de Next.js fait une navigation
  // soft, beforeunload ne se déclenche pas. On intercepte le clic et on
  // demande confirmation si dirty.
  const handleBackClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isDirty || !backUrl) return;
      e.preventDefault();
      const ok = window.confirm(
        "Tu as des modifications non sauvegardées. Quitter sans sauvegarder ?",
      );
      if (ok) router.push(backUrl);
    },
    [isDirty, backUrl, router],
  );

  // Layout debug
  useEffect(() => {
    if (!layoutDebugSnapshot) return;
    const storageKey = createLayoutDebugStorageKey(templateId);
    localStorage.setItem(storageKey, stringifyLayoutDebugSnapshot(layoutDebugSnapshot));
    (window as Window & { __builderLayoutDebugSnapshot?: LayoutDebugSnapshot }).__builderLayoutDebugSnapshot = layoutDebugSnapshot;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("toolbox-layout-debug");
      channel.postMessage({ templateId, snapshot: layoutDebugSnapshot });
      channel.close();
    }
  }, [layoutDebugSnapshot, templateId]);

  // Toggle panel: click active → close, click other → switch
  function handleRailClick(id: PanelId) {
    setActivePanel((prev) => (prev === id ? null : id));
  }

  const hasSequence = (template.videoSequence?.length ?? 0) > 0;
  // Indicator dot: light up when any library-sourced media is configured
  const hasMediaSources =
    hasSequence ||
    template.blocks.some(
      (b) => (b.type === "music" && (b as { libraryId?: string }).libraryId) ||
             (b.type === "video" && (b as { libraryId?: string }).libraryId),
    );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-1.5 bg-white border-b border-gray-200 px-3 h-10 shrink-0">
        {backUrl && (
          <a
            href={backUrl}
            onClick={handleBackClick}
            className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-700 transition-colors mr-1 shrink-0"
            title={`Retour vers ${backLabel}`}
          >
            <ChevronLeft size={13} />
            {backLabel}
          </a>
        )}

        {/* Template name */}
        <span className="font-semibold text-gray-900 text-sm truncate max-w-[220px]" title={templateName}>
          {templateName}
        </span>

        {/* Indicateur "Non sauvegardé" — visible dès qu'une mutation tracked
            a eu lieu depuis le dernier load/save. Garde le user au courant
            sans clignoter sur les éditions normales. */}
        {isDirty && (
          <span
            className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0"
            title="Modifications non sauvegardées — Ctrl+S pour enregistrer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Non sauvegardé
          </span>
        )}

        <div className="w-px h-5 bg-gray-200 mx-1.5 shrink-0" />

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={past.length === 0}
          title="Annuler (Ctrl+Z)"
          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          title="Rétablir (Ctrl+Y)"
          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <Redo2 size={14} />
        </button>

        <div className="flex-1" />

        {/* Actions */}
        <button
          type="button"
          onClick={() => void handleOpenPreview(`/preview/${templateId}`)}
          disabled={isSaving}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Aperçu
        </button>
        <button
          type="button"
          onClick={() => void handleOpenGenerate()}
          disabled={isSaving}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Générer →
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-60 transition-colors inline-flex items-center gap-1.5"
        >
          {isSaving && <Loader2 size={12} className="animate-spin" />}
          Sauvegarder
        </button>
      </header>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: icon rail + optional fly-out panel */}
        <aside className="flex shrink-0">

          {/* ── Icon rail (always visible, 48px) ─────────────────────────── */}
          <nav className="w-12 flex flex-col items-center pt-2 pb-3 gap-0.5 bg-white border-r border-gray-100 shrink-0">
            {PANEL_ITEMS_TOP.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleRailClick(id)}
                title={label}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                  activePanel === id
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                }`}
              >
                <Icon size={18} />
              </button>
            ))}

            {/* Sequence indicator dot */}
            {hasMediaSources && activePanel !== "sequence" && (
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 -mt-0.5" aria-hidden />
            )}

            <div className="flex-1" />

            {/* Bottom items : Cover auto / Captions auto / Settings */}
            {PANEL_ITEMS_BOTTOM.map(({ id, label, Icon }) => {
              const hasCoverConfig =
                id === "cover" &&
                Array.isArray((template as { coverPresets?: unknown[] }).coverPresets) &&
                ((template as { coverPresets?: unknown[] }).coverPresets?.length ?? 0) > 0;
              const hasCaptionConfig =
                id === "captions" &&
                (template.captionAutoConfig?.enabled ?? false);
              const showDot = (hasCoverConfig || hasCaptionConfig) && activePanel !== id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleRailClick(id)}
                  title={label}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors relative ${
                    activePanel === id
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  }`}
                >
                  <Icon size={18} />
                  {showDot && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden />
                  )}
                </button>
              );
            })}
          </nav>

          {/* ── Fly-out panel (shown when a panel is active) ──────────────── */}
          {activePanel && (
            <div className="w-[17rem] xl:w-[18rem] flex flex-col bg-white border-r border-gray-200 overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  {PANEL_LABELS[activePanel]}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  title="Fermer le panneau"
                  className="text-gray-400 hover:text-gray-700 rounded p-0.5 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              {/* Panel content */}
              <div className="flex-1 overflow-hidden">
                {activePanel === "layers"   && <BlocksPanel />}
                {activePanel === "schema"   && <SchemaPanel />}
                {activePanel === "sequence" && <VideoSequencePanel videoLibraries={videoLibraries} setVideoLibraries={setVideoLibraries} />}
                {activePanel === "music"    && <MusicPanel />}
                {activePanel === "cover"    && <CoverTabPanel templateId={templateId} />}
                {activePanel === "captions" && <CaptionsTabPanel templateId={templateId} />}
                {activePanel === "settings" && <SettingsPanel />}
              </div>
            </div>
          )}
        </aside>

        {/* Center: Canvas + optional timeline strip */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <Canvas
            fontRefreshKey={fontRefreshKey}
            onLayoutDebugSnapshotChange={setLayoutDebugSnapshot}
            showResolvedTextPreview={showResolvedTextPreview}
          />
          {hasSequence && <SequenceTimeline />}
        </div>

        {/* Right: Properties panel */}
        <PropertiesPanel
          globalFonts={globalFonts}
          showResolvedTextPreview={showResolvedTextPreview}
          onShowResolvedTextPreviewChange={setShowResolvedTextPreview}
        />
      </div>
    </div>
  );
}

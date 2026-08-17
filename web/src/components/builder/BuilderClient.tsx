"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, AlignLeft, Film, Music, Settings, Undo2, Redo2, X, ChevronLeft, Camera, Captions, Database } from "lucide-react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { collectBuilderFontsFromSources, fontFormatFromUrl, googleFontCssUrl, type BuilderFontEntry } from "@/lib/builderFonts";
import { BuilderFontStatusProvider } from "./BuilderFontStatusContext";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
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
import { DataTabPanel } from "@/components/builder/DataTabPanel";
import { SequenceTimeline } from "@/components/builder/SequenceTimeline";

// ─── Rail tab definitions ─────────────────────────────────────────────────────

type PanelId = "layers" | "schema" | "sequence" | "music" | "data" | "cover" | "captions" | "settings";

/** Top items du rail (création / structure du template) */
const PANEL_ITEMS_TOP: { id: PanelId; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "layers",   label: "Calques",    Icon: Layers },
  { id: "schema",   label: "Formulaire", Icon: AlignLeft },
  { id: "sequence", label: "Séquence",   Icon: Film },
  { id: "music",    label: "Musique",    Icon: Music },
  { id: "data",     label: "Données",    Icon: Database },
];

/** Bottom items du rail (config auto cover/captions + paramètres généraux) */
const PANEL_ITEMS_BOTTOM: { id: PanelId; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "cover",    label: "Cover auto",      Icon: Camera },
  { id: "captions", label: "Sous-titres auto", Icon: Captions },
  { id: "settings", label: "Paramètres",       Icon: Settings },
];

const PANEL_LABELS: Record<PanelId, string> = {
  layers:   "Calques",
  schema:   "Formulaire",
  sequence: "Séquence",
  music:    "Musique",
  data:     "Données",
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
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [activePanel, setActivePanel] = useState<PanelId | null>("layers");
  const [globalFonts, setGlobalFonts] = useState<BuilderFontEntry[]>([]);
  const [videoLibraries, setVideoLibraries] = useState<{ id: string; name: string }[]>([]);
  const [layoutDebugSnapshot, setLayoutDebugSnapshot] = useState<LayoutDebugSnapshot | null>(null);
  const [showResolvedTextPreview, setShowResolvedTextPreview] = useState(false);
  const [failedFontFamilies, setFailedFontFamilies] = useState<Set<string>>(new Set());

  const blockFonts = useMemo(
    () => template.blocks.map((block) => {
      const style = (block as { style?: { fontFamily?: string; fontWeight?: number } }).style;
      return { family: style?.fontFamily, weight: style?.fontWeight };
    }),
    [template.blocks]
  );
  const builderFonts = useMemo(
    () => collectBuilderFontsFromSources({
      customFonts: template.theme.customFonts,
      headingFont: template.theme.fonts.heading,
      bodyFont: template.theme.fonts.body,
      blockFonts,
    }, globalFonts),
    [blockFonts, globalFonts, template.theme.customFonts, template.theme.fonts.body, template.theme.fonts.heading]
  );
  const fontRefreshKey = useMemo(
    () => builderFonts.map((font) => `${font.family}:${font.url ?? ""}:${(font.weights ?? []).join(",")}`).join("|"),
    [builderFonts],
  );
  const fontStatusValue = useMemo(() => ({ failedFamilies: failedFontFamilies }), [failedFontFamilies]);

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
    // 1. Polices uploadées (url) → un @font-face isolé chacune.
    const googleFonts: BuilderFontEntry[] = [];
    for (const font of builderFonts) {
      if (font.url) {
        const id = `font-face-${font.family.replace(/\s+/g, "-")}`;
        const css = `@font-face{font-family:'${font.family}';src:url('${font.url}') format('${fontFormatFromUrl(font.url)}');font-display:swap;}`;
        let el = document.getElementById(id) as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = id;
          document.head.appendChild(el);
        }
        el.textContent = css;
      } else {
        googleFonts.push(font);
      }
    }
    const managedLocalStyleIds = new Set(
      builderFonts.filter((font) => Boolean(font.url)).map((font) => `font-face-${font.family.replace(/\s+/g, "-")}`)
    );
    Array.from(document.querySelectorAll('style[id^="font-face-"]')).forEach((node) => {
      if (!managedLocalStyleIds.has(node.id)) node.remove();
    });

    // 2. Polices Google → UN <link> css2 PAR famille (isolation : un 400 sur une
    //    police n'entraîne plus l'échec de toutes les autres). onerror/onload
    //    alimentent `failedFontFamilies` pour signaler les polices qui ne chargent pas.
    const googleLinkId = (family: string) => `google-font-${family.replace(/\s+/g, "-")}`;
    const managedGoogleIds = new Set(googleFonts.map((f) => googleLinkId(f.family)));
    Array.from(document.querySelectorAll('link[id^="google-font-"]')).forEach((node) => {
      if (!managedGoogleIds.has(node.id)) node.remove();
    });
    // Retire l'ancien lien batché tout-ou-rien s'il traîne (migration).
    document.getElementById("google-fonts-builder")?.remove();

    for (const font of googleFonts) {
      const id = googleLinkId(font.family);
      const href = googleFontCssUrl(font.family, font.weights);
      let el = document.getElementById(id) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link") as HTMLLinkElement;
        el.id = id;
        el.rel = "stylesheet";
        document.head.appendChild(el);
      }
      const family = font.family;
      el.onload = () => setFailedFontFamilies((prev) => {
        if (!prev.has(family)) return prev;
        const next = new Set(prev);
        next.delete(family);
        return next;
      });
      el.onerror = () => setFailedFontFamilies((prev) => {
        if (prev.has(family)) return prev;
        const next = new Set(prev);
        next.add(family);
        return next;
      });
      if (el.getAttribute("data-href") !== href) {
        el.setAttribute("data-href", href);
        el.href = href;
      }
    }

    // Purge du statut : ne garder que les familles Google encore présentes.
    setFailedFontFamilies((prev) => {
      const next = new Set([...prev].filter((family) => managedGoogleIds.has(googleLinkId(family))));
      return next.size === prev.size ? prev : next;
    });
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
  // demande confirmation si dirty via le ConfirmDialog du design system
  // (cohérence visuelle vs window.confirm natif).
  const handleBackClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isDirty || !backUrl) return;
      e.preventDefault();
      void (async () => {
        const ok = await confirm({
          title: "Modifications non sauvegardées",
          description: "Tu as des modifications non sauvegardées. Quitter sans sauvegarder ?",
          confirmLabel: "Quitter",
          cancelLabel: "Rester ici",
          variant: "danger",
        });
        if (ok) router.push(backUrl);
      })();
    },
    [isDirty, backUrl, router, confirm],
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
    <div className="flex flex-col h-screen overflow-hidden bg-muted">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-1.5 bg-white border-b border-border px-3 h-10 shrink-0">
        {backUrl && (
          <a
            href={backUrl}
            onClick={handleBackClick}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors mr-1 shrink-0"
            title={`Retour vers ${backLabel}`}
          >
            <ChevronLeft size={13} />
            {backLabel}
          </a>
        )}

        {/* Template name */}
        <span className="font-semibold text-foreground text-sm truncate max-w-[220px]" title={templateName}>
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

        {/* Undo / Redo — ButtonIcon variant ghost (cohérent UI primitives) */}
        <ButtonIcon
          icon={Undo2}
          label="Annuler (Ctrl+Z)"
          onClick={undo}
          disabled={past.length === 0}
          variant="ghost"
          size="sm"
        />
        <ButtonIcon
          icon={Redo2}
          label="Rétablir (Ctrl+Y)"
          onClick={redo}
          disabled={future.length === 0}
          variant="ghost"
          size="sm"
        />

        <div className="flex-1" />

        {/* Actions — Button primitives (W4 : drop indigo banni Coastal Studio) */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleOpenPreview(`/preview/${templateId}`)}
          disabled={isSaving}
        >
          Aperçu
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleOpenGenerate()}
          disabled={isSaving}
        >
          Générer →
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={isSaving}
          onClick={handleSave}
          disabled={isSaving}
        >
          Sauvegarder
        </Button>
      </header>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: icon rail + optional fly-out panel */}
        <aside className="flex shrink-0">

          {/* ── Icon rail (always visible, 48px) ─────────────────────────── */}
          <nav className="w-12 flex flex-col items-center pt-2 pb-3 gap-0.5 bg-white border-r border-border shrink-0">
            {PANEL_ITEMS_TOP.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleRailClick(id)}
                title={label}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                  activePanel === id
                    ? "bg-info-50 text-info-700"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon size={18} />
              </button>
            ))}

            {/* Sequence indicator dot */}
            {hasMediaSources && activePanel !== "sequence" && (
              <div className="w-1.5 h-1.5 rounded-full bg-info-200 -mt-0.5" aria-hidden />
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
                      ? "bg-info-50 text-info-700"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon size={18} />
                  {showDot && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-info-200" aria-hidden />
                  )}
                </button>
              );
            })}
          </nav>

          {/* ── Fly-out panel (shown when a panel is active) ──────────────── */}
          {activePanel && (
            <div className="w-[17rem] xl:w-[18rem] flex flex-col bg-white border-r border-border overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {PANEL_LABELS[activePanel]}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  title="Fermer le panneau"
                  className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
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
                {activePanel === "data"     && <DataTabPanel />}
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
        <BuilderFontStatusProvider value={fontStatusValue}>
          <PropertiesPanel
            globalFonts={globalFonts}
            showResolvedTextPreview={showResolvedTextPreview}
            onShowResolvedTextPreviewChange={setShowResolvedTextPreview}
          />
        </BuilderFontStatusProvider>
      </div>
      {confirmDialog}
    </div>
  );
}

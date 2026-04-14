"use client";

import { useEffect, useCallback, useState } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { collectBuilderFonts, type BuilderFontEntry } from "@/lib/builderFonts";
import { toast } from "@/components/ui/Toast";
import type { TemplateJSON } from "@/types/template";
import { CANVAS_FORMATS } from "@/types/template";
import { normalizeTemplateJSON, serializeTemplateJSON } from "@/lib/templateNormalization";
import { createLayoutDebugStorageKey, stringifyLayoutDebugSnapshot, type LayoutDebugSnapshot } from "@/lib/layoutDebug";
import { BlocksPanel } from "./BlocksPanel";
import { Canvas } from "./Canvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { SchemaPanel } from "@/components/builder/SchemaPanel";

interface Props {
  templateId: string;
  templateName: string;
  templateClient: string;
  initialJSON: TemplateJSON;
  initialFormats: string[];
}

export function BuilderClient({
  templateId,
  templateName,
  initialJSON,
}: Props) {
  const { template, setTemplate, updateCanvas, isSaving, setSaving, undo, redo, past, future } =
    useBuilderStore();
  const [leftTab, setLeftTab] = useState<"blocs" | "schema">("blocs");
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [globalFonts, setGlobalFonts] = useState<BuilderFontEntry[]>([]);
  const [layoutDebugSnapshot, setLayoutDebugSnapshot] = useState<LayoutDebugSnapshot | null>(null);
  const [showResolvedTextPreview, setShowResolvedTextPreview] = useState(false);

  // Init store with server data
  useEffect(() => {
    setTemplate(normalizeTemplateJSON(initialJSON));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
    return () => {
      cancelled = true;
    };
  }, []);

  // Inject custom fonts into document head for builder preview
  useEffect(() => {
    const collected = collectBuilderFonts(template, globalFonts);

    const googleFamilies: string[] = [];
    for (const { family, url } of collected) {
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
      collected
        .filter((font) => Boolean(font.url))
        .map((font) => `font-face-${font.family.replace(/\s+/g, "-")}`)
    );

    Array.from(document.querySelectorAll('style[id^="font-face-"]')).forEach((node) => {
      if (!managedLocalStyleIds.has(node.id)) {
        node.remove();
      }
    });

    if (googleFamilies.length > 0) {
      const id = "google-fonts-builder";
      const url = `https://fonts.googleapis.com/css2?${googleFamilies
        .map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`)
        .join("&")}&display=swap`;
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
  }, [globalFonts, template.blocks, template.theme.customFonts, template.theme.fonts.body, template.theme.fonts.heading]);

  const handleSave = useCallback(async () => {
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
        toast.success("Template sauvegardé ✓");
      } else {
        toast.error("Échec de la sauvegarde");
      }
    } catch {
      toast.error("Erreur réseau lors de la sauvegarde");
    }
    setSaving(false);
  }, [template, templateId, setSaving]);

  // Ctrl+S shortcut
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

  const hasVideoBlock = template.blocks.some((b) => b.type === "video");

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      {/* ── Header toolbar ──────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 bg-white border-b border-gray-200 px-4 h-12 shrink-0">
        <span className="font-semibold text-gray-900 text-sm">{templateName}</span>
        <span className="text-gray-300">|</span>

        {/* Format selector */}
        <select
          value={template.canvas.format}
          onChange={(e) => useBuilderStore.getState().setFormat(e.target.value as never)}
          className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
        >
          {Object.entries(CANVAS_FORMATS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>

        {template.canvas.format === "CUSTOM" ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={template.canvas.width}
              onChange={(e) => updateCanvas({ width: Math.max(1, Number(e.target.value) || 1), format: "CUSTOM" })}
              className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
              aria-label="Largeur personnalisee"
            />
            <span className="text-xs text-gray-400">x</span>
            <input
              type="number"
              min={1}
              value={template.canvas.height}
              onChange={(e) => updateCanvas({ height: Math.max(1, Number(e.target.value) || 1), format: "CUSTOM" })}
              className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
              aria-label="Hauteur personnalisee"
            />
          </div>
        ) : null}

        {/* Max video duration — visible only when template has a VideoBlock */}
        {hasVideoBlock ? (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-gray-500">Durée max</span>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="auto"
              value={template.canvas.maxDuration ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                updateCanvas({ maxDuration: raw === "" ? undefined : Math.max(1, Number(raw) || 1) });
              }}
              className="w-20 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
              aria-label="Durée maximale de la vidéo (secondes)"
              title="Durée maximale de la vidéo de sortie en secondes. Vide = durée de la vidéo source."
            />
            <span className="text-xs text-gray-400">s</span>
          </div>
        ) : null}

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={undo}
            disabled={past.length === 0}
            title="Annuler (Ctrl+Z)"
            className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
          >
            ↩ Annuler
          </button>
          <button
            onClick={redo}
            disabled={future.length === 0}
            title="Rétablir (Ctrl+Y)"
            className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded disabled:opacity-30"
          >
            ↪ Rétablir
          </button>
        </div>

        <div className="flex-1" />

        <a
          href={`/preview/${templateId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          👁 Aperçu
        </a>
        <a
          href={`/preview/${templateId}?debug=layout`}
          target="_blank"
          className="text-xs px-3 py-1.5 border border-amber-300 bg-amber-50 rounded-lg text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Debug layout
        </a>
        <a
          href={`/generate/${templateId}`}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Générer →
        </a>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-60 transition-colors"
        >
          {isSaving ? "Sauvegarde…" : "Sauvegarder"}
        </button>
      </header>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: tabbed panel */}
        <div className={`flex flex-col shrink-0 border-r border-gray-200 bg-white transition-[width] duration-200 ${leftPanelCollapsed ? "w-12" : "w-[15.75rem] xl:w-[17rem]"}`}>
          {/* Tab bar */}
          <div className={`shrink-0 border-b border-gray-100 bg-gray-50/70 ${leftPanelCollapsed ? "px-1 py-1" : "px-1.5 pt-1"}`}>
            {leftPanelCollapsed ? (
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLeftPanelCollapsed(false)}
                  title="Ouvrir le panneau"
                  className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                >
                  ›
                </button>
                {(["blocs", "schema"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setLeftTab(tab);
                      setLeftPanelCollapsed(false);
                    }}
                    title={tab === "blocs" ? "Blocs" : "Schéma"}
                    className={`h-8 w-8 rounded-lg border text-xs transition-colors ${
                      leftTab === tab
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                        : "border-transparent text-gray-400 hover:border-gray-200 hover:bg-white hover:text-gray-600"
                    }`}
                  >
                    {tab === "blocs" ? "▦" : "☰"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {(["blocs", "schema"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setLeftTab(tab)}
                    className={`flex-1 rounded-t-lg text-[11px] py-2 font-medium transition-colors ${
                      leftTab === tab
                        ? "bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm"
                        : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {tab === "blocs" ? "▦ Blocs" : "☰ Schéma"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLeftPanelCollapsed(true)}
                  title="Réduire le panneau"
                  className="mb-1 h-8 w-8 shrink-0 rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
                >
                  ‹
                </button>
              </div>
            )}
          </div>
          {/* Panel content */}
          {!leftPanelCollapsed ? (
            <div className="flex-1 overflow-hidden">
              {leftTab === "blocs" ? <BlocksPanel /> : <SchemaPanel />}
            </div>
          ) : null}
        </div>

        {/* Center: Canvas */}
        <Canvas
          onLayoutDebugSnapshotChange={setLayoutDebugSnapshot}
          showResolvedTextPreview={showResolvedTextPreview}
        />

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

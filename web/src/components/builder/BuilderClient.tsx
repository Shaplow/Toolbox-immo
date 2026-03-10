"use client";

import { useEffect, useCallback, useState } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import { toast } from "@/components/ui/Toast";
import type { TemplateJSON } from "@/types/template";
import { CANVAS_FORMATS } from "@/types/template";
import { BlocksPanel } from "./BlocksPanel";
import { Canvas } from "./Canvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { SchemaPanel } from "./SchemaPanel";

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
  const { template, setTemplate, isSaving, setSaving, undo, redo, past, future } =
    useBuilderStore();
  const [leftTab, setLeftTab] = useState<"blocs" | "schema">("blocs");

  // Init store with server data
  useEffect(() => {
    setTemplate(initialJSON);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Inject custom fonts into document head for builder preview
  useEffect(() => {
    const fonts = template.theme.customFonts ?? [];
    const googleFamilies: string[] = [];
    for (const font of fonts) {
      if (font.url) {
        const id = `font-face-${font.family.replace(/\s+/g, "-")}`;
        if (!document.getElementById(id)) {
          const s = document.createElement("style");
          s.id = id;
          s.textContent = `@font-face{font-family:'${font.family}';src:url('${font.url}');font-display:swap;}`;
          document.head.appendChild(s);
        }
      } else {
        googleFamilies.push(font.family);
      }
    }
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
    }
  }, [template.theme.customFonts]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonData: template,
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
          href={`/api/preview/${templateId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          👁 Aperçu
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
        <div className="flex flex-col w-56 shrink-0 border-r border-gray-200 bg-white">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 shrink-0">
            {(["blocs", "schema"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`flex-1 text-[11px] py-2 font-medium transition-colors ${
                  leftTab === tab
                    ? "text-indigo-700 border-b-2 border-indigo-600"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {tab === "blocs" ? "▦ Blocs" : "☰ Schéma"}
              </button>
            ))}
          </div>
          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {leftTab === "blocs" ? <BlocksPanel /> : <SchemaPanel />}
          </div>
        </div>

        {/* Center: Canvas */}
        <Canvas />

        {/* Right: Properties panel */}
        <PropertiesPanel />
      </div>
    </div>
  );
}

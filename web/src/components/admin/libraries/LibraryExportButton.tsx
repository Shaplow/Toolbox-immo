"use client";

import { useState, useRef, useEffect } from "react";
import { Download, FileJson, Film, Loader2, ChevronDown } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface Props {
  libraryId: string;
  libraryName: string;
  libraryType: "media" | "data";
}

interface ExportOptions {
  includeFiles: boolean;
  includeUsage: boolean;
  includeAccess: boolean;
}

export function LibraryExportButton({ libraryId, libraryName, libraryType }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ExportOptions>({
    includeFiles: false,
    includeUsage: true,
    includeAccess: true,
  });

  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        includeFiles: String(options.includeFiles),
        includeUsage: String(options.includeUsage),
      });
      const res = await fetch(`/api/admin/libraries/${libraryId}/export?${params.toString()}`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `Erreur serveur (HTTP ${res.status})`);
      }

      // Surface any R2 file warnings
      const warningsHeader = res.headers.get("X-Export-Warnings");
      if (warningsHeader) {
        try {
          const w = JSON.parse(warningsHeader) as string[];
          if (w.length > 0) {
            toast.info(`Export terminé avec ${w.length} avertissement${w.length > 1 ? "s" : ""} : ${w.slice(0, 2).join(", ")}${w.length > 2 ? "…" : ""}`);
          }
        } catch { /* ignore */ }
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `library-${libraryId}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du téléchargement");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((v) => !v); setError(null); }}
        className="flex items-center gap-1 px-3.5 py-2.5 text-gray-300 hover:text-indigo-500 transition-colors"
        title={`Exporter « ${libraryName} »`}
      >
        <Download size={14} />
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-3">
          <p className="text-xs font-semibold text-gray-700">Exporter la bibliothèque</p>

          {/* File mode — media only */}
          {libraryType === "media" && (
            <div className="flex gap-2">
              <button
                onClick={() => setOptions((o) => ({ ...o, includeFiles: false }))}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-colors ${
                  !options.includeFiles
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                }`}
              >
                <FileJson size={16} />
                Métadonnées
              </button>
              <button
                onClick={() => setOptions((o) => ({ ...o, includeFiles: true }))}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-colors ${
                  options.includeFiles
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                }`}
              >
                <Film size={16} />
                + Fichiers
              </button>
            </div>
          )}

          {/* Options checkboxes */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeUsage}
                onChange={(e) => setOptions((o) => ({ ...o, includeUsage: e.target.checked }))}
                className="w-3.5 h-3.5 rounded accent-indigo-600"
              />
              <span className="text-xs text-gray-600">Inclure les compteurs d&rsquo;utilisation</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeAccess}
                onChange={(e) => setOptions((o) => ({ ...o, includeAccess: e.target.checked }))}
                className="w-3.5 h-3.5 rounded accent-indigo-600"
              />
              <span className="text-xs text-gray-600">Inclure les accès par compte</span>
            </label>
          </div>

          {options.includeFiles && libraryType === "media" && (
            <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
              Le téléchargement des fichiers peut prendre plusieurs minutes selon la taille de la bibliothèque.
            </p>
          )}

          {error && (
            <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{error}</p>
          )}

          <button
            onClick={() => { void handleExport(); }}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> Téléchargement…</>
              : <><Download size={13} /> Télécharger le ZIP</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

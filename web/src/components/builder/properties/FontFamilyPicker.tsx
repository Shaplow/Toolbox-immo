"use client";

import { useEffect, useRef, useState } from "react";
import type { BuilderFontEntry } from "@/lib/builderFonts";
import { useBuilderFontStatus } from "@/components/builder/BuilderFontStatusContext";
import { sourceLabel } from "./utils";

export function FontFamilyPicker({
  value,
  fonts,
  onChange,
}: {
  value?: string;
  fonts: BuilderFontEntry[];
  onChange: (fontFamily: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const { failedFamilies } = useBuilderFontStatus();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(value ?? "");
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(value ?? "");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [value]);

  const filteredFonts = fonts.filter((font) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return font.family.toLowerCase().includes(normalizedQuery);
  });

  const selectedFont = fonts.find((font) => font.family === value);

  return (
    <div ref={rootRef} className="relative">
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="w-full rounded border border-border bg-white px-2 py-2 text-left transition hover:border-indigo-300"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm text-foreground"
                style={value ? { fontFamily: value } : undefined}
              >
                {value || "Choisir une typographie"}
              </p>
              <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                {selectedFont ? sourceLabel(selectedFont.source) : "Toutes les typographies disponibles"}
              </p>
              {value && failedFamilies.has(value) ? (
                <p className="truncate text-[10px] font-medium text-warning-700">⚠ Ne charge pas dans l&apos;aperçu</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
          </div>
        </button>

        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Retirer la police du bloc
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-white shadow-xl">
          <div className="border-b border-border p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une typographie"
              className="w-full rounded-lg border border-border px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {filteredFonts.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Aucune typographie correspondante.</p>
            ) : (
              <div className="space-y-1">
                {filteredFonts.map((font) => {
                  const isSelected = font.family === value;
                  return (
                    <button
                      key={font.family}
                      type="button"
                      onClick={() => {
                        onChange(font.family);
                        setQuery(font.family);
                        setOpen(false);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-indigo-200 bg-indigo-50"
                          : "border-transparent hover:border-border hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-base text-foreground"
                            style={{ fontFamily: font.family }}
                          >
                            {font.family}
                          </p>
                          <p
                            className="truncate text-[11px] text-muted-foreground"
                            style={{ fontFamily: font.family }}
                          >
                            Apercu Aa Bb Cc 123
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="rounded-full bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {sourceLabel(font.source)}
                          </span>
                          {failedFamilies.has(font.family) ? (
                            <span
                              className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-medium text-warning-700"
                              title="Google ne fournit pas cette police (nom ou graisse inexistante)"
                            >
                              ⚠ ne charge pas
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

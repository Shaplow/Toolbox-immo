"use client";

import { useEffect, useRef, useState } from "react";
import type { BuilderFontEntry } from "@/lib/builderFonts";
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
          className="w-full rounded border border-gray-200 bg-white px-2 py-2 text-left transition hover:border-indigo-300"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm text-gray-900"
                style={value ? { fontFamily: value } : undefined}
              >
                {value || "Choisir une typographie"}
              </p>
              <p className="truncate text-[10px] uppercase tracking-wide text-gray-400">
                {selectedFont ? sourceLabel(selectedFont.source) : "Toutes les typographies disponibles"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-gray-400">{open ? "▲" : "▼"}</span>
          </div>
        </button>

        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] text-gray-500 hover:text-gray-700"
          >
            Retirer la police du bloc
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une typographie"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {filteredFonts.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-gray-400">Aucune typographie correspondante.</p>
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
                          : "border-transparent hover:border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-base text-gray-900"
                            style={{ fontFamily: font.family }}
                          >
                            {font.family}
                          </p>
                          <p
                            className="truncate text-[11px] text-gray-500"
                            style={{ fontFamily: font.family }}
                          >
                            Apercu Aa Bb Cc 123
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500">
                          {sourceLabel(font.source)}
                        </span>
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

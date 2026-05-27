"use client";

/**
 * AdminCommandPalette — Cmd+K (ou Ctrl+K) ouvre une recherche transverse
 * ADMIN sur clients, comptes IG, templates, presets et slots récents.
 *
 * Mounté dans (app)/layout uniquement pour ADMIN réel (pas en impersonation).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Building2,
  Instagram,
  LayoutTemplate,
  Film,
  FileText,
  Library,
  Database,
  Layers,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Kind =
  | "client"
  | "account"
  | "template"
  | "preset"
  | "slot"
  | "mediaLibrary"
  | "dataLibrary"
  | "dataCampaign";

interface SearchResultItem {
  kind: Kind;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

const KIND_ICON: Record<Kind, LucideIcon> = {
  client: Building2,
  account: Instagram,
  template: LayoutTemplate,
  preset: Film,
  slot: FileText,
  mediaLibrary: Library,
  dataLibrary: Database,
  dataCampaign: Layers,
};

const KIND_LABEL: Record<Kind, string> = {
  client: "Clients",
  account: "Comptes",
  template: "Templates",
  preset: "Presets",
  slot: "Publications",
  mediaLibrary: "Bibliothèques médias",
  dataLibrary: "Bibliothèques données",
  dataCampaign: "Campagnes",
};

const KIND_ORDER: Kind[] = [
  "slot",
  "account",
  "client",
  "template",
  "preset",
  "mediaLibrary",
  "dataLibrary",
  "dataCampaign",
];

export function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K pour ouvrir
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input à l'ouverture
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setFocusIdx(0);
    }
  }, [open]);

  // Debounce search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { results: SearchResultItem[] };
        // Réordonner par catégorie (slots d'abord pour les recherches contextuelles)
        data.results.sort(
          (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
        );
        setResults(data.results);
        setFocusIdx(0);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [open, query]);

  function navigate(item: SearchResultItem) {
    setOpen(false);
    router.push(item.href);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[focusIdx];
      if (target) navigate(target);
    }
  }

  if (!open) return null;

  // Group results by kind, dans l'ordre KIND_ORDER, en gardant l'index global
  // (pour l'arrow-nav qui parcourt la liste plate).
  const grouped: { kind: Kind; items: { item: SearchResultItem; idx: number }[] }[] = [];
  results.forEach((item, idx) => {
    const last = grouped[grouped.length - 1];
    if (last && last.kind === item.kind) {
      last.items.push({ item, idx });
    } else {
      grouped.push({ kind: item.kind, items: [{ item, idx }] });
    }
  });

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-50"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 top-20 z-50 flex justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl pointer-events-auto overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-2 px-4 border-b border-gray-100">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher clients, comptes, templates, presets, publications…"
              className="flex-1 py-4 text-sm focus:outline-none placeholder:text-gray-400"
            />
            {loading && <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />}
            <kbd className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ESC</kbd>
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto py-1">
            {query.trim().length < 2 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">
                Tapez au moins 2 caractères pour rechercher.
              </p>
            ) : !loading && results.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">
                Aucun résultat pour « {query.trim()} ».
              </p>
            ) : (
              grouped.map((group) => {
                const Icon = KIND_ICON[group.kind];
                return (
                  <div key={group.kind} className="py-1">
                    <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      {KIND_LABEL[group.kind]}
                    </p>
                    {group.items.map(({ item, idx }) => (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onClick={() => navigate(item)}
                        onMouseEnter={() => setFocusIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                          idx === focusIdx ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <Icon size={14} className={idx === focusIdx ? "text-indigo-500" : "text-gray-400"} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{item.label}</p>
                          {item.sublabel && (
                            <p className={`text-xs truncate ${idx === focusIdx ? "text-indigo-500" : "text-gray-400"}`}>
                              {item.sublabel}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
            <span className="flex items-center gap-2">
              <kbd className="font-mono bg-white border border-gray-200 px-1 rounded">↑↓</kbd>
              naviguer
              <kbd className="font-mono bg-white border border-gray-200 px-1 rounded">↵</kbd>
              ouvrir
            </span>
            <span>
              <kbd className="font-mono bg-white border border-gray-200 px-1 rounded">⌘K</kbd>
              ouvrir
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

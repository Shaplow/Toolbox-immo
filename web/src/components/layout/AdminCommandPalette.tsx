"use client";

/**
 * AdminCommandPalette — Cmd+K (ou Ctrl+K) ouvre une recherche transverse
 * ADMIN sur clients, comptes IG, templates, presets et slots récents.
 *
 * Mounté dans (app)/layout uniquement pour ADMIN réel (pas en impersonation).
 *
 * Phase 6.1 Session 3 :
 * - Migration visuelle Liquid Glass (cohérent CommandPalette primitive
 *   Phase 3 Lot 3) sans toucher à la logique métier (fetch /api/admin/search).
 * - Portal vers document.body (échappe au containing block backdrop-filter).
 * - Listener event "admin:open-palette" pour permettre l'ouverture depuis
 *   le bouton "Rechercher [⌘K]" dans AppNav (audit UX important #6 —
 *   palette discoverable).
 * - Kbd primitive pour ⌘K / ↑↓ / ↵ / ESC.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { Kbd } from "@/components/ui/Kbd";

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
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Cmd+K / Ctrl+K + ESC.
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

  // Listener custom : permet l'ouverture depuis la nav (bouton ⌘K).
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("admin:open-palette", handler);
    return () => window.removeEventListener("admin:open-palette", handler);
  }, []);

  // Focus input à l'ouverture.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setFocusIdx(0);
    }
  }, [open]);

  // Debounce search.
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

  if (!open || !mounted) return null;

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

  return createPortal(
    <>
      {/* Backdrop : juste blur, pas de dim gris (cohérent Modal/Drawer
          Liquid Glass — le panel ressort par son halo). */}
      <div
        className="fixed inset-0 backdrop-blur-[12px] backdrop-saturate-110 z-50"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche admin"
        className="fixed inset-x-0 top-[15vh] z-50 flex justify-center px-4 pointer-events-none"
      >
        <div
          className={[
            "pointer-events-auto w-full max-w-xl rounded-2xl overflow-hidden",
            "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150",
            "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.12),0_32px_72px_-12px_rgba(15,23,42,0.22)]",
          ].join(" ")}
        >
          {/* Input */}
          <div className="flex items-center gap-2.5 px-4 py-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.4)]">
            <Search size={16} className="text-gray-500 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher clients, comptes, templates, presets, publications…"
              className="flex-1 py-1 text-[14px] text-gray-950 bg-transparent focus:outline-none placeholder:text-gray-400"
            />
            {loading && <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />}
            <Kbd>Esc</Kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto py-2 [scrollbar-width:thin]">
            {query.trim().length < 2 ? (
              <p className="px-4 py-6 text-[12px] text-gray-500 text-center">
                Tapez au moins 2 caractères pour rechercher.
              </p>
            ) : !loading && results.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-gray-500 text-center">
                Aucun résultat pour « {query.trim()} ».
              </p>
            ) : (
              grouped.map((group) => {
                const Icon = KIND_ICON[group.kind];
                return (
                  <div key={group.kind} className="py-1">
                    <p className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-widest text-gray-500">
                      {KIND_LABEL[group.kind]}
                    </p>
                    {group.items.map(({ item, idx }) => {
                      const isFocused = idx === focusIdx;
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() => navigate(item)}
                          onMouseEnter={() => setFocusIdx(idx)}
                          className={[
                            "w-[calc(100%-1rem)] mx-2 my-0.5 rounded-md inline-flex items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors",
                            isFocused
                              ? "bg-white/80 backdrop-blur-[8px] text-gray-950 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)]"
                              : "text-gray-700",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md backdrop-blur-[6px]",
                              isFocused
                                ? "bg-sky-100/70 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.18)]"
                                : "bg-white/60 text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
                            ].join(" ")}
                          >
                            <Icon size={14} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium leading-tight">{item.label}</p>
                            {item.sublabel && (
                              <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">
                                {item.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white/40 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] text-[10px] text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              naviguer
              <Kbd>↵</Kbd>
              ouvrir
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
              ouvrir
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

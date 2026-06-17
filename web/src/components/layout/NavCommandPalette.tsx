"use client";

/**
 * NavCommandPalette — palette ⌘K légère pour les rôles non-admin.
 *
 * Pas de fetch serveur (la search admin via /api/admin/search reste réservée
 * à l'admin). Affiche uniquement les commandes du registry filtrées par rôle :
 * navigation + actions globales accessibles.
 *
 * Mounted par CommandPaletteHost pour MONTEUR / CM / VIDEASTE / EXTERNAL.
 *
 * Pattern Liquid Glass cohérent avec AdminCommandPalette.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Kbd } from "@/components/ui/Kbd";
import { KbdChord } from "@/components/ui/Kbd";
import {
  type Command,
  type CommandUser,
  fuzzyScore,
  groupCommands,
  filterCommands,
  GROUP_LABELS,
} from "@/lib/commands/registry";
import { NAVIGATION_COMMANDS } from "@/lib/commands/navigation";
import { GLOBAL_COMMANDS } from "@/lib/commands/global-actions";

interface Props {
  user: CommandUser;
}

export function NavCommandPalette({ user }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // ⌘K + ESC
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

  // Event "palette:open" pour ouverture programmée depuis la nav.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("palette:open", handler);
    return () => window.removeEventListener("palette:open", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setFocusIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const allCommands = [...NAVIGATION_COMMANDS, ...GLOBAL_COMMANDS];
    const allowed = filterCommands(allCommands, user);
    const scored = allowed
      .map((cmd) => ({ cmd, score: fuzzyScore(cmd, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.cmd);
  }, [user, query]);

  const grouped = useMemo(() => groupCommands(filtered), [filtered]);

  // Flat list pour la nav clavier.
  const flatList: Command[] = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped],
  );

  function runCommand(cmd: Command) {
    void cmd.run({
      push: (href) => router.push(href),
      replace: (href) => router.replace(href),
      closePalette: () => setOpen(false),
    });
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (flatList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % flatList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + flatList.length) % flatList.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = flatList[focusIdx];
      if (target) runCommand(target);
    }
  }

  if (!open || !mounted) return null;

  let flatIdx = -1;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        className="fixed inset-x-0 top-[15vh] z-50 flex justify-center px-4 pointer-events-none"
      >
        <div
          className={[
            "pointer-events-auto w-full max-w-xl rounded-2xl overflow-hidden",
            "bg-popover border border-border",
            "",
          ].join(" ")}
        >
          {/* Input */}
          <div className="flex items-center gap-2.5 px-4 py-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.4)]">
            <Search size={16} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Que veux-tu faire ?"
              className="flex-1 py-1 text-[14px] text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground"
            />
            <Loader2
              size={14}
              className={`text-muted-foreground shrink-0 ${
                query ? "opacity-0" : "opacity-0"
              }`}
            />
            <Kbd>Esc</Kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto py-2 [scrollbar-width:thin]">
            {grouped.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-muted-foreground text-center">
                Aucune commande pour « {query.trim()} ».
              </p>
            ) : (
              grouped.map(({ group, items }) => (
                <div key={group} className="py-1">
                  <p className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </p>
                  {items.map((cmd) => {
                    flatIdx += 1;
                    const isFocused = flatIdx === focusIdx;
                    const Icon = cmd.icon;
                    const currentIdx = flatIdx;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onClick={() => runCommand(cmd)}
                        onMouseEnter={() => setFocusIdx(currentIdx)}
                        className={[
                          "w-[calc(100%-1rem)] mx-2 my-0.5 rounded-md inline-flex items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors",
                          isFocused
                            ? "bg-card text-foreground "
                            : "text-foreground",
                        ].join(" ")}
                      >
                        {Icon && (
                          <span
                            className={[
                              "shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md ",
                              isFocused
                                ? "bg-info-100/70 text-info-700 "
                                : "bg-white/60 text-gray-600 ",
                            ].join(" ")}
                          >
                            <Icon size={14} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium leading-tight">
                            {cmd.label}
                          </p>
                          {cmd.description && (
                            <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                              {cmd.description}
                            </p>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <KbdChord keys={cmd.shortcut} size="sm" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              naviguer
              <Kbd>↵</Kbd>
              exécuter
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

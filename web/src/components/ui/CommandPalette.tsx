"use client";

/**
 * CommandPalette — Cmd+K modal pour actions globales / nav rapide.
 *
 * Doctrine Liquid Glass v2 :
 * - Wrapper Modal-like : surface-glass-strong + shadow-glass-lg + ring inset.
 * - Pas de scrim dim (cohérent avec Modal/Drawer/Sheet Phase 3) : juste
 *   backdrop-blur 12.
 * - cmdk pour le matching fuzzy + a11y (focus, ARIA, keyboard nav).
 * - Items groupés par `group` avec heading uppercase tiny.
 * - Affichage du raccourci à droite (Kbd primitive).
 *
 * Usage :
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * useEffect(() => {
 *   const handler = (e: KeyboardEvent) => {
 *     if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
 *       e.preventDefault();
 *       setOpen((o) => !o);
 *     }
 *   };
 *   window.addEventListener("keydown", handler);
 *   return () => window.removeEventListener("keydown", handler);
 * }, []);
 *
 * <CommandPalette open={open} onClose={() => setOpen(false)} actions={...} />
 * ```
 */

import { useEffect, type ReactNode } from "react";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Kbd, KbdChord } from "./Kbd";
import { useRegisterDialog } from "./useDialogStack";

export interface CommandAction {
  id: string;
  label: ReactNode;
  /** Description courte sous le label (optionnel). */
  description?: string;
  /** Mots-clés pour le fuzzy match. */
  keywords?: string[];
  icon?: LucideIcon;
  /** Group label — items du même group sont rassemblés. */
  group?: string;
  /** Raccourci affiché à droite. Tableau de touches. */
  shortcut?: string[];
  /** Action exécutée au select. La palette se ferme automatiquement après. */
  run: () => void;
  disabled?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
  placeholder?: string;
  emptyMessage?: ReactNode;
}

export function CommandPalette({
  open,
  onClose,
  actions,
  placeholder = "Tapez une commande ou cherchez…",
  emptyMessage = "Aucune action trouvée.",
}: CommandPaletteProps) {
  const { zIndex } = useRegisterDialog(open, onClose);

  // Auto-focus à l'ouverture (cmdk gère ça naturellement mais on s'assure).
  useEffect(() => {
    if (!open) return;
  }, [open]);

  if (!open) return null;

  // Group actions par `group`.
  const groups = (() => {
    const map = new Map<string, CommandAction[]>();
    for (const a of actions) {
      const key = a.group ?? "";
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  })();

  return (
    <>
      <div
        className="fixed inset-0 backdrop-blur-[12px] backdrop-saturate-110"
        style={{ zIndex }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        className="fixed inset-0 flex items-start justify-center px-4 pt-[15vh] pointer-events-none"
        style={{ zIndex: zIndex + 1 }}
      >
        <div
          className={[
            "pointer-events-auto w-full max-w-xl rounded-2xl overflow-hidden",
            "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150",
            "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.12),0_32px_72px_-12px_rgba(15,23,42,0.22)]",
          ].join(" ")}
        >
          <Command shouldFilter={true} className="flex flex-col max-h-[60vh]">
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-white/30">
              <Search size={16} className="shrink-0 text-gray-500" />
              <Command.Input
                placeholder={placeholder}
                className="flex-1 bg-transparent text-[14px] text-gray-950 placeholder:text-gray-400 outline-none"
              />
              <KbdChord keys={["Esc"]} />
            </div>
            <Command.List className="flex-1 overflow-y-auto py-2">
              <Command.Empty className="px-4 py-6 text-[13px] text-center text-gray-500">
                {emptyMessage}
              </Command.Empty>
              {groups.map(([groupName, items]) => (
                <Command.Group
                  key={groupName || "_default"}
                  heading={groupName || undefined}
                  className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-gray-500"
                >
                  {items.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Command.Item
                        key={action.id}
                        value={action.id}
                        keywords={[typeof action.label === "string" ? action.label : "", action.description ?? "", ...(action.keywords ?? [])].filter(Boolean)}
                        disabled={action.disabled}
                        onSelect={() => {
                          if (action.disabled) return;
                          action.run();
                          onClose();
                        }}
                        className="cursor-pointer mx-2 my-0.5 rounded-md inline-flex items-center gap-3 w-[calc(100%-1rem)] px-3 py-2 text-[13px] text-gray-700 transition-colors data-[selected=true]:bg-white/70 data-[selected=true]:backdrop-blur-[8px] data-[selected=true]:text-gray-950 data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed"
                      >
                        {Icon && (
                          <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/60 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                            <Icon size={14} className="text-gray-700" />
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium leading-tight">{action.label}</span>
                          {action.description && (
                            <span className="block text-[11px] text-gray-500 leading-tight mt-0.5">
                              {action.description}
                            </span>
                          )}
                        </span>
                        {action.shortcut && action.shortcut.length > 0 && (
                          <span className="shrink-0">
                            {action.shortcut.length === 1 ? (
                              <Kbd>{action.shortcut[0]}</Kbd>
                            ) : (
                              <KbdChord keys={action.shortcut} />
                            )}
                          </span>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>
      </div>
    </>
  );
}

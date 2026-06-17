"use client";

/**
 * CommandPalette — Cmd+K modal pour actions globales / nav rapide.
 *
 * Scrim solid zinc-950/50. Panel bg-popover border-border shadow-lg.
 * cmdk pour matching fuzzy + a11y. Items groupés par `group`.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Kbd, KbdChord } from "./Kbd";
import { useRegisterDialog } from "./useDialogStack";

export interface CommandAction {
  id: string;
  label: ReactNode;
  description?: string;
  keywords?: string[];
  icon?: LucideIcon;
  group?: string;
  shortcut?: string[];
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

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

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-zinc-950/50"
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
        <div className="pointer-events-auto w-full max-w-xl rounded-lg overflow-hidden bg-popover text-popover-foreground border border-border shadow-lg">
          <Command shouldFilter={true} className="flex flex-col max-h-[60vh]">
            <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-border">
              <Search size={16} className="shrink-0 text-muted-foreground" />
              <Command.Input
                placeholder={placeholder}
                className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
              />
              <KbdChord keys={["Esc"]} />
            </div>
            <Command.List className="flex-1 overflow-y-auto py-2">
              <Command.Empty className="px-4 py-6 text-[13px] text-center text-muted-foreground">
                {emptyMessage}
              </Command.Empty>
              {groups.map(([groupName, items]) => (
                <Command.Group
                  key={groupName || "_default"}
                  heading={groupName || undefined}
                  className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                        className="cursor-pointer mx-2 my-0.5 rounded-md inline-flex items-center gap-3 w-[calc(100%-1rem)] px-3 py-2 text-[13px] text-foreground transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed"
                      >
                        {Icon && (
                          <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted border border-border">
                            <Icon size={14} className="text-muted-foreground" />
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium leading-tight">{action.label}</span>
                          {action.description && (
                            <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">
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
    </>,
    document.body,
  );
}

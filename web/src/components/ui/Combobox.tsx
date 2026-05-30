"use client";

/**
 * Combobox — Select avec recherche fuzzy basée sur cmdk.
 *
 * À utiliser à la place de Select natif quand :
 * - La liste d'options est longue (> 10)
 * - On veut une recherche par mot-clé
 * - On veut autoriser une valeur custom (allowCustom)
 *
 * Doctrine Liquid Glass v2 :
 * - Trigger button : même look que Input/Select default (glass tinté sky).
 * - Popover : surface-glass-strong + shadow-glass-popover + ring inset.
 * - Items : hover white/70 + ring inset spéculaire (cohérent DropdownMenu).
 * - cmdk fait le matching fuzzy automatiquement.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ComboboxOption {
  value: string;
  label: string;
  /** Mots-clés additionnels pour le fuzzy match. */
  keywords?: string[];
  /** Group label — items du même group sont rassemblés visuellement. */
  group?: string;
  /** Icône optionnelle à gauche de l'item dans la liste. */
  icon?: LucideIcon;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[] | ReadonlyArray<ComboboxOption>;
  placeholder?: string;
  /** Message quand aucun résultat. */
  emptyMessage?: ReactNode;
  /** Autorise une valeur tapée non présente dans les options. */
  allowCustom?: boolean;
  /** Affiche un spinner dans le trigger. */
  loading?: boolean;
  /** Désactive entièrement le combobox. */
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Sélectionner…",
  emptyMessage = "Aucun résultat.",
  allowCustom = false,
  loading = false,
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Position du popover (portalé sur body) : recalculée from trigger rect.
  // Position absolue dans le viewport — évite tout clipping par overflow ancestors.
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Mounted gate pour SSR (createPortal a besoin de document).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Recalcule la position du popover en fonction de la position du trigger.
  // On utilise les coords ABSOLUES (rect + window.scrollX/Y) car le popover est
  // portalé dans document.body avec `position: absolute`. Cette approche est
  // robuste contre les containing blocks parents (transform, backdrop-filter)
  // qui cassent `position: fixed` dans certains navigateurs.
  const updatePosition = () => {
    const trig = triggerRef.current;
    if (!trig) return;
    const rect = trig.getBoundingClientRect();
    const POPOVER_MAX_HEIGHT = 280; // matches max-h-60 (240px) + header ~40px
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < POPOVER_MAX_HEIGHT && rect.top > spaceBelow;
    const gap = 6;
    const topInViewport = flipUp ? rect.top - gap - POPOVER_MAX_HEIGHT : rect.bottom + gap;
    setPopoverPos({
      top: topInViewport + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  };

  // Initial position + recalc sur scroll/resize tant que le popover est ouvert.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Close on outside click / ESC. Le popover étant portalé, il faut aussi
  // vérifier que le click n'est pas dedans (sinon click sur option fermerait).
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  // Group options par `group`.
  const groups = (() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const opt of options) {
      const key = opt.group ?? "";
      const arr = map.get(key) ?? [];
      arr.push(opt);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  })();

  const selectedLabel = options.find((o) => o.value === value)?.label ?? (allowCustom ? value : "");

  return (
    <div ref={containerRef} className={["relative w-full", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={[
          "group/cmb flex items-center gap-2 w-full h-8 rounded-md px-2.5 text-[13px] text-left transition-colors",
          "bg-white/65 backdrop-blur-[10px] backdrop-saturate-150",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)]",
          "hover:bg-white/80 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_0_0_1px_rgba(15,23,42,0.12)]",
          open ? "bg-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]" : "",
          "focus-ring disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        <span className={selectedLabel ? "flex-1 text-gray-950 truncate" : "flex-1 text-gray-400 truncate"}>
          {selectedLabel || placeholder}
        </span>
        {loading ? (
          <Loader2 size={14} className="shrink-0 text-gray-400 animate-spin" />
        ) : (
          <ChevronDown
            size={14}
            className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Popover portalé sur document.body : évite tout clipping par overflow ancestors
          (Modal Body, Drawer scroll, etc.) et tout conflit de stacking context. */}
      {open && mounted && popoverPos && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: popoverPos.top,
            left: popoverPos.left,
            width: popoverPos.width,
            zIndex: 9999,
          }}
          className={[
            "rounded-md overflow-hidden",
            "bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150",
            "shadow-[var(--shadow-glass-popover),var(--ring-glass-inset)]",
          ].join(" ")}
        >
          <Command shouldFilter={true}>
            <div className="flex items-center gap-2 border-b border-white/30 px-2.5 py-2">
              <Search size={14} className="shrink-0 text-gray-400" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Rechercher…"
                className="flex-1 bg-transparent text-[13px] text-gray-950 placeholder:text-gray-400 outline-none"
              />
            </div>
            <Command.List className="max-h-60 overflow-y-auto py-1">
              <Command.Empty className="px-3 py-3 text-[12px] text-gray-500">
                {emptyMessage}
              </Command.Empty>
              {allowCustom && search && !options.some((o) => o.value === search) && (
                <Command.Item
                  value={`__custom_${search}`}
                  onSelect={() => {
                    onChange(search);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="cursor-pointer px-3 py-1.5 text-[13px] text-gray-700 data-[selected=true]:bg-white/70 data-[selected=true]:backdrop-blur-[8px] data-[selected=true]:text-gray-950 data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                >
                  <span>Utiliser « {search} »</span>
                </Command.Item>
              )}
              {groups.map(([groupName, items]) => (
                <Command.Group
                  key={groupName || "_default"}
                  heading={groupName || undefined}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-gray-500"
                >
                  {items.map((opt) => {
                    const isSelected = opt.value === value;
                    const Icon = opt.icon;
                    return (
                      <Command.Item
                        key={opt.value}
                        value={opt.value}
                        keywords={[opt.label, ...(opt.keywords ?? [])]}
                        disabled={opt.disabled}
                        onSelect={() => {
                          if (opt.disabled) return;
                          onChange(opt.value);
                          setOpen(false);
                          setSearch("");
                        }}
                        className="cursor-pointer inline-flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-gray-700 transition-colors data-[selected=true]:bg-white/70 data-[selected=true]:backdrop-blur-[8px] data-[selected=true]:text-gray-950 data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed"
                      >
                        {Icon && <Icon size={14} className="shrink-0 text-gray-400" />}
                        <span className="flex-1">{opt.label}</span>
                        {isSelected && <Check size={14} className="shrink-0 text-gray-700" />}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>,
        document.body,
      )}
    </div>
  );
}

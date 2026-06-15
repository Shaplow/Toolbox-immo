"use client";

/**
 * Select — picker custom Liquid Glass (popover positionné DOM).
 *
 * Pourquoi pas le `<select>` natif ? Le popup natif macOS/Chrome bug avec
 * `backdrop-filter` sur les wrappers parents : positionnement aléatoire +
 * zoom forcé. Le custom popover règle ça en restant dans le DOM contrôlé.
 *
 * Cohérent visuellement avec DatePicker/TimePicker/Combobox (mêmes
 * shadows, mêmes hovers, même halo focus sky).
 *
 * API alignée avec <Input> :
 * - `value` / `onChange(value: string)` contrôlés.
 * - `options: { value, label, disabled? }[]`.
 * - `icon?` leading.
 * - `placeholder?` affiché quand value = "".
 * - `error?` : ring rouge + halo danger.
 * - `variant?` "default" (sky tinté) | "glass" (transparent).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[] | ReadonlyArray<SelectOption>;
  icon?: LucideIcon;
  placeholder?: string;
  error?: string;
  trailing?: ReactNode;
  variant?: "default" | "glass";
  disabled?: boolean;
  /** ID pour `aria-labelledby` externe. */
  id?: string;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  icon: Icon,
  placeholder,
  error,
  trailing,
  variant = "default",
  disabled = false,
  id,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(opt: SelectOption) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  // v3 big bang DA — flat shadcn. Variant glass mappé vers default.
  void variant;

  const triggerBase =
    "group/select flex items-center gap-2 w-full h-8 rounded-md transition-colors text-left bg-card border";

  const triggerState = error
    ? "border-danger-600 focus:ring-2 focus:ring-danger-600/30"
    : open
      ? "border-primary ring-2 ring-primary/30"
      : "border-input hover:border-zinc-300 focus:border-primary focus:ring-2 focus:ring-primary/30";

  const triggerDisabled = disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer";

  return (
    <div ref={containerRef} className={["relative w-full", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={error ? true : undefined}
        className={[triggerBase, triggerState, triggerDisabled].filter(Boolean).join(" ")}
      >
        {Icon && (
          <Icon
            size={14}
            className="shrink-0 ml-2.5 text-muted-foreground group-focus/select:text-foreground transition-colors"
          />
        )}
        <span
          className={[
            "flex-1 min-w-0 truncate text-[13px]",
            Icon ? "pl-0" : "pl-2.5",
            selected ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {selected ? selected.label : placeholder ?? ""}
        </span>
        {trailing ? (
          <span className="shrink-0 pr-2 text-[11px] text-muted-foreground">{trailing}</span>
        ) : (
          <ChevronDown
            size={14}
            className={`shrink-0 mr-2 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className="absolute top-full left-0 right-0 mt-1.5 z-50 max-h-72 overflow-y-auto rounded-md py-1 bg-popover text-popover-foreground border border-border shadow-lg"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => pick(opt)}
                  className={[
                    "w-full inline-flex items-center gap-2 px-3 py-1.5 text-[13px] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent",
                  ].join(" ")}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {isSelected && <Check size={14} className="shrink-0 text-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

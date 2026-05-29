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

  // ─── Styling cohérent avec Input/Combobox ────────────────────────────────

  const triggerBase =
    "group/select flex items-center gap-2 w-full h-8 rounded-md transition-colors text-left";
  const triggerVariantBase =
    variant === "glass"
      ? "bg-[var(--surface-glass-medium)] backdrop-blur-[8px] backdrop-saturate-150 border border-white/40"
      : "bg-sky-50/40 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)]";

  const triggerState = error
    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.55),0_1px_2px_rgba(220,38,38,0.1)] focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(220,38,38,0.7),0_0_0_3px_rgba(220,38,38,0.2)]"
    : open
      ? "bg-sky-50/65 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]"
      : "hover:bg-sky-50/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.12)] focus:bg-sky-50/65 focus:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]";

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
        className={[triggerBase, triggerVariantBase, triggerState, triggerDisabled].filter(Boolean).join(" ")}
      >
        {Icon && (
          <Icon
            size={14}
            className="shrink-0 ml-2.5 text-gray-400 group-focus/select:text-gray-700 transition-colors"
          />
        )}
        <span
          className={[
            "flex-1 min-w-0 truncate text-[13px]",
            Icon ? "pl-0" : "pl-2.5",
            selected ? "text-gray-950" : "text-gray-400",
          ].join(" ")}
        >
          {selected ? selected.label : placeholder ?? ""}
        </span>
        {trailing ? (
          <span className="shrink-0 pr-2 text-[11px] text-gray-400">{trailing}</span>
        ) : (
          <ChevronDown
            size={14}
            className={`shrink-0 mr-2 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className={[
            "absolute top-full left-0 right-0 mt-1.5 z-50 max-h-72 overflow-y-auto rounded-md py-1",
            "bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150",
            "shadow-[var(--shadow-glass-popover),var(--ring-glass-inset)]",
          ].join(" ")}
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
                      ? "bg-white/70 backdrop-blur-[8px] text-gray-950 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
                      : "text-gray-700 hover:bg-white/60 hover:text-gray-950",
                  ].join(" ")}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {isSelected && <Check size={14} className="shrink-0 text-gray-700" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

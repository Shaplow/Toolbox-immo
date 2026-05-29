"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Tabs — segmentation simple, 3 variants visuels.
 *
 * - `line` (default, Linear-like) : border-bottom-2 sous le tab actif.
 *   Pour les navigations principales de fiches / panneaux.
 * - `pill` : segmented control mono. Pour les filtres et sub-toggles
 *   compacts (genre "Tous · Actifs · Archivés").
 * - `glass` (Liquid Glass v2) : pill segmenté flottant — surface glass-soft
 *   + ring intérieur signature. Pour onglets sur surfaces glass / hero.
 *
 * Sizes : sm | md (default).
 *
 * État contrôlé : `value` + `onChange`. Items en array d'objets
 * { id, label, icon?, badge? }. Pour les contenus distincts par tab,
 * utiliser la convention React standard (afficher conditionnellement
 * le bon panel selon `value`).
 */

interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Badge inline (compte, "Nouveau", etc.) en string ou ReactNode. */
  badge?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "line" | "pill" | "glass";
  size?: "sm" | "md";
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = "line",
  size = "md",
  className,
}: TabsProps) {
  if (variant === "glass") return <GlassTabs items={items} value={value} onChange={onChange} size={size} className={className} />;
  if (variant === "pill") return <PillTabs items={items} value={value} onChange={onChange} size={size} className={className} />;
  return <LineTabs items={items} value={value} onChange={onChange} size={size} className={className} />;
}

function LineTabs({ items, value, onChange, size, className }: Required<Pick<TabsProps, "items" | "value" | "onChange">> & { size: "sm" | "md"; className?: string }) {
  const sizeCls = size === "sm" ? "h-7 px-2 text-[12px]" : "h-9 px-3 text-[13px]";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <div className={["flex items-center border-b border-gray-200", className ?? ""].filter(Boolean).join(" ")}>
      {items.map((item) => {
        const isActive = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => !item.disabled && onChange(item.id)}
            disabled={item.disabled}
            aria-selected={isActive}
            role="tab"
            className={`inline-flex items-center gap-1.5 -mb-px border-b-2 font-medium transition-colors focus-ring rounded-t-sm disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${
              isActive
                ? "border-gray-950 text-gray-950"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {Icon && <Icon size={iconSize} />}
            {item.label}
            {item.badge !== undefined && <span className="ml-0.5">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

function PillTabs({ items, value, onChange, size, className }: Required<Pick<TabsProps, "items" | "value" | "onChange">> & { size: "sm" | "md"; className?: string }) {
  const sizeCls = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <div className={["inline-flex items-center rounded-md border border-gray-200 bg-gray-50/60 p-0.5 gap-0.5", className ?? ""].filter(Boolean).join(" ")}>
      {items.map((item) => {
        const isActive = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => !item.disabled && onChange(item.id)}
            disabled={item.disabled}
            aria-selected={isActive}
            role="tab"
            className={`inline-flex items-center gap-1.5 rounded font-medium transition-all focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${
              isActive
                ? "bg-white text-gray-950 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                : "bg-transparent text-gray-600 hover:text-gray-950"
            }`}
          >
            {Icon && <Icon size={iconSize} />}
            {item.label}
            {item.badge !== undefined && <span className="ml-0.5">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pill segmenté flottant Liquid Glass v2 — surface glass-soft + ring
 * intérieur signature. Tab actif = pastille blanche solide qui ressort
 * du verre. Pour onglets sur surfaces glass / hero / panels overlay.
 */
function GlassTabs({ items, value, onChange, size, className }: Required<Pick<TabsProps, "items" | "value" | "onChange">> & { size: "sm" | "md"; className?: string }) {
  const sizeCls = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <div
      className={[
        "inline-flex items-center rounded-md p-0.5 gap-0.5",
        "bg-[var(--surface-glass-medium)] backdrop-blur-[12px] backdrop-saturate-150",
        "shadow-[var(--shadow-glass-sm),var(--ring-glass-edge)]",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {items.map((item) => {
        const isActive = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => !item.disabled && onChange(item.id)}
            disabled={item.disabled}
            aria-selected={isActive}
            role="tab"
            className={`inline-flex items-center gap-1.5 rounded font-medium transition-all focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${
              isActive
                ? "bg-white text-gray-950 shadow-[var(--ring-glass-inset),0_1px_2px_rgba(15,23,42,0.06)]"
                : "bg-transparent text-gray-600 hover:text-gray-950"
            }`}
          >
            {Icon && <Icon size={iconSize} />}
            {item.label}
            {item.badge !== undefined && <span className="ml-0.5">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

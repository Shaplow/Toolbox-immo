"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Tabs — segmentation simple, 2 variants visuels.
 *
 * - `line` (default) : border-bottom-2 sous le tab actif. Pour navigation
 *   principale de fiches / panneaux.
 * - `pill` : segmented control. Pour filtres et sub-toggles compacts
 *   ("Tous · Actifs · Archivés").
 *
 * Le variant `glass` (legacy v2) est mappé vers `pill` pour cohérence DA v3.
 */

interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  disabled?: boolean;
}

type TabVariant = "line" | "pill" | "glass";

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: TabVariant;
  size?: "sm" | "md";
  className?: string;
}

function resolveVariant(v: TabVariant): "line" | "pill" {
  return v === "line" ? "line" : "pill";
}

export function Tabs({
  items,
  value,
  onChange,
  variant = "line",
  size = "md",
  className,
}: TabsProps) {
  const resolved = resolveVariant(variant);
  if (resolved === "pill") return <PillTabs items={items} value={value} onChange={onChange} size={size} className={className} />;
  return <LineTabs items={items} value={value} onChange={onChange} size={size} className={className} />;
}

function LineTabs({ items, value, onChange, size, className }: Required<Pick<TabsProps, "items" | "value" | "onChange">> & { size: "sm" | "md"; className?: string }) {
  const sizeCls = size === "sm" ? "h-7 px-2 text-[12px]" : "h-9 px-3 text-[13px]";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <div className={["flex items-center border-b border-border", className ?? ""].filter(Boolean).join(" ")}>
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
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
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
    <div className={[
      "inline-flex items-center rounded-md bg-muted border border-border p-0.5 gap-0.5",
      className ?? "",
    ].filter(Boolean).join(" ")}>
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
            className={`inline-flex items-center gap-1.5 rounded font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground"
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

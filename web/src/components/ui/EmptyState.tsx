"use client";

import { isValidElement, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

/**
 * Empty state flat shadcn — icône dans cercle muted + titre + description + CTA.
 *
 * API :
 * - icon : LucideIcon ou ReactElement déjà rendu.
 * - title / description : copy court.
 * - cta : Button primary size sm.
 */
interface EmptyStateProps {
  icon: LucideIcon | ReactElement;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  const iconNode = isValidElement(icon) ? (
    icon
  ) : (
    (() => {
      const Icon = icon as LucideIcon;
      return <Icon size={22} className="text-muted-foreground" />;
    })()
  );

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-lg bg-card border border-dashed border-border">
      <div className="h-11 w-11 rounded-md bg-muted border border-border flex items-center justify-center mb-3">
        {iconNode}
      </div>
      <h3 className="text-sm font-semibold text-foreground leading-none">{title}</h3>
      {description && (
        <p className="text-[12px] text-muted-foreground max-w-sm mt-2 leading-relaxed">
          {description}
        </p>
      )}
      {cta && (
        <div className="mt-4">
          <Button size="sm" onClick={cta.onClick}>
            {cta.label}
          </Button>
        </div>
      )}
    </div>
  );
}

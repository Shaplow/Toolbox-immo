"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
      <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center mb-3">
        <Icon size={20} className="text-gray-400" />
      </div>
      <h3 className="text-sm font-medium text-gray-700 mb-1">{title}</h3>
      {description && <p className="text-xs text-gray-500 max-w-sm mb-3">{description}</p>}
      {cta && (
        <Button variant="primary" size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </div>
  );
}
